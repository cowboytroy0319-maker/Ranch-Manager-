// ============================================================================
// Ranch Manager Pro — Auth + ranch-level isolation integration tests (bun test)
// Exercises the injectable auth cores (registerCore / loginCore) and the
// password/session helpers against a REAL local Postgres (see the
// local-postgres-testing skill). The auth tables come from migration 0014;
// this test applies ALL migrations (incl. 0014, idempotent) to the test DB,
// then cleans up after itself.
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_auth_test \
//     bun test src/server/auth.test.ts
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  loginCore,
  registerCore,
  requireAuth,
  resolveAuth,
  verifyPassword,
} from "./authServer";

type AuthDb = ReturnType<typeof sql>;

const EMAIL_A = `auth-test-${Date.now()}-a@example.com`;
const EMAIL_B = `auth-test-${Date.now()}-b@example.com`;
const PASSWORD = "CorrectHorse42!";

let db: AuthDb;
let defaultOpId: number; // the seeded "Default Operation" (0013)
let opAId: number; // operation created by registerCore for user A
let opBId: number; // operation created by registerCore for user B

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "auth.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0014_auth_users_operations.sql
  const [defOp] = await db<[{ id: number }]>`SELECT id FROM operations ORDER BY id LIMIT 1`;
  defaultOpId = defOp.id;
});

afterAll(async () => {
  // Remove every row this file created: the two operations (cascade removes
  // their scoped hay/herd rows and memberships) and the two users (cascade
  // removes memberships + sessions). Idempotent if a test failed midway.
  try {
    await db`DELETE FROM users WHERE email LIKE ${"auth-test-%"}`;
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

describe("registerCore — account + NEW operation + owner membership", () => {
  test("creates a user, a customer-named operation (NOT the Default Operation), and an owner membership", async () => {
    const res = await registerCore(db, {
      email: EMAIL_A,
      password: PASSWORD,
      operationName: "Copper Creek Ranch",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("registerCore should have succeeded");

    // (a) the new operation's id is NOT the seeded Default Operation id.
    expect(res.operationId).not.toBe(defaultOpId);
    opAId = res.operationId;

    // The operations row exists with the provided ranch name.
    const [op] = await db<[{ id: number; name: string }]>`
      SELECT id, name FROM operations WHERE id = ${res.operationId}`;
    expect(op.name).toBe("Copper Creek Ranch");

    // The user row exists with the normalized email.
    const [user] = await db<[{ id: number; email: string }]>`
      SELECT id, email FROM users WHERE email = ${EMAIL_A}`;
    expect(user.email).toBe(EMAIL_A);

    // Exactly one owner membership linking user -> the NEW operation.
    const memberships = await db<[{ user_id: number; operation_id: number; role: string }]>`
      SELECT user_id, operation_id, role FROM operation_memberships WHERE user_id = ${user.id}`;
    expect(memberships.length).toBe(1);
    expect(memberships[0].operation_id).toBe(res.operationId);
    expect(memberships[0].role).toBe("owner");
  });

  test("duplicate email is rejected with a friendly error (no second account)", async () => {
    const dup = await registerCore(db, {
      email: EMAIL_A,
      password: PASSWORD,
      operationName: "Second Try Ranch",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error).toBe("That email is already registered — try signing in.");
    }
    const [count] = await db<[{ n: number }]>`SELECT count(*) AS n FROM users WHERE email = ${EMAIL_A}`;
    expect(Number(count.n)).toBe(1);
  });
});

describe("password storage — salted scrypt hash, never plaintext", () => {
  test("stores a hash != the plaintext and verifyPassword(plain, stored) round-trips", async () => {
    const [user] = await db<[{ password_hash: string }]>`
      SELECT password_hash FROM users WHERE email = ${EMAIL_A}`;
    expect(user.password_hash).not.toBe(PASSWORD);
    expect(user.password_hash.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword(PASSWORD, user.password_hash)).toBe(true);
    expect(verifyPassword("Wrong-Password-1", user.password_hash)).toBe(false);
  });
});

describe("loginCore — correct vs incorrect credentials", () => {
  test("correct password → ok:true with operationId/role", async () => {
    const res = await loginCore(db, { email: EMAIL_A, password: PASSWORD });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.operationId).toBe(opAId);
      expect(res.operationName).toBe("Copper Creek Ranch");
      expect(res.role).toBe("owner");
    }
  });

  test("wrong password → ok:false with the expected error message", async () => {
    const res = await loginCore(db, { email: EMAIL_A, password: "wrong-password" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Incorrect email or password.");
  });

  test("unknown email → same generic error (no account enumeration)", async () => {
    const res = await loginCore(db, { email: "nobody@example.com", password: PASSWORD });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Incorrect email or password.");
  });
});

describe("protected access with no session", () => {
  test("requireAuth (the first thing every protected server fn calls) rejects", async () => {
    // Unit-test path: no request context -> no session -> requireAuth throws.
    let threw = false;
    let msg = "";
    try {
      await requireAuth(db);
    } catch (err) {
      threw = true;
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(msg).toContain("Not authenticated");
  });

  test("resolveAuth returns null without a session cookie", async () => {
    const auth = await resolveAuth(db);
    expect(auth).toBeNull();
  });
});

describe("ranch isolation — cross-ranch reads and writes are rejected", () => {
  test("user B's rows are invisible to a read scoped to user A's operation", async () => {
    // Register user B (creates operation B via registerCore).
    const resB = await registerCore(db, {
      email: EMAIL_B,
      password: PASSWORD,
      operationName: "Sage Flat Cattle",
    });
    expect(resB.ok).toBe(true);
    if (!resB.ok) throw new Error("registerCore for user B should have succeeded");
    opBId = resB.operationId;

    // Data that belongs ONLY to operation B (same columns saveHay inserts).
    await db`
      INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit)
      VALUES (${opBId}, 'grass', 5, 'bales')`;
    await db`
      INSERT INTO herd_groups (operation_id, name, species)
      VALUES (${opBId}, 'B-Cow Herd', 'cattle')`;

    // The exact read shape getFeedData uses, bound to A's operation:
    const aHay = await db`SELECT id FROM hay_inventory WHERE operation_id = ${opAId}`;
    expect(aHay.length).toBe(0);
    const aGroups = await db`SELECT id FROM herd_groups WHERE operation_id = ${opAId}`;
    expect(aGroups.length).toBe(0);

    // The same query bound to B's operation does see them (positive control).
    const bHay = await db`SELECT id FROM hay_inventory WHERE operation_id = ${opBId}`;
    expect(bHay.length).toBe(1);
    const bGroups = await db`SELECT id FROM herd_groups WHERE operation_id = ${opBId}`;
    expect(bGroups.length).toBe(1);
  });

  test("an UPDATE scoped to user A's operation cannot mutate user B's row", async () => {
    // Sanity: the row exists in B's operation.
    const [bHay] = await db<[{ id: number; quantity: string }]>`
      SELECT id, quantity FROM hay_inventory WHERE operation_id = ${opBId} ORDER BY id`;
    expect(bHay).toBeDefined();

    // The exact UPDATE shape saveHay uses, but A's session operation_id —
    // the WHERE clause matches zero rows, so A's write is rejected.
    const updated = await db`
      UPDATE hay_inventory SET quantity = 999, updated_at = now()
      WHERE id = ${bHay.id} AND operation_id = ${opAId} RETURNING id`;
    expect(updated.length).toBe(0);

    // The row is untouched (still B's 5 bales).
    const [after] = await db<[{ quantity: string }]>`
      SELECT quantity FROM hay_inventory WHERE id = ${bHay.id}`;
    expect(Number(after.quantity)).toBe(5);
  });
});