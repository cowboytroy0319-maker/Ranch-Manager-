// ============================================================================
// Ranch Manager Pro — complimentary-access entitlement tests (bun test)
// ----------------------------------------------------------------------------
// Covers src/server/entitlement.ts (migration 0019: operations.is_complimentary
// + operation_entitlements) against a REAL local Postgres.
//
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ranch_ci \
//     bun test src/server/entitlement.test.ts
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's live database is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import { hashPassword, resolveAuthToken } from "./authServer";
import { checkSubscriptionEntitlement, hasComplimentaryAccess } from "./entitlement";

type EntDb = ReturnType<typeof sql>;
const TS = Date.now();
const EMAIL_A = `ent-test-${TS}-a@example.com`;
const EMAIL_B = `ent-test-${TS}-b@example.com`;
const PASSWORD = "EntitlementTest42!";

let db: EntDb;
let userAId = 0;
let userBId = 0;
let opAId = 0;
let opBId = 0;

async function sessionCount(userId: number): Promise<number> {
  const [row] = await db<[{ count: number }]>`SELECT count(*)::int AS count FROM sessions
    WHERE user_id = ${userId}`;
  return row?.count ?? 0;
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "entitlement.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's live database must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0019_owner_complimentary_access.sql
  for (const email of [EMAIL_A, EMAIL_B] as const) {
    const [user] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hashPassword(PASSWORD)}) RETURNING id`;
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name)
      VALUES (${"Entitlement Test Ranch"}) RETURNING id`;
    await db`INSERT INTO operation_memberships (user_id, operation_id, role)
      VALUES (${user.id}, ${op.id}, 'owner')`;
    if (email === EMAIL_A) {
      userAId = user.id;
      opAId = op.id;
    } else {
      userBId = user.id;
      opBId = op.id;
    }
  }
});

afterAll(async () => {
  try {
    await db`DELETE FROM operation_entitlements WHERE operation_id IN (${opAId}, ${opBId})`;
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM operation_memberships WHERE operation_id IN (${opAId}, ${opBId})`;
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM users WHERE email LIKE ${"ent-test-%"}`;
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM operations WHERE id IN (${opAId}, ${opBId})`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

describe("complimentary access — explicit flag, auditable, isolation intact", () => {
  test("non-complimentary operation fails the entitlement check by default", async () => {
    expect(await hasComplimentaryAccess(db, opAId)).toBe(false);
    const ent = await checkSubscriptionEntitlement(db, opAId);
    expect(ent.complimentary).toBe(false);
    expect(ent.subscribed).toBe(false);
  });

  test("complimentary operation passes after an explicit audited grant, and revoke restores the default", async () => {
    await db`UPDATE operations SET is_complimentary = true WHERE id = ${opBId}`;
    await db`INSERT INTO operation_entitlements (operation_id, kind, reason, granted_by)
      VALUES (${opBId}, 'complimentary_grant', 'test grant', 'test')`;
    expect(await hasComplimentaryAccess(db, opBId)).toBe(true);
    const ent = await checkSubscriptionEntitlement(db, opBId);
    expect(ent.complimentary).toBe(true);
    await db`UPDATE operations SET is_complimentary = false WHERE id = ${opBId}`;
    await db`INSERT INTO operation_entitlements (operation_id, kind, reason, granted_by)
      VALUES (${opBId}, 'complimentary_revoke', 'test revoke', 'test')`;
    expect(await hasComplimentaryAccess(db, opBId)).toBe(false);
  });

  test("the audit trail records the grant and the revoke for this operation", async () => {
    const rows = await db<[{ kind: string }]>`SELECT kind FROM operation_entitlements
      WHERE operation_id = ${opBId} ORDER BY id`;
    const kinds = rows.map((r) => r.kind);
    expect(kinds.includes("complimentary_grant")).toBe(true);
    expect(kinds.includes("complimentary_revoke")).toBe(true);
  });

  test("data isolation intact: cross-operation reads still blocked", async () => {
    const [pasture] = await db<[{ id: number }]>`INSERT INTO pastures (operation_id, name, size_acres)
      VALUES (${opAId}, ${"Entitlement Test Pasture"}, 40) RETURNING id`;
    const cross = await db`SELECT id FROM pastures
      WHERE id = ${pasture.id} AND operation_id = ${opBId}`;
    expect(cross.length).toBe(0);
    const own = await db`SELECT id FROM pastures
      WHERE id = ${pasture.id} AND operation_id = ${opAId}`;
    expect(own.length).toBe(1);
    await db`DELETE FROM pastures WHERE id = ${pasture.id}`;
  });

  test("login still required: entitlement never substitutes for authentication", async () => {
    await db`UPDATE operations SET is_complimentary = true WHERE id = ${opBId}`;
    expect(await hasComplimentaryAccess(db, opBId)).toBe(true);
    expect(await sessionCount(userBId)).toBe(0);
    const anon = await resolveAuthToken(db, "0".repeat(64));
    expect(anon === null).toBe(true);
    await db`UPDATE operations SET is_complimentary = false WHERE id = ${opBId}`;
  });

  test("unknown operation id fails closed", async () => {
    expect(await hasComplimentaryAccess(db, 999999999)).toBe(false);
    expect(await hasComplimentaryAccess(db, 1.5)).toBe(false);
  });
});

describe("signed-in password change — session hygiene", () => {
  test("changePasswordCore verifies the current password, then keeps this device and drops the others", async () => {
    const { changePasswordCore, CHANGE_PASSWORD_CURRENT_MESSAGE, newSessionToken, sha256Hex } =
      await import("./authServer");
    const tokenHere = newSessionToken();
    const tokenElsewhere = newSessionToken();
    for (const token of [tokenHere, tokenElsewhere]) {
      await db`INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (${sha256Hex(token)}, ${userAId}, now() + interval '1 day')`;
    }
    expect(await sessionCount(userAId)).toBe(2);

    // Wrong current password → refused, no session dropped.
    const bad = await changePasswordCore(db, tokenHere, {
      currentPassword: "not-the-password",
      password: "ChangedPassword44!",
      confirm: "ChangedPassword44!",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe(CHANGE_PASSWORD_CURRENT_MESSAGE);
    expect(await sessionCount(userAId)).toBe(2);

    // Correct current password → new hash stored, other device logged out.
    const good = await changePasswordCore(db, tokenHere, {
      currentPassword: PASSWORD,
      password: "ChangedPassword44!",
      confirm: "ChangedPassword44!",
    });
    expect(good.ok).toBe(true);
    expect(await sessionCount(userAId)).toBe(1);
    const stillHere = await resolveAuthToken(db, tokenHere);
    expect(stillHere === null).toBe(false);
    const loggedOut = await resolveAuthToken(db, tokenElsewhere);
    expect(loggedOut === null).toBe(true);

    // Restore the original password so the shared test DB stays usable.
    const restore = await changePasswordCore(db, tokenHere, {
      currentPassword: "ChangedPassword44!",
      password: PASSWORD,
      confirm: PASSWORD,
    });
    expect(restore.ok).toBe(true);
    await db`DELETE FROM sessions WHERE user_id = ${userAId}`;
    expect(await sessionCount(userAId)).toBe(0);
  });
});
