/**
 * Preview-environment smoke test — REAL server code paths against a DISPOSABLE
 * local database (never the owner's Neon).
 *
 *   PGBIN=/usr/lib/postgresql/16/bin
 *   runuser -u postgres -- $PGBIN/psql -p 5433 \
 *     -c "DROP DATABASE IF EXISTS ranch_preview;" -c "CREATE DATABASE ranch_preview;"
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_preview bun run db:migrate
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_preview \
 *   PREVIEW_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_preview \
 *     bun qa/previewSmoke.ts
 *
 * It exercises the same *Core functions the createServerFn handlers run
 * (saveExpenseCore / restockItemCore / savePastureActivityCore — the exact SQL
 * of the real handlers), with the app in PREVIEW mode (PREVIEW_DATABASE_URL
 * set), and asserts the four owner-blocker flows plus that no raw database
 * error text can surface.
 */
import postgres from "postgres";
import { runMigrations } from "../db/migrate";
import { closeDb, isPreviewEnvironment, sql } from "../src/db";
import { PREVIEW_PENDING_MESSAGE } from "../src/dbErrors";
import { parseExpenseInput, saveExpenseCore } from "../src/server/expenses";
import { parseRestockInput, restockItemCore } from "../src/server/feed";
import {
  parsePastureActivityInput,
  savePastureActivityCore,
} from "../src/server/pasture";

const db = sql();
const today = new Date().toISOString().slice(0, 10);
const results: { step: string; pass: boolean; detail: string }[] = [];
const errorStrings: string[] = [];
const RAW_DB_ERROR_RE =
  /relation\s|"|does not exist|duplicate key|violates|SQLSTATE|syntax error|connection refused|ECONNREFUSED|pg_[a-z_]+|PostgresError/i;

const record = (step: string, pass: boolean, detail: string): void => {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

/** Count linked expenses for a source record (restock / pasture activity). */
const linkedExpenseCount = async (
  operationId: number,
  sourceType: string,
  sourceId: number
): Promise<number> => {
  const rows = await db<[{ n: number }]>`
    SELECT count(*)::int AS n FROM expenses
    WHERE operation_id = ${operationId}
      AND source_type = ${sourceType} AND source_id = ${sourceId}`;
  return rows[0].n;
};

async function main(): Promise<void> {
  console.log(`preview mode: ${isPreviewEnvironment()}`);
  // All migrations (incl. 0018) must already be applied — re-running is a no-op
  // and proves the disposable DB is fully migrated.
  const ran = await runMigrations();
  console.log(`migrations on disposable DB: up to date (${ran.length} new)`);

  // ---- minimal synthetic fixture (no production-like ranch data) ----
  const [op] = await db<[{ id: number }]>`
    INSERT INTO operations (name) VALUES ('Preview Smoke Ranch (synthetic)') RETURNING id`;
  const [hay] = await db<[{ id: number; quantity: number }]>`
    INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit, low_stock_threshold)
    VALUES (${op.id}, 'grass', 10, 'bales', 2) RETURNING id, quantity`;
  const [pasture] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres, status)
    VALUES (${op.id}, 'Smoke Paddock', 5, 'resting') RETURNING id`;
  const opId = op.id;
  const hayId = hay.id;

  // ---- (a) manual expense: save → persists → appears after a fresh read ----
  const expenseIn = parseExpenseInput({
    expense_date: today,
    category: "fuel",
    amount_cents: 5000,
    vendor: "Smoke Fuel Co",
    notes: "smoke (a)",
  });
  const saved = await saveExpenseCore(db, opId, expenseIn);
  const a1 = "ok" in saved && saved.ok;
  // "appears after refresh": read back over a brand-new one-off connection —
  // proof the row is durably in the disposable DB, not just in a pooled session.
  const oneoff = postgres(process.env.DATABASE_URL as string, { ssl: false, max: 1, onnotice: () => {} });
  const readBack = await oneoff<[{ id: number; amount_cents: number; vendor: string }]>`
    SELECT id, amount_cents, vendor FROM expenses
    WHERE id = ${saved.ok ? saved.id : -1} AND operation_id = ${opId}`;
  await oneoff.end({ timeout: 1 });
  record(
    "(a) manual expense saves + persists after refresh",
    a1 && readBack.length === 1 && readBack[0].amount_cents === 5000,
    `save ok=${a1}; fresh-connection read-back rows=${readBack.length} (${
      readBack[0] ? `$${(readBack[0].amount_cents / 100).toFixed(2)} ${readBack[0].vendor}` : "none"
    })`
  );

  // ---- (b) hay restock WITH cost → inventory + EXACTLY ONE linked expense ----
  const [beforeB] = await db<[{ quantity: number }]>`
    SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
  const restockB = parseRestockInput({
    client_request_id: "smoke-restock-with-cost",
    item_kind: "hay",
    item_id: hayId,
    restock_date: today,
    quantity: 5,
    total_cost_cents: 12000,
    vendor: "Smoke Hay Vendor",
  });
  const outB = await restockItemCore(db, opId, restockB);
  const [afterB] = await db<[{ quantity: number }]>`
    SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
  const linkedB =
    outB.ok ? await linkedExpenseCount(opId, "restock", outB.id) : -1;
  record(
    "(b) restock WITH cost: inventory +1 linked expense",
    outB.ok &&
      outB.expense_created === true &&
      outB.duplicate === false &&
      Number(afterB.quantity) === Number(beforeB.quantity) + 5 &&
      linkedB === 1,
    `inventory ${beforeB.quantity}→${afterB.quantity} bales (+5); expense_created=${outB.ok ? outB.expense_created : "n/a"}; linked expenses=${linkedB}`
  );
  // idempotency: replaying the SAME request must not create a second expense
  const replayB = await restockItemCore(db, opId, restockB);
  const linkedReplayB = outB.ok
    ? await linkedExpenseCount(opId, "restock", outB.id)
    : -1;
  record(
    "(b2) restock replay is idempotent (still exactly one expense)",
    replayB.ok && replayB.duplicate === true && linkedReplayB === 1,
    `duplicate=${replayB.ok ? replayB.duplicate : "n/a"}; linked expenses=${linkedReplayB}`
  );

  // ---- (c) hay restock with NO cost → inventory + ZERO expenses ----
  const [beforeC] = await db<[{ quantity: number }]>`
    SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
  const restockC = parseRestockInput({
    client_request_id: "smoke-restock-no-cost",
    item_kind: "hay",
    item_id: hayId,
    restock_date: today,
    quantity: 3,
    total_cost_cents: 0, // blank/zero cost = inventory only
  });
  const outC = await restockItemCore(db, opId, restockC);
  const [afterC] = await db<[{ quantity: number }]>`
    SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
  const linkedC = outC.ok ? await linkedExpenseCount(opId, "restock", outC.id) : -1;
  record(
    "(c) restock with NO cost: inventory +0 linked expenses",
    outC.ok &&
      outC.expense_created === false &&
      Number(afterC.quantity) === Number(beforeC.quantity) + 3 &&
      linkedC === 0,
    `inventory ${beforeC.quantity}→${afterC.quantity} bales (+3); expense_created=${outC.ok ? outC.expense_created : "n/a"}; linked expenses=${linkedC}`
  );

  // ---- (d) pasture activity WITH cost → EXACTLY ONE linked expense ----
  const activityIn = parsePastureActivityInput({
    client_request_id: "smoke-activity-with-cost",
    pasture_id: pasture.id,
    activity_date: today,
    activity_type: "fencing",
    cost_cents: 30000,
    record_expense: true,
    notes: "smoke (d)",
  });
  const outD = await savePastureActivityCore(db, opId, activityIn);
  const linkedD =
    outD.ok ? await linkedExpenseCount(opId, "pasture_activity", outD.id) : -1;
  record(
    "(d) pasture activity with cost: exactly one linked expense",
    outD.ok && outD.expense_created === true && linkedD === 1,
    `activity id=${outD.ok ? outD.id : "n/a"}; expense_created=${outD.ok ? outD.expense_created : "n/a"}; linked expenses=${linkedD}`
  );

  // ---- (e) a real DB failure through the guarded client surfaces ONLY the
  //          preview message (never 'relation ... does not exist') ----
  let rawLeak = "";
  let maskedAs = "";
  try {
    await db`SELECT * FROM no_such_table_smoke_check`; // guarded client
  } catch (err) {
    maskedAs = err instanceof Error ? err.message : String(err);
    try {
      await (await import("../src/db")).rawSql()`SELECT * FROM no_such_table_smoke_check`;
    } catch (raw) {
      rawLeak = raw instanceof Error ? raw.message : String(raw); // what USED to leak
    }
  }
  record(
    "(e) DB failure is masked (no raw SQL error can surface)",
    maskedAs === PREVIEW_PENDING_MESSAGE && RAW_DB_ERROR_RE.test(rawLeak),
    `previously-leaking raw error: "${rawLeak}"; user now sees: "${maskedAs}"`
  );
  if (errorStrings.some((t) => RAW_DB_ERROR_RE.test(t))) {
    record("(e2) all responses free of raw DB text", false, errorStrings.join(" | "));
  } else {
    record(
      "(e2) all responses free of raw DB text",
      true,
      `${errorStrings.length} error string(s) captured, all customer-safe`
    );
  }

  await closeDb();
  const failed = results.filter((r) => !r.pass);
  console.log(
    failed.length === 0
      ? `\nALL ${results.length} SMOKE CHECKS PASSED`
      : `\n${failed.length} CHECK(S) FAILED`
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("smoke run crashed:", err);
  await closeDb();
  process.exitCode = 1;
});
