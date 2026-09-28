/**
 * ============================================================================
 * BROWSER E2E — "Restock saves inventory and creates exactly one linked
 * expense, every time" (owner's workflow, driven through the REAL UI).
 *
 *   E2E_BASE_URL=https://…-dev.ctonew.app bun run e2e:restock
 *
 * Runs at the three phone widths the owner asked for (375 / 390 / 430 px) and,
 * per width, proves with a real headless browser:
 *
 *   1. the Add Restock form contains the contract — quantity, unit (a real
 *      control), item, vendor/payee, restock date, a labelled "Total cost paid",
 *      notes/reference, the exact helper text, an "Add linked expense" choice
 *      that is on by default when a cost is entered, and an explicit
 *      "Inventory only — no expense" choice when the cost is blank;
 *   2. the submit label reads "Save restock & add expense" whenever a cost is
 *      present;
 *   3. saving adds EXACTLY 25 bales for the owner's numbers (25 bales /
 *      "Triple C Hay" / today / $312.50) and creates exactly ONE linked expense;
 *   4. that expense is visible in Expenses immediately AND after a refresh;
 *   5. a fast double-submit creates NO duplicate expense and adds the stock once;
 *   6. the "Inventory only — no expense" path creates NO expense at all (never a
 *      silent $0 row);
 *   7. edit updates the SAME expense row (no second row);
 *   8. void reverses the inventory and removes that same expense row.
 *
 * Every claim is checked twice where it matters: in the rendered page (what the
 * owner sees) and in the preview database (what actually happened). It NEVER
 * touches production: it runs against whatever E2E_BASE_URL / PREVIEW_DATABASE_URL
 * point at, and the app's own APP_ENV guard decides which database that is.
 *
 * Credentials come from E2E_EMAIL / E2E_PASSWORD, or from the preview login file
 * written by `bun run db:seed` (PREVIEW_LOGIN_CRED_FILE, chmod 600). The password
 * is never printed.
 * ============================================================================
 */
import { readFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
// NOTE: Playwright is deliberately NOT a dependency of this app. The CI job
// installs it (`bun add -d playwright@1.63.0` + `playwright install chromium`)
// before running this script, and a local run can point E2E_PLAYWRIGHT_MODULE at
// an existing install. Hence the untyped handles here: this file must typecheck
// in a checkout where Playwright is absent.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPage = any;

const BASE_URL = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PROOF_DIR = process.env.E2E_PROOF_DIR ?? "/home/team/shared/proof/restock-e2e";
const CRED_FILE = process.env.PREVIEW_LOGIN_CRED_FILE ?? "/home/team/shared/.local/preview-login.env";
const WIDTHS = (process.env.E2E_WIDTHS ?? "375,390,430")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter((w) => Number.isFinite(w) && w > 0);
/** The owner's own numbers. */
const QTY = 25;
const VENDOR = "Triple C Hay";
const COST = 312.5;
const COST_CENTS = 31250;
const EDITED_QTY = 30;
const EDITED_COST = 350;
const EDITED_COST_CENTS = 35000;

type Evidence = Record<string, string | number | boolean | null>;

const evidence: Evidence[] = [];
const record = (patch: Evidence) => {
  evidence.push(patch);
  console.log(
    `E2E ${Object.entries(patch)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`
  );
};

/** Fail loudly and immediately — never report a pass that was not observed. */
class E2EFailure extends Error {}
const check = (condition: unknown, message: string): void => {
  if (!condition) throw new E2EFailure(message);
};

/** Read the preview env file if the URL was not exported (silent; nothing printed). */
const envFromFile = (key: string): string | undefined => {
  if (process.env[key]) return process.env[key];
  for (const file of [".preview-env", "/home/team/shared/site/.preview-env"]) {
    try {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${key}=`));
      if (line) return line.slice(key.length + 1).trim();
    } catch {
      /* not present — fall through */
    }
  }
  return undefined;
};

const credentials = (): { email: string; password: string } => {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
    return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  }
  const body = readFileSync(CRED_FILE, "utf8");
  const read = (key: string): string => {
    const line = body.split("\n").find((l) => l.startsWith(`${key}=`));
    check(line, `credentials file ${CRED_FILE} has no ${key}`);
    return (line as string).slice(key.length + 1).trim();
  };
  return {
    email: process.env.E2E_EMAIL ?? read("PREVIEW_LOGIN_EMAIL"),
    password: process.env.E2E_PASSWORD ?? read("PREVIEW_LOGIN_PASSWORD"),
  };
};

const today = (): string => new Date().toISOString().slice(0, 10);

// --- preview database handle (assertions only; never printed) --------------
const previewUrl = envFromFile("PREVIEW_DATABASE_URL");
let sql: ReturnType<typeof postgres> | null = null;
const db = () => {
  check(previewUrl, "PREVIEW_DATABASE_URL is not set — pass it or run from the site tree with .preview-env");
  if (!sql) sql = postgres(previewUrl as string, { max: 2, onnotice: () => {} });
  return sql;
};

const fixtureHayId = async (): Promise<number> => {
  const rows = await db()<{ id: number }[]>`
    SELECT h.id FROM hay_inventory h
    WHERE h.field_or_source LIKE 'PREVIEW — %'
    ORDER BY h.id LIMIT 1`;
  check(rows.length === 1, "the preview fixture hay stack was not found (run `bun run db:seed`)");
  return rows[0].id;
};
const hayRow = async (id: number): Promise<{ quantity: number; operation_id: number }> => {
  const rows = await db()<{ quantity: string; operation_id: number }[]>`
    SELECT quantity, operation_id FROM hay_inventory WHERE id = ${id}`;
  check(rows.length === 1, `hay stack ${id} is gone`);
  return { quantity: Number(rows[0].quantity), operation_id: rows[0].operation_id };
};
const linkedExpenses = async (
  operationId: number
): Promise<{ id: number; amount_cents: number; vendor: string | null }[]> =>
  await db()<{ id: number; amount_cents: number; vendor: string | null }[]>`
    SELECT id, amount_cents, vendor FROM expenses
    WHERE operation_id = ${operationId} AND source_type = 'restock'
    ORDER BY id`;
const allExpenses = async (operationId: number): Promise<number> => {
  const rows = await db()<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM expenses WHERE operation_id = ${operationId}`;
  return Number(rows[0].n);
};
const restockCount = async (operationId: number): Promise<number> => {
  const rows = await db()<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM restock_log WHERE operation_id = ${operationId}`;
  return Number(rows[0].n);
};

const main = async () => {
  mkdirSync(PROOF_DIR, { recursive: true });
  const creds = credentials();
  const pwModule = process.env.E2E_PLAYWRIGHT_MODULE ?? "playwright";
  const playwright = (await import(pwModule)) as any;
  const executablePath = process.env.E2E_CHROME_PATH || undefined;
  const browser = await playwright.chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const hayId = await fixtureHayId();
  const start = await hayRow(hayId);
  const opId = start.operation_id;
  record({
    baseUrl: BASE_URL,
    hayId,
    operationId: opId,
    baselineQuantity: start.quantity,
    baselineLinkedExpenses: (await linkedExpenses(opId)).length,
    widths: WIDTHS.join(","),
  });
  check(start.quantity === 80, `expected the seeded fixture at 80 bales, found ${start.quantity} — run \`bun run db:seed\``);
  check((await linkedExpenses(opId)).length === 0, "the preview fixture still has linked restock expenses — run `bun run db:seed`");

  try {
    for (const width of WIDTHS) {
      const height = 812;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      });
      const page = await context.newPage();
      const serverFnCalls: { body: string; status: number; text: string }[] = [];
      page.on("response", async (res: any) => {
        if (!res.url().includes("/_serverFn/")) return;
        try {
          serverFnCalls.push({ body: res.request().postData() ?? "", status: res.status(), text: await res.text() });
        } catch {
          /* body already consumed — the assertions below use the UI + DB */
        }
      });

      // ---- sign in (real login form) -------------------------------------
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.fill("#login-email", creds.email);
      await page.fill("#login-password", creds.password);
      await Promise.all([
        page.waitForURL((u: any) => !u.pathname.startsWith("/login"), { timeout: 30000 }),
        page.click('button[type="submit"]'),
      ]);

      // ---- /feed: the fixture stack and its Restock button ---------------
      await page.goto(`${BASE_URL}/feed`, { waitUntil: "domcontentloaded" });
      const qtyCell = page.locator(`[data-testid="hay-qty-${hayId}"]`);
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const baseline = Number(await qtyCell.getAttribute("data-quantity"));
      check(baseline === 80, `width ${width}: expected 80 bales on the fixture stack, saw ${baseline}`);

      const openRestock = async () => {
        await page.locator(`[data-testid="hay-row-${hayId}"]`).getByRole("button", { name: "Restock" }).click();
        await page.locator('[data-testid="restock-form"]').waitFor({ state: "visible", timeout: 15000 });
      };

      // =====================================================================
      // 1. THE FORM CONTRACT
      // =====================================================================
      await openRestock();
      const formText = (await page.locator('[data-testid="restock-form"]').innerText()).replace(/\s+/g, " ");
      const modalText = (await page.locator('[data-testid="restock-form"]').locator("xpath=ancestor::div[1]").innerText()).replace(/\s+/g, " ");
      const helper = page.locator('[data-testid="restock-cost-helper"]');
      check(
        (await helper.innerText()).trim() === "Saving this restock will add this amount to Expenses.",
        `width ${width}: cost helper text is not the required sentence`
      );
      for (const needle of [
        "Quantity added",
        "Unit",
        "Vendor / payee",
        "Restock date",
        "Total cost paid",
        "Notes / reference",
      ]) {
        const visible = formText.includes(needle) || modalText.includes(needle);
        check(visible, `width ${width}: the form is missing the visible field "${needle}"`);
      }
      check(formText.includes("Add linked expense"), `width ${width}: "Add linked expense" choice is not visible`);
      check(
        formText.includes("Inventory only — no expense"),
        `width ${width}: "Inventory only — no expense" choice is not visible`
      );
      // unit is a REAL control, matching the stack's own unit
      const unitControl = page.locator('[data-testid="restock-unit"]');
      check((await unitControl.evaluate((el: any) => el.tagName)) === "SELECT", `width ${width}: the unit is not a real control`);
      check((await unitControl.inputValue()) === "bales", `width ${width}: the unit control does not show "bales"`);
      // blank cost → inventory-only label (no $0 expense can be created silently)
      const submit = page.locator('[data-testid="restock-submit"]');
      check(
        (await submit.innerText()).trim() === "Save restock (inventory only)",
        `width ${width}: submit label with a blank cost is not the inventory-only label`
      );

      // ---- fill the owner's numbers --------------------------------------
      await page.locator('[data-testid="restock-quantity"]').fill(String(QTY));
      await page.locator('[data-testid="restock-vendor"]').fill(VENDOR);
      const dateInput = page.locator('[data-testid="restock-date"]');
      await dateInput.fill(today());
      await page.locator('[data-testid="restock-cost"]').fill(COST.toFixed(2));
      await page.locator('[data-testid="restock-notes"]').fill(`${QTY} bales — ${VENDOR}`);
      const addExpenseOn = await page
        .locator('[data-testid="restock-add-expense"]')
        .getAttribute("aria-pressed");
      check(addExpenseOn === "true", `width ${width}: "Add linked expense" is not ON by default when a cost is entered`);
      check(
        (await submit.innerText()).trim() === "Save restock & add expense",
        `width ${width}: submit label with a cost is not "Save restock & add expense"`
      );
      await page.screenshot({ path: `${PROOF_DIR}/form-${width}-filled.png`, fullPage: false });

      // =====================================================================
      // 2. SAVE — 25 bales + exactly one linked expense
      // =====================================================================
      serverFnCalls.length = 0;
      await submit.click();
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      const createCall = serverFnCalls.find((c) => c.body.includes("client_request_id"));
      check(createCall, `width ${width}: no restock request was observed`);
      const createJson = JSON.parse(createCall!.text) as { ok: boolean; expense_created: boolean; duplicate: boolean };
      check(createJson.ok === true, `width ${width}: the save returned an error: ${createCall!.text.slice(0, 200)}`);
      check(createJson.expense_created === true, `width ${width}: the save did not create the linked expense`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterCreate = Number(await qtyCell.getAttribute("data-quantity"));
      const afterCreateDb = await hayRow(hayId);
      const restocksAfterCreate = await restockCount(opId);
      const expensesAfterCreate = await linkedExpenses(opId);
      check(afterCreate === baseline + QTY, `width ${width}: UI inventory ${afterCreate} != ${baseline + QTY}`);
      check(afterCreateDb.quantity === baseline + QTY, `width ${width}: DB inventory ${afterCreateDb.quantity} != ${baseline + QTY}`);
      check(restocksAfterCreate === 1, `width ${width}: expected exactly 1 restock row, saw ${restocksAfterCreate}`);
      check(expensesAfterCreate.length === 1, `width ${width}: expected exactly 1 linked expense, saw ${expensesAfterCreate.length}`);
      check(expensesAfterCreate[0].amount_cents === COST_CENTS, `width ${width}: linked expense is not $312.50`);
      check(expensesAfterCreate[0].vendor === VENDOR, `width ${width}: linked expense vendor is not "${VENDOR}"`);
      const expenseId = expensesAfterCreate[0].id;
      const restockRow = page.locator('[data-testid^="restock-row-"]').first();
      check((await restockRow.count()) === 1, `width ${width}: the restock history does not show exactly one entry`);
      check(
        (await restockRow.locator('[data-testid="restock-cost"]').getAttribute("data-cost-cents")) === String(COST_CENTS),
        `width ${width}: the history row does not show the $312.50 cost`
      );

      // ---- Expenses shows it immediately, and after a refresh -------------
      await page.goto(`${BASE_URL}/expenses`, { waitUntil: "domcontentloaded" });
      const linkedRow = page.locator(`[data-testid="expense-row-${expenseId}"]`);
      await linkedRow.waitFor({ state: "visible", timeout: 30000 });
      check(
        (await linkedRow.locator('[data-testid="expense-amount"]').getAttribute("data-amount-cents")) === String(COST_CENTS),
        `width ${width}: the Expenses row does not show $312.50`
      );
      check(
        (await linkedRow.locator('[data-testid="expense-vendor"]').innerText()).includes(VENDOR),
        `width ${width}: the Expenses row does not show the vendor`
      );
      await page.screenshot({ path: `${PROOF_DIR}/expenses-${width}.png`, fullPage: false });
      const visibleLinkedRows = await page.locator('[data-testid^="expense-row-"][data-linked="true"]').count();
      check(visibleLinkedRows === 1, `width ${width}: expected exactly 1 linked ledger row, saw ${visibleLinkedRows}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await linkedRow.waitFor({ state: "visible", timeout: 30000 });
      check(
        (await linkedRow.locator('[data-testid="expense-amount"]').getAttribute("data-amount-cents")) === String(COST_CENTS),
        `width ${width}: the ledger row did not survive a refresh`
      );
      record({
        width,
        step: "create",
        baselineQuantity: baseline,
        afterCreateQuantity: afterCreate,
        afterCreateDbQuantity: afterCreateDb.quantity,
        restockRows: restocksAfterCreate,
        linkedExpenses: expensesAfterCreate.length,
        linkedExpenseId: expenseId,
        linkedAmountCents: expensesAfterCreate[0].amount_cents,
        expenseVisibleAfterRefresh: true,
      });

      // =====================================================================
      // 3. FAST DOUBLE-SUBMIT — no duplicate expense, stock added once
      // =====================================================================
      await page.goto(`${BASE_URL}/feed`, { waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await openRestock();
      await page.locator('[data-testid="restock-quantity"]').fill("10");
      await page.locator('[data-testid="restock-cost"]').fill("99.00");
      await page.locator('[data-testid="restock-vendor"]').fill("Double Tap Hay");
      const beforeDouble = baseline + QTY;
      await page.evaluate(() => {
        const form = document.querySelector('[data-testid="restock-form"]') as HTMLFormElement | null;
        if (!form) throw new Error("restock form missing");
        form.requestSubmit();
        form.requestSubmit();
      });
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterDouble = Number(await qtyCell.getAttribute("data-quantity"));
      const dbAfterDouble = await hayRow(hayId);
      const restocksAfterDouble = await restockCount(opId);
      const expensesAfterDouble = await linkedExpenses(opId);
      const doubleTapExpenses = expensesAfterDouble.filter((e) => e.vendor === "Double Tap Hay");
      check(afterDouble === beforeDouble + 10, `width ${width}: double-submit added ${afterDouble - beforeDouble} instead of 10`);
      check(dbAfterDouble.quantity === beforeDouble + 10, `width ${width}: DB inventory double-counted the restock`);
      check(restocksAfterDouble === 2, `width ${width}: double-submit created ${restocksAfterDouble - 1} extra restock rows`);
      check(doubleTapExpenses.length === 1, `width ${width}: double-submit created ${doubleTapExpenses.length} expenses instead of 1`);
      const duplicateReplies = serverFnCalls.filter((c) => c.body.includes("client_request_id"));
      record({
        width,
        step: "double-submit",
        requestsObserved: duplicateReplies.length,
        quantityBefore: beforeDouble,
        quantityAfter: afterDouble,
        restockRows: restocksAfterDouble,
        expensesForThatRestock: doubleTapExpenses.length,
      });
      // clean up the double-submit restock through the UI (void)
      await voidRestock(page);
      const afterVoidDouble = await hayRow(hayId);
      check(afterVoidDouble.quantity === beforeDouble, `width ${width}: voiding the double-submit restock did not restore the count`);

      // =====================================================================
      // 4. INVENTORY ONLY — no expense of any kind
      // =====================================================================
      await page.goto(`${BASE_URL}/feed`, { waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const expensesBeforeInventoryOnly = await allExpenses(opId);
      await openRestock();
      await page.locator('[data-testid="restock-quantity"]').fill("10");
      const costField = page.locator('[data-testid="restock-cost"]');
      await costField.fill("99.00");
      await costField.fill(""); // blank cost → the explicit inventory-only choice takes over
      check(
        (await page.locator('[data-testid="restock-inventory-only"]').getAttribute("aria-pressed")) === "true",
        `width ${width}: a blank cost did not select "Inventory only — no expense"`
      );
      check(
        (await submit.innerText()).trim() === "Save restock (inventory only)",
        `width ${width}: blank-cost submit label is not the inventory-only label`
      );
      await page.screenshot({ path: `${PROOF_DIR}/form-${width}-inventory-only.png`, fullPage: false });
      await submit.click();
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterInventoryOnly = Number(await qtyCell.getAttribute("data-quantity"));
      const expensesAfterInventoryOnly = await allExpenses(opId);
      check(afterInventoryOnly === beforeDouble + 10, `width ${width}: inventory-only restock did not add 10 bales`);
      check(
        expensesAfterInventoryOnly === expensesBeforeInventoryOnly,
        `width ${width}: the inventory-only path created an expense (${expensesBeforeInventoryOnly} → ${expensesAfterInventoryOnly})`
      );
      record({
        width,
        step: "inventory-only",
        expensesBefore: expensesBeforeInventoryOnly,
        expensesAfter: expensesAfterInventoryOnly,
        quantityAfter: afterInventoryOnly,
      });
      await voidRestock(page);
      check((await hayRow(hayId)).quantity === beforeDouble, `width ${width}: inventory-only void did not restore the count`);

      // =====================================================================
      // 5. EDIT — the SAME expense row is updated
      // =====================================================================
      await page.goto(`${BASE_URL}/feed`, { waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await page.locator('[data-testid^="restock-row-"]').first().getByRole("button", { name: "Edit" }).click();
      const editForm = page.locator('[data-testid="restock-edit-form"]');
      await editForm.waitFor({ state: "visible", timeout: 15000 });
      await page.locator('[data-testid="restock-edit-quantity"]').fill(String(EDITED_QTY));
      await page.locator('[data-testid="restock-edit-cost"]').fill(EDITED_COST.toFixed(2));
      await page.locator('[data-testid="restock-edit-vendor"]').fill(VENDOR);
      await page.screenshot({ path: `${PROOF_DIR}/edit-${width}.png`, fullPage: false });
      await page.locator('[data-testid="restock-edit-submit"]').click();
      await editForm.waitFor({ state: "detached", timeout: 20000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterEdit = Number(await qtyCell.getAttribute("data-quantity"));
      const expensesAfterEdit = await linkedExpenses(opId);
      check(afterEdit === baseline + EDITED_QTY, `width ${width}: edit left inventory at ${afterEdit}`);
      check(expensesAfterEdit.length === 1, `width ${width}: edit produced ${expensesAfterEdit.length} rows instead of 1`);
      check(expensesAfterEdit[0].id === expenseId, `width ${width}: edit created a DIFFERENT expense row`);
      check(expensesAfterEdit[0].amount_cents === EDITED_COST_CENTS, `width ${width}: edit did not update the amount`);
      await page.goto(`${BASE_URL}/expenses`, { waitUntil: "domcontentloaded" });
      const editedRow = page.locator(`[data-testid="expense-row-${expenseId}"]`);
      await editedRow.waitFor({ state: "visible", timeout: 30000 });
      check(
        (await editedRow.locator('[data-testid="expense-amount"]').getAttribute("data-amount-cents")) === String(EDITED_COST_CENTS),
        `width ${width}: Expenses still shows the old amount after the edit`
      );
      record({
        width,
        step: "edit",
        expenseIdBefore: expenseId,
        expenseIdAfter: expensesAfterEdit[0].id,
        amountBefore: COST_CENTS,
        amountAfter: expensesAfterEdit[0].amount_cents,
        quantityAfter: afterEdit,
      });

      // =====================================================================
      // 6. VOID — inventory reversed, the same expense removed
      // =====================================================================
      await page.goto(`${BASE_URL}/feed`, { waitUntil: "domcontentloaded" });
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await voidRestock(page);
      const afterVoid = await hayRow(hayId);
      const restocksAfterVoid = await restockCount(opId);
      const expensesAfterVoid = await linkedExpenses(opId);
      const totalExpensesAfterVoid = await allExpenses(opId);
      check(afterVoid.quantity === baseline, `width ${width}: void left inventory at ${afterVoid.quantity}, expected ${baseline}`);
      check(restocksAfterVoid === 0, `width ${width}: void left ${restocksAfterVoid} restock rows`);
      check(expensesAfterVoid.length === 0, `width ${width}: void left ${expensesAfterVoid.length} linked expenses`);
      check(totalExpensesAfterVoid === 0, `width ${width}: void left ${totalExpensesAfterVoid} expenses in the ledger`);
      record({
        width,
        step: "void",
        quantityAfterVoid: afterVoid.quantity,
        restockRowsAfterVoid: restocksAfterVoid,
        linkedExpensesAfterVoid: expensesAfterVoid.length,
        ledgerExpensesAfterVoid: totalExpensesAfterVoid,
        expenseRowRemoved: expenseId,
      });

      await context.close();
    }
    record({ result: "PASS", widths: WIDTHS.join(",") });
    console.log(`\nE2E evidence written to ${PROOF_DIR}`);
  } finally {
    await browser.close();
    if (sql) await sql.end({ timeout: 5 });
  }
};

/** Click Void on the newest restock row and confirm. */
const voidRestock = async (page: AnyPage) => {
  const row = page.locator('[data-testid^="restock-row-"]').first();
  check((await row.count()) > 0, "expected a restock row to void");
  await row.getByRole("button", { name: "Void" }).click();
  await page.locator('[data-testid="restock-void-confirm"]').click();
  await page.locator('[data-testid="restock-void-confirm"]').waitFor({ state: "detached", timeout: 20000 });
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\nE2E FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    console.error("evidence so far:", JSON.stringify(evidence, null, 2));
    process.exit(1);
  }
);
