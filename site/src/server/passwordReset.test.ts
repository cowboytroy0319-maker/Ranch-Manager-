// ============================================================================
// Ranch Manager Pro — password-reset integration tests (bun test)
// Password-reset cores only; entitlement.ts (migration 0019) is untouched.
// Exercises the injectable reset cores (requestPasswordResetCore /
// resetPasswordCore) against a REAL local Postgres (see the
// local-postgres-testing skill). Applies ALL migrations (idempotent,
// including 0020) to the test DB, then cleans up after itself.
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_reset_test \
//     bun test src/server/passwordReset.test.ts
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import { hashPassword, newSessionToken, sha256Hex } from "./authServer";
import {
  RESET_INVALID_TOKEN_MESSAGE,
  RESET_NEUTRAL_MESSAGE,
  RESET_RATE_LIMIT_MESSAGE,
  hashResetToken,
  isWellFormedResetToken,
  newResetToken,
  requestPasswordResetCore,
  resetPasswordCore,
} from "./passwordResetServer";

type ResetDb = ReturnType<typeof sql>;

const TS = Date.now();
const EMAIL_A = `reset-test-${TS}-a@example.com`;
const EMAIL_B = `reset-test-${TS}-b@example.com`;
const UNKNOWN_EMAIL = `reset-test-${TS}-unknown@example.com`;
const OLD_PASSWORD = "OldPassword42!";
const NEW_PASSWORD = "NewPassword43!";

let db: ResetDb;
let userAId = 0;
let userBId = 0;
let opAId = 0;
let opBId = 0;

process.env.RMP_RESET_TEST_MODE = "1";

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "passwordReset.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0020_password_reset.sql
  for (const [email, pw] of [[EMAIL_A, OLD_PASSWORD], [EMAIL_B, OLD_PASSWORD]] as const) {
    const [user] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hashPassword(pw)}) RETURNING id`;
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name)
      VALUES (${"Reset Test Ranch"}) RETURNING id`;
    await db`INSERT INTO operation_memberships (user_id, operation_id, role)
      VALUES (${user.id}, ${op.id}, 'owner')`;
    if (email === EMAIL_A) { userAId = user.id; opAId = op.id; }
    else { userBId = user.id; opBId = op.id; }
  }
});

afterAll(async () => {
  try {
    await db`DELETE FROM users WHERE email LIKE ${"reset-test-%"}`;
  } catch { /* best effort */ }
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId}`;
  } catch { /* best effort */ }
  try {
    await db`DELETE FROM password_reset_requests WHERE email LIKE ${"reset-test-%"}`;
  } catch { /* best effort */ }
  try { await closeDb(); } catch { /* best effort */ }
});

let ipCounter = 100;
async function mintToken(email: string): Promise<string> {
  // Backdate prior request rows beyond the 1-hour window so neither the
  // 60s per-email cooldown nor the hourly caps trip (each test mints
  // several tokens for the same address), and use a fresh IP per mint.
  await db`UPDATE password_reset_requests SET created_at = now() - interval '2 hours'
    WHERE email = ${email}`;
  const ip = `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const res = await requestPasswordResetCore(db, { email, ip, origin: "http://localhost" });
  expect(res.ok).toBe(true);
  expect(res.message).toBe(RESET_NEUTRAL_MESSAGE);
  if (!res.testOnly) throw new Error("test mode must return a token (RMP_RESET_TEST_MODE=1)");
  return res.testOnly;
}

async function sessionCount(userId: number): Promise<number> {
  const [row] = await db<[{ n: string }]>`SELECT count(*) AS n FROM sessions WHERE user_id = ${userId}`;
  return Number(row.n);
}

async function openSession(userId: number): Promise<string> {
  const token = newSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${sha256Hex(token)}, ${userId}, ${expires})`;
  return token;
}

describe("token helpers", () => {
  test("newResetToken is 32+ random bytes (64 hex chars), hashed server-side only", () => {
    const t1 = newResetToken();
    const t2 = newResetToken();
    expect(t1).not.toBe(t2);
    expect(isWellFormedResetToken(t1)).toBe(true);
    expect(isWellFormedResetToken("short")).toBe(false);
    expect(isWellFormedResetToken("zz".repeat(32))).toBe(false);
    expect(isWellFormedResetToken(null)).toBe(false);
    // Only the SHA-256 digest is stored — the raw token never appears in the table.
    expect(hashResetToken(t1)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("requestPasswordResetCore — neutral responses, no enumeration", () => {
  test("unknown email returns the exact neutral message (no account reveal)", async () => {
    const res = await requestPasswordResetCore(db, {
      email: UNKNOWN_EMAIL, ip: "10.0.0.9", origin: "http://localhost",
    });
    expect(res.ok).toBe(true);
    expect(res.message).toBe(RESET_NEUTRAL_MESSAGE);
    expect(res.testOnly === undefined).toBe(true);
    const rows = await db`SELECT pr.id FROM password_resets pr
      JOIN users u ON u.id = pr.user_id WHERE u.email = ${UNKNOWN_EMAIL}`;
    expect(rows.length).toBe(0);
  });

  test("known email returns the exact same neutral message", async () => {
    const res = await requestPasswordResetCore(db, {
      email: EMAIL_A, ip: "10.0.0.3", origin: "http://localhost",
    });
    expect(res.ok).toBe(true);
    expect(res.message).toBe(RESET_NEUTRAL_MESSAGE);
  });
});

describe("resetPasswordCore — valid reset end-to-end", () => {
  test("valid token resets the password and deletes ALL sessions (force re-login)", async () => {
    await openSession(userAId);
    await openSession(userAId);
    expect(await sessionCount(userAId)).toBe(2);
    const token = await mintToken(EMAIL_A);
    const res = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD },
      hashPassword
    );
    expect(res.ok).toBe(true);
    // New password verifies, old one does not.
    const [row] = await db<[{ password_hash: string }]>`SELECT password_hash FROM users WHERE id = ${userAId}`;
    const { verifyPassword } = await import("./authServer");
    expect(verifyPassword(NEW_PASSWORD, row.password_hash)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, row.password_hash)).toBe(false);
    // All sessions for the user are gone.
    expect(await sessionCount(userAId)).toBe(0);
    // Restore the old password for later tests that need a known state.
    await db`UPDATE users SET password_hash = ${hashPassword(OLD_PASSWORD)} WHERE id = ${userAId}`;
  });

  test("password rules enforced: too short, too long, confirmation mismatch", async () => {
    const token = await mintToken(EMAIL_A);
    const short = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: "short", confirm: "short" }, hashPassword);
    expect(short.ok).toBe(false);
    const long = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: "x".repeat(201), confirm: "x".repeat(201) }, hashPassword);
    expect(long.ok).toBe(false);
    const mismatch = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: NEW_PASSWORD, confirm: "Different44!" }, hashPassword);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toBe("Passwords do not match.");
    // The token was NOT consumed by the failed attempts — it still works.
    const retry = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
    expect(retry.ok).toBe(true);
    await db`UPDATE users SET password_hash = ${hashPassword(OLD_PASSWORD)} WHERE id = ${userAId}`;
  });
});

describe("resetPasswordCore — replay / expiry / replacement / malformed / cross-account", () => {
  test("used token rejected on replay with the generic message", async () => {
    const token = await mintToken(EMAIL_A);
    const first = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
    expect(first.ok).toBe(true);
    const replay = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: "Another45!", confirm: "Another45!" }, hashPassword);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toBe(RESET_INVALID_TOKEN_MESSAGE);
    await db`UPDATE users SET password_hash = ${hashPassword(OLD_PASSWORD)} WHERE id = ${userAId}`;
  });

  test("expired token rejected with the generic message", async () => {
    const token = await mintToken(EMAIL_A);
    // Age the token past its 45-minute TTL directly.
    await db`UPDATE password_resets SET expires_at = now() - interval '1 hour'
      WHERE token_hash = ${hashResetToken(token)}`;
    const res = await resetPasswordCore(
      db, { token, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(RESET_INVALID_TOKEN_MESSAGE);
  });

  test("replaced token rejected after a newer request supersedes it", async () => {
    const first = await mintToken(EMAIL_A);
    // Second request invalidates the first (cooldown is per-email 60s, so
    // backdate the first request row to bypass the cooldown deterministically).
    await db`UPDATE password_reset_requests SET created_at = now() - interval '2 hours'
      WHERE email = ${EMAIL_A}`;
    const second = await mintToken(EMAIL_A);
    expect(second).not.toBe(first);
    const stale = await resetPasswordCore(
      db, { token: first, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBe(RESET_INVALID_TOKEN_MESSAGE);
    const fresh = await resetPasswordCore(
      db, { token: second, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
    expect(fresh.ok).toBe(true);
    await db`UPDATE users SET password_hash = ${hashPassword(OLD_PASSWORD)} WHERE id = ${userAId}`;
  });

  test("malformed tokens rejected with the generic message (never touch the DB meaningfully)", async () => {
    for (const bad of ["", "short", "zz".repeat(32), null, undefined, 12345]) {
      const res = await resetPasswordCore(
        db, { token: bad, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD }, hashPassword);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(RESET_INVALID_TOKEN_MESSAGE);
    }
  });

  test("cross-account token rejected: token for user A cannot reset user B", async () => {
    const tokenForA = await mintToken(EMAIL_A);
    const cross = await resetPasswordCore(
      db, { token: tokenForA, email: EMAIL_B, password: NEW_PASSWORD, confirm: NEW_PASSWORD },
      hashPassword
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error).toBe(RESET_INVALID_TOKEN_MESSAGE);
    // User B's password is untouched.
    const [rowB] = await db<[{ password_hash: string }]>`SELECT password_hash FROM users WHERE id = ${userBId}`;
    const { verifyPassword } = await import("./authServer");
    expect(verifyPassword(OLD_PASSWORD, rowB.password_hash)).toBe(true);
    // And the token still works for its rightful owner.
    const rightful = await resetPasswordCore(
      db, { token: tokenForA, email: EMAIL_A, password: NEW_PASSWORD, confirm: NEW_PASSWORD },
      hashPassword
    );
    expect(rightful.ok).toBe(true);
    await db`UPDATE users SET password_hash = ${hashPassword(OLD_PASSWORD)} WHERE id = ${userAId}`;
  });
});

describe("requestPasswordResetCore — rate limiting", () => {
  test("max 5 requests/hour per email, then the generic rate-limit message", async () => {
    const email = `reset-test-${TS}-ratelimit@example.com`;
    const [user] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hashPassword(OLD_PASSWORD)}) RETURNING id`;
    const ips = ["10.0.1.1", "10.0.1.2", "10.0.1.3", "10.0.1.4", "10.0.1.5", "10.0.1.6"];
    let limited = 0;
    for (let i = 0; i < ips.length; i++) {
      // Backdate prior request rows so the 60s cooldown never trips — this
      // isolates the hourly cap under test.
      await db`UPDATE password_reset_requests SET created_at = now() - interval '2 minutes'
        WHERE email = ${email}`;
      const res = await requestPasswordResetCore(db, { email, ip: ips[i], origin: "http://localhost" });
      expect(res.ok).toBe(true);
      if (res.message === RESET_RATE_LIMIT_MESSAGE) limited++;
      else expect(res.message).toBe(RESET_NEUTRAL_MESSAGE);
    }
    expect(limited).toBe(1);
    await db`DELETE FROM password_resets WHERE user_id = ${user.id}`;
    await db`DELETE FROM password_reset_requests WHERE email = ${email}`;
    await db`DELETE FROM users WHERE id = ${user.id}`;
  });

  test("short per-email cooldown returns the generic rate-limit message", async () => {
    const email = `reset-test-${TS}-cooldown@example.com`;
    const [user] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hashPassword(OLD_PASSWORD)}) RETURNING id`;
    const first = await requestPasswordResetCore(db, { email, ip: "10.0.2.1", origin: "http://localhost" });
    expect(first.message).toBe(RESET_NEUTRAL_MESSAGE);
    const immediate = await requestPasswordResetCore(db, { email, ip: "10.0.2.2", origin: "http://localhost" });
    expect(immediate.ok).toBe(true);
    expect(immediate.message).toBe(RESET_RATE_LIMIT_MESSAGE);
    await db`DELETE FROM password_resets WHERE user_id = ${user.id}`;
    await db`DELETE FROM password_reset_requests WHERE email = ${email}`;
    await db`DELETE FROM users WHERE id = ${user.id}`;
  });
});
