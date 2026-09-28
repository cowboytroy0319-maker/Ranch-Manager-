/**
 * ============================================================================
 * PREVIEW SEED — the LABELLED FAKE fixture the preview environment runs on.
 *
 *   APP_ENV=preview PREVIEW_DATABASE_URL=… bun run db:seed
 *
 * WHAT IT DOES (idempotent; safe to re-run)
 *   1. REFUSES to run unless `APP_ENV=preview`. The preview scratch database is
 *      the ONLY database this may ever write application data to (owner ruling
 *      2026-09-26). Production is not reachable from here by construction: the
 *      app's own mode switch (src/db.ts + src/dbGuard.ts) resolves the target,
 *      and the operator guard refuses a production-marked one.
 *   2. Creates the preview LOGIN through the app's own registration path
 *      (`registerCore`), so the password hash, the operation row and the owner
 *      membership are produced exactly the way a real signup produces them —
 *      no hand-rolled INSERT that could drift from production behaviour. On a
 *      re-run it reuses the existing account and re-hashes the password so the
 *      credentials on file keep working.
 *   3. Creates one operation named clearly as fake:
 *        "PREVIEW — Sandbox Ranch (fake data)"
 *      plus one hay stack to restock (80 bales), 2 pastures and 1 equipment
 *      asset, all named "PREVIEW — …".
 *   4. Resets ONLY that fake operation's restock fixture (restock_log rows and
 *      the linked 'restock' expenses, and the hay stack back to 80 bales) so the
 *      browser E2E (`bun run e2e:restock`) and the owner walkthrough always start
 *      from the same numbers. Nothing outside the preview fixture is touched.
 *
 * ZERO PRODUCTION DATA: every name, email and address here is invented for the
 * preview ("example.com" mailbox, "Sandbox" names). Nothing is copied from, or
 * read out of, any other database.
 *
 * THE PASSWORD IS NEVER PRINTED. It is written, `chmod 600`, to the file named
 * by PREVIEW_LOGIN_CRED_FILE (default /home/team/shared/.local/preview-login.env)
 * — never into git, never into the site tree, never into a log. Set
 * `PREVIEW_LOGIN_PASSWORD` to reuse a known value (CI does this); otherwise a
 * fresh random one is generated and the file is rewritten.
 * ============================================================================
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { closeDb, rawSql } from "../src/db";
import { assertOperatorTargetSafe } from "../src/dbGuard";
import { hashPassword, registerCore } from "../src/server/authServer";
import { runMigrations } from "./migrate";

/** Clearly-fake identity for the preview login. */
export const PREVIEW_LOGIN_EMAIL = "preview.owner@example.com";
/** The operation name the preview data hangs off — says what it is. */
export const PREVIEW_OPERATION_NAME = "PREVIEW — Sandbox Ranch (fake data)";
/** Where the preview login's password is written (chmod 600, never in git). */
export const PREVIEW_CRED_FILE =
  process.env.PREVIEW_LOGIN_CRED_FILE ?? "/home/team/shared/.local/preview-login.env";
/** The hay stack the browser E2E restocks, and its starting quantity. */
export const PREVIEW_HAY_SOURCE = "PREVIEW — Sandbox hay (fake)";
export const PREVIEW_HAY_START_QTY = 80;
export const PREVIEW_PASTURE_NAMES = [
  "PREVIEW — Sandbox North Pasture",
  "PREVIEW — Sandbox South Pasture",
] as const;
export const PREVIEW_EQUIPMENT_NAME = "PREVIEW — Sandbox pickup (fake)";

const say = (msg: string) => console.log(`[db:seed] ${msg}`);

const generatePassword = (): string => randomBytes(24).toString("base64url");

/** Write the preview credentials to a chmod-600 file. The password is never
 *  logged; only the path is. */
export function writeCredentialFile(path: string, email: string, password: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = [
    "# Ranch Manager Pro — PREVIEW-ONLY login (fake data). Not for production.",
    `PREVIEW_LOGIN_EMAIL=${email}`,
    `PREVIEW_LOGIN_PASSWORD=${password}`,
    "",
  ].join("\n");
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Resolve (or create) the preview login + its fake operation. Idempotent. */
export async function ensurePreviewLogin(
  db: ReturnType<typeof rawSql>,
  password: string
): Promise<{ operationId: number; created: boolean; passwordChanged: boolean }> {
  const existing = await db<{ id: number }[]>`
    SELECT id FROM users WHERE email = ${PREVIEW_LOGIN_EMAIL}`;
  if (existing.length === 0) {
    const res = await registerCore(db, {
      email: PREVIEW_LOGIN_EMAIL,
      password,
      operationName: PREVIEW_OPERATION_NAME,
    });
    if (!res.ok) throw new Error(`could not register the preview login: ${res.error}`);
    return { operationId: res.operationId, created: true, passwordChanged: true };
  }
  const userId = existing[0].id;
  // Re-hash the password through the app's own hasher so the credentials on file
  // always sign in (a re-run rotates a password that was never recorded).
  await db`UPDATE users SET password_hash = ${hashPassword(password)} WHERE id = ${userId}`;
  const membership = await db<{ operation_id: number; name: string }[]>`
    SELECT m.operation_id, o.name FROM operation_memberships m
    JOIN operations o ON o.id = m.operation_id
    WHERE m.user_id = ${userId}
    ORDER BY m.operation_id
    LIMIT 1`;
  if (membership.length > 0) {
    return { operationId: membership[0].operation_id, created: false, passwordChanged: true };
  }
  // Half-created account: finish it the same way registerCore would.
  const [op] = await db<{ id: number }[]>`
    INSERT INTO operations (name) VALUES (${PREVIEW_OPERATION_NAME}) RETURNING id`;
  await db`INSERT INTO operation_memberships (user_id, operation_id, role)
    VALUES (${userId}, ${op.id}, 'owner')`;
  return { operationId: op.id, created: false, passwordChanged: true };
}

type FixtureCounts = {
  hay: number;
  hayReset: boolean;
  restocksRemoved: number;
  linkedExpensesRemoved: number;
  pastures: number;
  equipment: number;
};

/** Create the fake preview fixture and reset its restock state. Idempotent. */
export async function seedPreviewFixture(
  db: ReturnType<typeof rawSql>,
  operationId: number
): Promise<FixtureCounts> {
  // ---- reset ONLY this fake operation's restock state --------------------
  const restockRows = await db<{ id: number }[]>`
    SELECT id FROM restock_log WHERE operation_id = ${operationId}`;
  const linkedExpenses = await db<{ id: number }[]>`
    SELECT id FROM expenses WHERE operation_id = ${operationId} AND source_type = 'restock'`;
  await db`DELETE FROM expenses WHERE operation_id = ${operationId} AND source_type = 'restock'`;
  await db`DELETE FROM restock_log WHERE operation_id = ${operationId}`;

  // ---- the hay stack to restock ------------------------------------------
  const hay = await db<{ id: number }[]>`
    SELECT id FROM hay_inventory
    WHERE operation_id = ${operationId} AND field_or_source = ${PREVIEW_HAY_SOURCE}`;
  let hayId: number;
  if (hay.length === 0) {
    const [row] = await db<{ id: number }[]>`
      INSERT INTO hay_inventory (feed_type, cutting, field_or_source, storage_location, quantity, unit,
                                 bale_weight_lbs, date_acquired, low_stock_threshold, notes, operation_id)
      VALUES ('grass', '2nd', ${PREVIEW_HAY_SOURCE}, 'PREVIEW — Sandbox barn (fake)', ${PREVIEW_HAY_START_QTY},
              'bales', 60, CURRENT_DATE, 20,
              'Fake preview data. The browser E2E restocks this stack; re-running the seed returns it to 80 bales.',
              ${operationId})
      RETURNING id`;
    hayId = row.id;
  } else {
    hayId = hay[0].id;
    await db`UPDATE hay_inventory SET quantity = ${PREVIEW_HAY_START_QTY},
      low_stock_threshold = 20, unit = 'bales', updated_at = now()
      WHERE id = ${hayId} AND operation_id = ${operationId}`;
  }
  // any usage log for the fixture stack would make the reset look wrong
  await db`DELETE FROM usage_log WHERE operation_id = ${operationId} AND hay_item_id = ${hayId}`;

  // ---- 2 pastures --------------------------------------------------------
  const pastureSeeds = [
    { name: PREVIEW_PASTURE_NAMES[0], acres: 40, status: "grazing", soil: "sandy loam" },
    { name: PREVIEW_PASTURE_NAMES[1], acres: 35, status: "resting", soil: "clay loam" },
  ];
  for (const p of pastureSeeds) {
    const found = await db<{ id: number }[]>`
      SELECT id FROM pastures WHERE operation_id = ${operationId} AND name = ${p.name}`;
    if (found.length === 0) {
      await db`
        INSERT INTO pastures (name, size_acres, location, status, soil_type, notes, operation_id)
        VALUES (${p.name}, ${p.acres}, 'PREVIEW — Sandbox (fake)', ${p.status}, ${p.soil},
                'Fake preview paddock — no real location.', ${operationId})`;
    }
  }

  // ---- 1 equipment asset -------------------------------------------------
  const equipment = await db<{ id: number }[]>`
    SELECT id FROM equipment WHERE operation_id = ${operationId} AND name = ${PREVIEW_EQUIPMENT_NAME}`;
  if (equipment.length === 0) {
    await db`
      INSERT INTO equipment (name, category, make, model, year, condition, status, location, fuel_type, notes, operation_id)
      VALUES (${PREVIEW_EQUIPMENT_NAME}, 'truck', 'Sandbox', 'Fake 1500', 2011, 'good', 'in-service',
              'PREVIEW — Sandbox shop (fake)', 'gas', 'Fake preview asset — no real registration or insurance.', ${operationId})`;
  }

  return {
    hay: 1,
    hayReset: true,
    restocksRemoved: restockRows.length,
    linkedExpensesRemoved: linkedExpenses.length,
    pastures: pastureSeeds.length,
    equipment: 1,
  };
}

export async function seed(): Promise<void> {
  const db = rawSql();
  const password = process.env.PREVIEW_LOGIN_PASSWORD?.trim()
    ? process.env.PREVIEW_LOGIN_PASSWORD.trim()
    : generatePassword();
  const login = await ensurePreviewLogin(db, password);
  writeCredentialFile(PREVIEW_CRED_FILE, PREVIEW_LOGIN_EMAIL, password);
  const counts = await seedPreviewFixture(db, login.operationId);
  say(
    `preview fixture ready — operation #${login.operationId} "${PREVIEW_OPERATION_NAME}" ` +
      `(${login.created ? "login created" : "login reused"})`
  );
  say(
    `hay: 1 stack at ${PREVIEW_HAY_START_QTY} bales · pastures: ${counts.pastures} · equipment: ${counts.equipment} · ` +
      `reset ${counts.restocksRemoved} restock(s) and ${counts.linkedExpensesRemoved} linked expense(s)`
  );
  say(`login email: ${PREVIEW_LOGIN_EMAIL} (password written to ${PREVIEW_CRED_FILE}, chmod 600 — never printed)`);
}

// Run directly: `APP_ENV=preview PREVIEW_DATABASE_URL=… bun db/seed.ts`
if (import.meta.main) {
  if (process.env.APP_ENV?.trim() !== "preview") {
    console.error(
      [
        "",
        "[db:seed] REFUSED — this seed may only run against the PREVIEW scratch database.",
        "[db:seed] APP_ENV is " +
          (process.env.APP_ENV ? `"${process.env.APP_ENV}"` : "unset") +
          ". Run it as:",
        "[db:seed]   env -u DATABASE_URL APP_ENV=preview PREVIEW_ENV_EXPECTED=1 \\",
        "[db:seed]     PREVIEW_DATABASE_URL=postgres://user@127.0.0.1:5432/ranch_preview bun run db:seed",
        "[db:seed] Nothing was connected to and no statement was executed.",
        "",
      ].join("\n")
    );
    process.exit(2);
  }
  if (!assertOperatorTargetSafe(process.env, process.argv, "db:seed")) {
    process.exit(2);
  }
  runMigrations()
    .then(seed)
    .then(() => console.log("[db:seed] done"))
    .catch((err) => {
      console.error("seed failed:", err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
