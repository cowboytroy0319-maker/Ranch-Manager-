// ============================================================================
// Ranch Manager Pro — password reset server implementation
// ----------------------------------------------------------------------------
// Server-only (imports ~/db, node:crypto, @tanstack/react-start/server).
// NEVER import from client code — the public surface lives in
// ./passwordReset.ts (createServerFn wrappers that lazy-dynamic-import here).
//
// Password reset design:
//   * Tokens are 32 cryptographically random bytes, hex-encoded (64 chars).
//     Only the SHA-256 hex digest is persisted (password_resets.token_hash).
//     The raw token is returned ONCE to the caller so it can be embedded in
//     the emailed link — it is never written to any table or log.
//   * Single-use: resetPasswordCore sets used_at on success. A newer request
//     supersedes older unused rows (they are marked used_at = now()).
//   * Expired / used / superseded / malformed / cross-account tokens all fail
//     with the same generic message — no account enumeration, no oracle.
//   * Rate limiting is server-side in password_reset_requests: max 5 requests
//     per rolling hour per email, max 20 per rolling hour per IP, plus a
//     60-second per-email cooldown. The response is identical whether or not
//     an account exists for the email.
//   * All failures return customer-safe strings. DB errors pass through the
//     guarded client (src/db.ts → src/dbErrors.ts) and arrive already
//     sanitized; every catch here maps to a generic message regardless.
//
// Email delivery:
//   * There is NO configured mail provider (no SDK, no SMTP env). The send
//     path is structured (buildPasswordResetEmail + sendPasswordResetEmail)
//     so a provider plugs in by implementing sendPasswordResetEmail and
//     setting the env vars named in docs/PASSWORD_RESET_EMAIL.md. Until then,
//     requestPasswordResetCore LOGS the send intent server-side only
//     (address + expiry, never the token) and returns the neutral message.
//     No reset email is ever sent to anyone from any environment today.
//   * Local/preview testing path: when RMP_RESET_TEST_MODE is exactly "1"
//     AND the deployment is NOT production (APP_ENV !== "production"), the
//     core returns the raw token in a testOnly field AND logs it server-side.
//     Production callers never receive a token (testOnly is undefined there).
//     Never enable RMP_RESET_TEST_MODE where real users exist.
//
// Complimentary access: intentionally omitted in this preview branch.
// ============================================================================
import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";
import { isDatabaseConfigured } from "~/db";

export type ResetDb = postgres.Sql;

// ---------------------------------------------------------------------------
// Customer-safe messages (exact wording — UI and tests depend on these)
// ---------------------------------------------------------------------------
export const RESET_NEUTRAL_MESSAGE =
  "If an account exists for that email, we sent password-reset instructions.";
export const RESET_RATE_LIMIT_MESSAGE =
  "Too many reset attempts. Please try again later.";
export const RESET_INVALID_TOKEN_MESSAGE =
  "That reset link is invalid or has expired. Please request a new one.";
export const RESET_PASSWORD_RULES_MESSAGE =
  "Password must be 8 to 200 characters.";
export const RESET_CONFIRM_MISMATCH_MESSAGE = "Passwords do not match.";
export const RESET_SUCCESS_MESSAGE =
  "Your password has been reset. Please sign in with your new password.";

export const RESET_TOKEN_TTL_MS = 45 * 60 * 1000; // ~45 minutes
export const RESET_MAX_PER_EMAIL_PER_HOUR = 5;
export const RESET_MAX_PER_IP_PER_HOUR = 20;
export const RESET_EMAIL_COOLDOWN_MS = 60 * 1000; // 60 seconds

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 32 random bytes, hex-encoded (64 chars). The ONLY place raw tokens exist. */
export function newResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hex digest — the only form of a token ever stored or compared. */
export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Strict shape check so malformed input never reaches a query. */
export function isWellFormedResetToken(raw: unknown): boolean {
  return typeof raw === "string" && /^[0-9a-f]{64}$/i.test(raw);
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * True only when raw-token disclosure is allowed: explicit test mode AND not
 * the production deployment. Production NEVER receives a token.
 */
export function isResetTestMode(): boolean {
  if (process.env.RMP_RESET_TEST_MODE !== "1") return false;
  if (process.env.APP_ENV?.trim() === "production") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Email send path (structured stub — no provider configured)
// ---------------------------------------------------------------------------
export type ResetEmail = { to: string; resetUrl: string; expiresMinutes: number };

/** Build the reset email content. Pure — safe to unit test without a DB. */
export function buildPasswordResetEmail(to: string, token: string, origin: string): ResetEmail {
  const base = String(origin ?? "").replace(/\/+$/, "") || "https://www.ranchmanagerpro.com";
  return {
    to,
    resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
    expiresMinutes: Math.round(RESET_TOKEN_TTL_MS / 60000),
  };
}

/**
 * Send path for the reset email. NO provider is configured, so this is a
 * structured stub: it logs the send intent server-side only (address and
 * expiry — never the token or link) and resolves { delivered: false }.
 * A real provider plugs in here (see docs/PASSWORD_RESET_EMAIL.md for the
 * required env var NAMES) and resolves { delivered: true } on success.
 */
export async function sendPasswordResetEmail(email: ResetEmail): Promise<{ delivered: boolean }> {
  console.error(
    `[password-reset] no email provider configured — reset email for ${email.to} ` +
      `(expires in ${email.expiresMinutes} min) was NOT delivered. ` +
      "See docs/PASSWORD_RESET_EMAIL.md for the required configuration."
  );
  return { delivered: false };
}

// ---------------------------------------------------------------------------
// Injectable cores (unit-tested with a real local test DB)
// ---------------------------------------------------------------------------
export type RequestResetResult = {
  ok: true;
  message: string;
  /** Raw token — present ONLY in non-production test mode. Undefined otherwise. */
  testOnly?: string;
};

/**
 * requestPasswordResetCore — ALWAYS returns the neutral message (or the rate-
 * limit message), whether or not an account exists. Injectable db for tests.
 * `nowMs` is injectable so tests can simulate cooldown/expiry deterministically.
 */
export async function requestPasswordResetCore(
  db: ResetDb,
  raw: { email?: unknown; ip?: unknown; origin?: unknown },
  nowMs = Date.now()
): Promise<RequestResetResult> {
  const email = normalizeEmail(raw.email);
  const ip = String(raw.ip ?? "unknown").slice(0, 80) || "unknown";
  const now = new Date(nowMs);
  const validEmail = email.length >= 3 && email.length <= 254 && EMAIL_RE.test(email);

  try {
    // Rate-limit checks run BEFORE the account lookup, on the normalized
    // email as given, so unknown and known addresses behave identically.
    if (validEmail) {
      const hourAgo = new Date(nowMs - 60 * 60 * 1000);
      const [emailCount] = await db<[{ n: string }]>`SELECT count(*) AS n
        FROM password_reset_requests WHERE email = ${email} AND created_at > ${hourAgo}`;
      if (Number(emailCount.n) >= RESET_MAX_PER_EMAIL_PER_HOUR) {
        return { ok: true, message: RESET_RATE_LIMIT_MESSAGE };
      }
      const [ipCount] = await db<[{ n: string }]>`SELECT count(*) AS n
        FROM password_reset_requests WHERE ip = ${ip} AND created_at > ${hourAgo}`;
      if (Number(ipCount.n) >= RESET_MAX_PER_IP_PER_HOUR) {
        return { ok: true, message: RESET_RATE_LIMIT_MESSAGE };
      }
      const [recent] = await db<[{ created_at: Date }]>`SELECT created_at
        FROM password_reset_requests WHERE email = ${email}
        ORDER BY created_at DESC LIMIT 1`;
      if (recent && nowMs - new Date(recent.created_at).getTime() < RESET_EMAIL_COOLDOWN_MS) {
        return { ok: true, message: RESET_RATE_LIMIT_MESSAGE };
      }
      await db`INSERT INTO password_reset_requests (email, ip, created_at)
        VALUES (${email}, ${ip}, ${now})`;
    }

    if (!validEmail) return { ok: true, message: RESET_NEUTRAL_MESSAGE };

    const [user] = await db<[{ id: number }]>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (!user) return { ok: true, message: RESET_NEUTRAL_MESSAGE };

    // A new request supersedes prior unused tokens (single live token).
    await db`UPDATE password_resets SET used_at = ${now}
      WHERE user_id = ${user.id} AND used_at IS NULL`;
    const token = newResetToken();
    const expires = new Date(nowMs + RESET_TOKEN_TTL_MS);
    await db`INSERT INTO password_resets (user_id, token_hash, expires_at, created_at)
      VALUES (${user.id}, ${hashResetToken(token)}, ${expires}, ${now})`;

    // Structured send path (stub until a provider is configured).
    const emailDoc = buildPasswordResetEmail(email, token, String(raw.origin ?? ""));
    await sendPasswordResetEmail(emailDoc);

    if (isResetTestMode()) {
      // Local/preview testing ONLY (never production): log + return the raw
      // token so the flow is verifiable without an email provider.
      console.error(`[password-reset] test-mode token issued for ${email}`);
      return { ok: true, message: RESET_NEUTRAL_MESSAGE, testOnly: token };
    }
    return { ok: true, message: RESET_NEUTRAL_MESSAGE };
  } catch {
    // Guarded-client DB errors arrive already sanitized; anything else is
    // unexpected — either way the client gets a generic message, never SQL,
    // stack traces, hostnames, tokens, or hashes.
    if (!isDatabaseConfigured()) return { ok: true, message: RESET_NEUTRAL_MESSAGE };
    return { ok: true, message: RESET_NEUTRAL_MESSAGE };
  }
}

export type ResetPasswordResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * resetPasswordCore — consumes a raw token + the account email, sets the new
 * password, marks the token used, and deletes ALL sessions for the user
 * (force re-login everywhere). Cross-account use (token minted for user A
 * presented with user B's email) fails with the generic invalid message.
 * Injectable db + nowMs for tests.
 */
export async function resetPasswordCore(
  db: ResetDb,
  raw: { token?: unknown; email?: unknown; password?: unknown; confirm?: unknown },
  hashPassword: (plain: string) => string,
  nowMs = Date.now()
): Promise<ResetPasswordResult> {
  const token = raw.token;
  const email = normalizeEmail(raw.email);
  const password = String(raw.password ?? "");
  const confirm = String(raw.confirm ?? "");
  if (!isWellFormedResetToken(token) || !EMAIL_RE.test(email)) {
    return { ok: false, error: RESET_INVALID_TOKEN_MESSAGE };
  }
  if (password.length < 8 || password.length > 200) {
    return { ok: false, error: RESET_PASSWORD_RULES_MESSAGE };
  }
  if (password !== confirm) {
    return { ok: false, error: RESET_CONFIRM_MISMATCH_MESSAGE };
  }
  try {
    const now = new Date(nowMs);
    const [row] = await db<[{ id: number; user_id: number }]>`SELECT id, user_id
      FROM password_resets
      WHERE token_hash = ${hashResetToken(token as string)}
        AND used_at IS NULL AND expires_at > ${now} LIMIT 1`;
    if (!row) return { ok: false, error: RESET_INVALID_TOKEN_MESSAGE };
    // Bind the token to its account: the presented email must belong to the
    // token's user, otherwise this is a cross-account attempt.
    const [owner] = await db<[{ id: number }]>`SELECT id FROM users
      WHERE id = ${row.user_id} AND email = ${email} LIMIT 1`;
    if (!owner) return { ok: false, error: RESET_INVALID_TOKEN_MESSAGE };
    await db`UPDATE users SET password_hash = ${hashPassword(password)} WHERE id = ${owner.id}`;
    await db`UPDATE password_resets SET used_at = ${now} WHERE id = ${row.id}`;
    await db`DELETE FROM sessions WHERE user_id = ${owner.id}`;
    return { ok: true, message: RESET_SUCCESS_MESSAGE };
  } catch {
    return { ok: false, error: RESET_INVALID_TOKEN_MESSAGE };
  }
}

// NOTE (preview-auth-flow): complimentary-access entitlement intentionally
// omitted from this preview-only branch. No is_complimentary flag, no
// operation_entitlements table, no entitlement helpers exist here.
