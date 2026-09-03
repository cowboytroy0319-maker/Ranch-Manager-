// ============================================================================
// Ranch Manager Pro — auth server-only implementation
// ----------------------------------------------------------------------------
// ALL server-side auth machinery lives here: password hashing (node:crypto
// scrypt), token hashing, session resolution/creation, and the register/login
// cores. This module imports ~/db, node:crypto, and
// "@tanstack/react-start/server"; it MUST NEVER be imported by client code.
// The public surface (createServerFn exports) lives in ./auth.ts, whose
// handlers lazy-dynamic-import this module. Server modules (feed.ts,
// livestock.ts, ...) may import requireAuth directly from here — they only
// ever run server-side (inside createServerFn handlers).
//
// registerCore ALWAYS creates a fresh `operations` row for a new account
// (named by the customer) plus an owner membership — a registered user never
// reuses the seeded "Default Operation" or any demo data (see auth.test.ts).
// ============================================================================
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import postgres from "postgres";
import { isDatabaseConfigured, sql } from "~/db";
import type { AuthedUser, AuthResult } from "./authTypes";

export const SESSION_COOKIE = "rmp_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Cookie + request helpers (server-only)
// ---------------------------------------------------------------------------
export function isServerRequest(): boolean {
  try {
    const req = getRequest();
    return !!req;
  } catch {
    return false;
  }
}

export function readSessionToken(): string | null {
  try {
    const val = getCookie(SESSION_COOKIE);
    if (typeof val === "string" && val.length > 0) return val;
    return null;
  } catch {
    return null;
  }
}

export function writeSessionCookie(token: string, expiresAtMs: number): void {
  try {
    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: new Date(expiresAtMs),
    });
  } catch {
    /* no request context — nothing to attach a cookie to */
  }
}

export function clearSessionCookie(): void {
  try {
    setCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: new Date(0),
    });
  } catch {
    /* no request context */
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
export type PasswordHashParts = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

/** Parse a stored `scrypt:N:r:p:salthex:hashhex` string. */
export function parsePasswordHash(stored: string): PasswordHashParts {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("Malformed password hash");
  }
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    throw new Error("Malformed password hash params");
  }
  return { N, r, p, salt: Buffer.from(parts[4], "hex"), hash: Buffer.from(parts[5], "hex") };
}

/** Hash a plaintext password with a fresh random salt (or a caller-supplied one). */
export function hashPassword(plain: string, salt?: Buffer): string {
  const s = salt ?? randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(plain, s, 64, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${s.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verify of a plaintext password against a stored hash. */
export function verifyPassword(plain: string, stored: string): boolean {
  let parts: PasswordHashParts;
  try {
    parts = parsePasswordHash(stored);
  } catch {
    return false;
  }
  const candidate = scryptSync(plain, parts.salt, parts.hash.length, {
    N: parts.N,
    r: parts.r,
    p: parts.p,
  });
  return (
    candidate.length === parts.hash.length && timingSafeEqual(candidate, parts.hash)
  );
}

/** SHA-256 hex digest (used for session-token hashing). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** New random session token (raw, for the cookie) — 32 bytes hex = 64 chars. */
export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** URL-safe expiry encoded as ms epoch; used by the cookie. */
export function sessionExpiryMs(now = Date.now()): number {
  return now + SESSION_TTL_MS;
}

// ---------------------------------------------------------------------------
// Session rows + auth resolution (server-only)
// ---------------------------------------------------------------------------

export type AuthDb = ReturnType<typeof sql>;

/**
 * Insert a session row and attach the bearer cookie. Cookie attachment is
 * request-scoped and silently no-ops outside a request (unit tests), so this
 * is safe to call from the injectable cores.
 */
export async function createSessionRow(db: AuthDb, userId: number): Promise<void> {
  const token = newSessionToken();
  const expires = new Date(sessionExpiryMs());
  await db`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${sha256Hex(token)}, ${userId}, ${expires})`;
  writeSessionCookie(token, expires.getTime());
}

/** Delete a session row by its raw token (logout). */
export async function deleteSessionByToken(db: AuthDb, token: string): Promise<void> {
  await db`DELETE FROM sessions WHERE token_hash = ${sha256Hex(token)}`;
}

/** Resolve the authenticated user + operation from the request cookie, or null. */
export async function resolveAuth(db?: AuthDb): Promise<AuthedUser | null> {
  if (!isDatabaseConfigured()) return null;
  const token = readSessionToken();
  if (!token) return null;
  const dbc = db ?? sql();
  try {
    const rows = await dbc<[{ user_id: number }]>`SELECT user_id FROM sessions
      WHERE token_hash = ${sha256Hex(token)} AND expires_at > now()`;
    if (!rows.length) return null;
    const userId = rows[0].user_id;
    const who = await dbc<
      [{ email: string; operation_id: number; operation_name: string; role: string }]
    >`SELECT u.email, m.operation_id, o.name AS operation_name, m.role
      FROM users u
      JOIN operation_memberships m ON m.user_id = u.id
      JOIN operations o ON o.id = m.operation_id
      WHERE u.id = ${userId} AND m.role IN ('owner','worker','viewer')
      ORDER BY m.operation_id LIMIT 1`;
    if (!who.length) return null;
    return {
      userId,
      email: who[0].email,
      operationId: who[0].operation_id,
      operationName: who[0].operation_name,
      role: who[0].role as AuthedUser["role"],
    };
  } catch {
    return null;
  }
}

/** requireAuth for server fns: throws a 401-ish AuthError when unauthenticated. */
export async function requireAuth(db?: AuthDb): Promise<AuthedUser> {
  if (!isServerRequest()) {
    // This is the unit-test path: handlers called without a request have no
    // session by definition, so requireAuth rejects. Tests exercise the pure
    // helpers and the injectable cores instead.
    throw new Error("Not authenticated");
  }
  const auth = await resolveAuth(db);
  if (!auth) throw new Error("Not authenticated — please sign in.");
  return auth;
}

// ---------------------------------------------------------------------------
// Injectable cores (unit-tested with a real test DB via auth.test.ts)
// ---------------------------------------------------------------------------

/**
 * registerCore — creates the account, a NEW operation (named by the customer),
 * and the owner membership, then opens a session. Injectable db for tests.
 * Always inserts a fresh `operations` row — never reuses "Default Operation".
 */
export async function registerCore(
  db: AuthDb,
  raw: { email?: unknown; password?: unknown; operationName?: unknown }
): Promise<AuthResult> {
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");
  const operationName = String(raw.operationName ?? "").trim() || "My Ranch";
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (password.length > 200) return { ok: false, error: "Password is too long." };
  if (operationName.length > 80) {
    return { ok: false, error: "Ranch/operation name is too long (80 characters max)." };
  }
  let userId: number | null = null;
  try {
    const [user] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hashPassword(password)}) RETURNING id`;
    userId = user.id;
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return { ok: false, error: "That email is already registered — try signing in." };
    }
    return { ok: false, error: "Could not create your account. Please try again." };
  }
  try {
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name)
      VALUES (${operationName}) RETURNING id`;
    await db`INSERT INTO operation_memberships (user_id, operation_id, role)
      VALUES (${userId}, ${op.id}, 'owner')`;
    await createSessionRow(db, userId);
    return { ok: true, email, operationId: op.id, operationName, role: "owner" };
  } catch {
    // Roll back the half-created account so a retry starts clean.
    try {
      if (userId !== null) await db`DELETE FROM users WHERE id = ${userId}`;
    } catch {
      /* best effort */
    }
    return { ok: false, error: "Could not set up your operation. Please try again." };
  }
}

/** loginCore — verify credentials and open a session for the user's first
 *  operation membership. Injectable db for tests. */
export async function loginCore(
  db: AuthDb,
  raw: { email?: unknown; password?: unknown }
): Promise<AuthResult> {
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!password) return { ok: false, error: "Password is required." };
  try {
    const [row] = await db<
      [{ id: number; password_hash: string; operation_id: number; operation_name: string; role: string }]
    >`SELECT u.id, u.password_hash, m.role, m.operation_id, o.name AS operation_name
      FROM users u
      JOIN operation_memberships m ON m.user_id = u.id
      JOIN operations o ON o.id = m.operation_id
      WHERE lower(u.email) = ${email}
      ORDER BY m.operation_id LIMIT 1`;
    if (!row || !verifyPassword(password, row.password_hash)) {
      return { ok: false, error: "Incorrect email or password." };
    }
    await createSessionRow(db, row.id);
    return {
      ok: true,
      email,
      operationId: row.operation_id,
      operationName: row.operation_name,
      role: row.role,
    };
  } catch {
    return { ok: false, error: "Incorrect email or password." };
  }
}

export type { postgres };