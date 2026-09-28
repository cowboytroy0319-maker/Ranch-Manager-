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
 *   5. a REAL double tap — one filled form submitted twice, so both requests
 *      carry the same client_request_id — adds the new stock ONCE and creates
 *      NO duplicate expense (the two request bodies and their ids are written
 *      to double-tap-<width>-requests.json as evidence);
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
 *
 * EVIDENCE LAYOUT (E2E_PROOF_DIR, default /home/team/shared/proof/restock-e2e):
 * every run writes into its own `run-<UTC stamp>-<pid>/` directory and NOTHING
 * is ever deleted, so a later run, a re-run of a single width, or a crash can
 * only add to the proof set. The run prints `E2E proof=<file> bytes=<n> md5=<h>`
 * for every artefact, writes `manifest.json`, and FAILS if any artefact it
 * printed is missing or empty on disk, or if a file present before the run is
 * gone afterwards. `LATEST.txt` names the newest run directory.
 * ============================================================================
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import postgres from "postgres";
// NOTE: Playwright is deliberately NOT a dependency of this app. The CI job
// installs it (`bun add -d playwright@1.63.0` + `playwright install chromium`)
// before running this script, and a local run can point E2E_PLAYWRIGHT_MODULE at
// an existing install. Hence the untyped handles here: this file must typecheck
// in a checkout where Playwright is absent.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPage = any;

const BASE_URL = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

/**
 * ============================================================================
 * EVIDENCE THAT A LATER — OR FAILED — RUN CANNOT DESTROY.
 *
 * The proof set IS the deliverable: the owner asks for the screenshots, so a
 * run that loses them has failed no matter what it printed. Two rules follow.
 *
 *   1. Each run writes into its OWN directory — `<E2E_PROOF_DIR>/run-<stamp>`.
 *      Nothing is ever deleted or overwritten, so a second run, a re-run of one
 *      width, or a crash halfway through can only ever ADD evidence. (A flat
 *      layout is what lost an earlier proof set: one file per width meant the
 *      next run reused the same paths.)
 *   2. The run refuses to pass unless every artefact it wrote is still on disk,
 *      non-empty, and every file that existed before it started still exists
 *      afterwards. A wiped evidence directory is a FAILED run, not a detail.
 * ============================================================================
 */
const PROOF_ROOT = process.env.E2E_PROOF_DIR ?? "/home/team/shared/proof/restock-e2e";
const RUN_ID =
  process.env.E2E_RUN_ID ??
  `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${process.pid}`;
const PROOF_DIR = join(PROOF_ROOT, `run-${RUN_ID}`);
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
const startedAtIso = new Date().toISOString();
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

// --- evidence bookkeeping ---------------------------------------------------
/** Every file this run wrote, in write order (absolute paths). */
const artifacts: string[] = [];

/** List every file under a directory, recursively and relatively, or [] if absent. */
const listFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(relative(PROOF_ROOT, full));
  }
  return out.sort();
};

const shot = async (page: AnyPage, name: string): Promise<string> => {
  const path = join(PROOF_DIR, name);
  await page.screenshot({ path, fullPage: false });
  artifacts.push(path);
  return path;
};

const writeEvidence = (name: string, body: string): string => {
  const path = join(PROOF_DIR, name);
  writeFileSync(path, body);
  artifacts.push(path);
  return path;
};

const md5 = (path: string): string => createHash("md5").update(readFileSync(path)).digest("hex");

/**
 * The last thing a passing run does: prove ON DISK that the evidence it just
 * printed really exists, and that nothing that was there before it is gone.
 * Either failure means the run FAILS — a proof set nobody can open is not a
 * proof set, and a wiped evidence directory is not an acceptable outcome.
 */
const verifyEvidence = (preExisting: string[]): void => {
  const rows: string[] = [];
  for (const path of artifacts) {
    const rel = relative(PROOF_ROOT, path);
    check(existsSync(path), `evidence ${rel} was printed but is NOT on disk`);
    const size = statSync(path).size;
    check(size > 0, `evidence ${rel} is on disk but EMPTY`);
    rows.push(`E2E proof=${rel} bytes=${size} md5=${md5(path)}`);
  }
  for (const rel of preExisting) {
    check(
      existsSync(join(PROOF_ROOT, rel)),
      `this run DESTROYED evidence written earlier: ${rel} is gone from ${PROOF_ROOT}`
    );
  }
  const manifest = {
    runId: RUN_ID,
    startedAt: startedAtIso,
    baseUrl: BASE_URL,
    widths: WIDTHS.join(","),
    proofDir: PROOF_DIR,
    artifacts: artifacts.map((p) => ({
      file: relative(PROOF_ROOT, p),
      bytes: statSync(p).size,
      md5: md5(p),
    })),
    preExistingArtifacts: preExisting,
  };
  const manifestPath = writeEvidence("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  rows.push(
    `E2E proof=${relative(PROOF_ROOT, manifestPath)} bytes=${statSync(manifestPath).size} md5=${md5(
      manifestPath
    )}`
  );
  // A single, stable pointer for a human: the newest run directory. Never
  // evidence itself, so overwriting it can lose nothing.
  writeFileSync(join(PROOF_ROOT, "LATEST.txt"), `${PROOF_DIR}\n`);
  for (const row of rows) console.log(row);
  console.log(
    `E2E evidence verified on disk: ${artifacts.length} file(s) in ${PROOF_DIR}; ` +
      `${preExisting.length} earlier file(s) still present under ${PROOF_ROOT}`
  );
};

/**
 * Is React genuinely attached to this document?
 *
 * A dev-server page is served and painted well before its client JS runs. A tap
 * in that window is handled by the BROWSER, not the app: the form does a native
 * GET submit and the app's own onSubmit never fires, which looks exactly like a
 * failed sign-in ("/login?" with no error and no server-function call). React
 * marks the host nodes it has committed to with `__reactFiber$…` AND
 * `__reactProps$…`; an un-hydrated document has neither. Waiting for that pair
 * is a real signal, not a sleep, so it holds on a cold CI runner too.
 */
const HYDRATED = (): boolean =>
  Array.from(document.querySelectorAll("body *")).some((el) => {
    const keys = Object.keys(el);
    return keys.some((k) => k.startsWith("__reactFiber$")) && keys.some((k) => k.startsWith("__reactProps$"));
  });

const isHydrated = async (page: AnyPage, timeoutMs: number): Promise<boolean> =>
  await page
    .waitForFunction(HYDRATED, null, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);

/** Reload and wait until the FRESH document is interactive again — never a sleep. */
const reloadHydrated = async (page: AnyPage): Promise<number> => {
  let last = "never attempted";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (err) {
      last = `reload failed: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (await isHydrated(page, 45000)) return attempt;
    last = "the reloaded document never became interactive within 45s";
    console.log(`E2E hydration retry: ${last} (attempt ${attempt}/3)`);
  }
  throw new E2EFailure(`the page was never interactive after a reload — ${last}`);
};

/**
 * Navigate until the page is INTERACTIVE — never a fixed sleep.
 *
 * The first request for a route on a cold dev server compiles that route, so
 * hydration can lag the paint by tens of seconds (this is exactly what failed
 * the CI browser step: the document rendered, but React was not attached yet,
 * and the tap fell through to a native browser submit). Reloading and waiting
 * again is what a person does with a slow page; the alternative — swallowing a
 * timeout and clicking anyway — silently tests the wrong thing.
 */
const gotoHydrated = async (page: AnyPage, url: string, label: string): Promise<number> => {
  let last = "never attempted";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (err) {
      last = `navigation failed: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (await isHydrated(page, 45000)) {
      if (attempt > 1) record({ step: "hydrated-after-retry", page: label, attempts: attempt });
      return attempt;
    }
    last = `${label} rendered but React never hydrated it within 45s`;
    console.log(`E2E hydration retry: ${last} (attempt ${attempt}/3) — loading it again`);
  }
  throw new E2EFailure(`${label} was never interactive after 3 loads — ${last}`);
};

/**
 * Sign in on a page that is genuinely interactive, and RETRY ONCE if the tap
 * was handled by the browser instead of the app.
 *
 * A pre-hydration tap produces a native GET submit: the browser reloads
 * "/login?" with no query, no error and no server-function call — which is
 * indistinguishable from a wrong password if you only look at the URL. It is
 * detectable, though: the click caused a full document navigation, or the URL
 * kept a "?" with nothing after it. On that evidence the run reloads, waits for
 * hydration again and taps once more. A real sign-in failure still fails, with
 * the URL, whether it looked like a native submit, and the page's own text.
 */
const signIn = async (
  page: AnyPage,
  width: number,
  creds: { email: string; password: string }
): Promise<void> => {
  const navigations: string[] = [];
  const onNav = (frame: AnyPage) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  };
  page.on("framenavigated", onNav);
  try {
    await gotoHydrated(page, `${BASE_URL}/login`, "the sign-in page");
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.fill("#login-email", creds.email);
      await page.fill("#login-password", creds.password);
      const loginsBefore = navigations.length;
      await page.click('button[type="submit"]');
      try {
        await page.waitForURL((u: AnyPage) => !u.pathname.startsWith("/login"), { timeout: 45000 });
        if (attempt > 1) {
          record({ width, step: "login-retry", attempt, outcome: "signed in on the retry", url: page.url() });
        }
        return;
      } catch (err) {
        const url = page.url();
        // Two shapes of native submit: the browser reloaded the document
        // ("/login?"), or nothing at all happened because React never attached
        // the handler. Either way the app's own onSubmit did not run.
        const reloaded = navigations.length > loginsBefore;
        const nativeSubmit = reloaded || url.includes("?");
        const bodyText = await page
          .evaluate(() => String(document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
          .catch(() => "");
        if (attempt === 2) {
          throw new E2EFailure(
            `width ${width}: could not sign in — still at ${url} after 2 attempts. ` +
              `Native-submit detected: ${nativeSubmit} (full page navigation during the click: ${reloaded}). ` +
              `The sign-in page said: "${bodyText}". ` +
              `Underlying error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        record({
          width,
          step: "login-native-submit",
          url,
          fullPageNavigationDuringClick: reloaded,
          action: "reloading and retrying once on a hydrated page",
        });
        await gotoHydrated(page, `${BASE_URL}/login`, "the sign-in page (retry)");
      }
    }
  } finally {
    page.off("framenavigated", onNav);
  }
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
  // Whatever is already under the proof root belongs to earlier runs and must
  // survive this one (checked again in verifyEvidence before the run may pass).
  const preExisting = listFiles(PROOF_ROOT).filter((rel) => !rel.startsWith(`run-${RUN_ID}/`));
  console.log(
    `E2E run=${RUN_ID} proofDir=${PROOF_DIR} earlierArtifactsUnderRoot=${preExisting.length}`
  );
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
      // A dev-server module compiles on first use. Playwright's 30s default is
      // tight for a cold build, so give every action 45s and let the few waits
      // that need longer say so explicitly.
      page.setDefaultTimeout(45000);
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
      await signIn(page, width, creds);

      // ---- /feed: the fixture stack and its Restock button ---------------
      await gotoHydrated(page, `${BASE_URL}/feed`, "the /feed page");
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
      //
      // EVERY form-field locator below is scoped to '[data-testid="restock-form"]'.
      // Once one restock exists, the history row on the same page renders its own
      // `restock-cost` / `restock-vendor` / … value spans, so an unscoped
      // `[data-testid="restock-cost"]` resolves to TWO elements and Playwright's
      // strict mode fails the run on a perfectly correct app. Scoping keeps the
      // assertion pointed at the control the user is typing into.
      // =====================================================================
      await openRestock();
      const formText = (await page.locator('[data-testid="restock-form"]').innerText()).replace(/\s+/g, " ");
      const helper = page.locator('[data-testid="restock-form"] [data-testid="restock-cost-helper"]');
      check(
        (await helper.innerText()).trim() === "Saving this restock will add this amount to Expenses.",
        `width ${width}: cost helper text is not the required sentence`
      );

      // ---------------------------------------------------------------------
      // THE FIELD LABELS, read from the RENDERED DOM rather than from the source.
      //
      // Why both `textContent` and `innerText`: the form's field labels carry the
      // app's shared `uppercase` class, and `innerText` reports text AS RENDERED,
      // so a user sees "QUANTITY ADDED (BALES) *" while the markup says
      // "Quantity added (bales) *" — the same words, cased by CSS. A case-sensitive
      // substring test against `innerText` therefore failed on a form that is
      // perfectly correct (the earlier run's `the form is missing the visible field
      // "Quantity added"`). CSS can change a label's CASE, never its words, so the
      // assertion below is unchanged in strength: a `<label>` element must exist
      // whose markup begins with the exact required words AND whose rendered text a
      // real user can read. Both halves are checked separately so a failure says
      // which one broke. The rendered labels are recorded as evidence.
      // ---------------------------------------------------------------------
      type RenderedLabel = { source: string; rendered: string };
      const fieldLabels: RenderedLabel[] = await page
        .locator('[data-testid="restock-form"]')
        .locator("xpath=ancestor::div[1]")
        .locator("label")
        .evaluateAll((els: any[]) =>
          els.map((el: any) => ({
            source: String(el.textContent ?? "").replace(/\s+/g, " ").trim(),
            rendered: String(el.innerText ?? "").replace(/\s+/g, " ").trim(),
          }))
        );
      check(fieldLabels.length > 0, `width ${width}: the restock form renders no field labels at all`);
      record({
        width,
        step: "form-labels",
        labelCount: fieldLabels.length,
        renderedLabels: fieldLabels.map((l) => l.rendered).join(" | "),
      });
      for (const needle of [
        "Quantity added",
        "Unit",
        "Vendor / payee",
        "Restock date",
        "Total cost paid",
        "Notes / reference",
      ]) {
        const inMarkup = fieldLabels.some((l) => l.source.toLowerCase().startsWith(needle.toLowerCase()));
        check(inMarkup, `width ${width}: no field label in the form markup begins "${needle}"`);
        const visible = fieldLabels.some((l) => l.rendered.toLowerCase().startsWith(needle.toLowerCase()));
        check(
          visible,
          `width ${width}: the field label "${needle}" is in the markup but not visible to a user ` +
            `(rendered labels: ${fieldLabels.map((l) => l.rendered).join(" | ")})`
        );
      }
      check(formText.includes("Add linked expense"), `width ${width}: "Add linked expense" choice is not visible`);
      check(
        formText.includes("Inventory only — no expense"),
        `width ${width}: "Inventory only — no expense" choice is not visible`
      );
      // unit is a REAL control, matching the stack's own unit
      const unitControl = page.locator('[data-testid="restock-form"] [data-testid="restock-unit"]');
      check((await unitControl.evaluate((el: any) => el.tagName)) === "SELECT", `width ${width}: the unit is not a real control`);
      check((await unitControl.inputValue()) === "bales", `width ${width}: the unit control does not show "bales"`);
      // blank cost → inventory-only label (no $0 expense can be created silently)
      //
      // The submit button is NOT a descendant of the <form>: it lives in the
      // modal's footer and is wired to the form by `form="restock-form"`
      // (FeedModals.tsx:654-657). It therefore stays UNSCOPED — and it is unique
      // on the page (no history row renders a restock-submit), so strict mode is
      // safe here.
      const submit = page.locator('[data-testid="restock-submit"]');
      check(
        (await submit.innerText()).trim() === "Save restock (inventory only)",
        `width ${width}: submit label with a blank cost is not the inventory-only label`
      );

      // ---- fill the owner's numbers --------------------------------------
      await page.locator('[data-testid="restock-form"] [data-testid="restock-quantity"]').fill(String(QTY));
      await page.locator('[data-testid="restock-form"] [data-testid="restock-vendor"]').fill(VENDOR);
      const dateInput = page.locator('[data-testid="restock-form"] [data-testid="restock-date"]');
      await dateInput.fill(today());
      await page.locator('[data-testid="restock-form"] [data-testid="restock-cost"]').fill(COST.toFixed(2));
      await page.locator('[data-testid="restock-form"] [data-testid="restock-notes"]').fill(`${QTY} bales — ${VENDOR}`);
      const addExpenseOn = await page
        .locator('[data-testid="restock-form"] [data-testid="restock-add-expense"]')
        .getAttribute("aria-pressed");
      check(addExpenseOn === "true", `width ${width}: "Add linked expense" is not ON by default when a cost is entered`);
      check(
        (await submit.innerText()).trim() === "Save restock & add expense",
        `width ${width}: submit label with a cost is not "Save restock & add expense"`
      );
      await shot(page, `form-${width}-filled.png`);

      // =====================================================================
      // 2. SAVE — 25 bales + exactly one linked expense
      //
      // HOW THE SAVE IS JUDGED (and why the old assertion was wrong): the dev
      // server answers a TanStack Start server-function call with the framework's
      // own serialized envelope (`{"t":10,"i":0,"p":{…}}`), NOT with the function's
      // return value — so `JSON.parse(text).ok` is `undefined` by design and a
      // check on it fails a save that actually worked. The raw body is still
      // EVIDENCE, so it is written to disk verbatim and the HTTP status is
      // asserted; the OUTCOME is then judged where the owner judges it — the
      // app's own success banner on /feed — and against the database below.
      // =====================================================================
      serverFnCalls.length = 0;
      await submit.click();
      // The modal only unmounts because onSaved() ran, and FeedModals calls
      // onSaved() only when res.ok — a failed save leaves the form open.
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      const createCall = await (async () => {
        // The Playwright `response` listener is async (it awaits the body), so the
        // entry can land a beat after the modal has already closed.
        for (let i = 0; i < 100; i++) {
          const found = serverFnCalls.find((c) => c.body.includes("client_request_id"));
          if (found) return found;
          await new Promise((r) => setTimeout(r, 100));
        }
        return undefined;
      })();
      check(createCall, `width ${width}: no restock request was observed`);
      writeEvidence(`server-fn-${width}.json`, createCall!.text);
      check(
        createCall!.status === 200,
        `width ${width}: the restock request answered HTTP ${createCall!.status} (raw body in server-fn-${width}.json)`
      );
      check(createCall!.text.trim().length > 0, `width ${width}: the restock response body was empty`);
      const banner = page.locator('[data-testid="restock-message"]');
      await banner.waitFor({ state: "visible", timeout: 15000 });
      const bannerText = (await banner.innerText()).replace(/\s+/g, " ").trim();
      check(
        bannerText.includes("Inventory updated and expense recorded."),
        `width ${width}: the app did not report a restock WITH a linked expense — banner said "${bannerText}"`
      );
      record({
        width,
        step: "save-response",
        httpStatus: createCall!.status,
        rawBodyBytes: createCall!.text.length,
        rawBodyFile: `server-fn-${width}.json`,
        banner: bannerText,
      });

      await reloadHydrated(page);
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
      await gotoHydrated(page, `${BASE_URL}/expenses`, "the Expenses page");
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
      await shot(page, `expenses-${width}.png`);
      const visibleLinkedRows = await page.locator('[data-testid^="expense-row-"][data-linked="true"]').count();
      check(visibleLinkedRows === 1, `width ${width}: expected exactly 1 linked ledger row, saw ${visibleLinkedRows}`);
      await reloadHydrated(page);
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
      await gotoHydrated(page, `${BASE_URL}/feed`, "the /feed page");
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await openRestock();
      await page.locator('[data-testid="restock-form"] [data-testid="restock-quantity"]').fill("10");
      // Scope to the FORM: once a restock exists, the history row renders its own
      // `data-testid="restock-cost"` value span, so an unscoped locator is
      // ambiguous (Playwright strict mode) and would fail on a correct app.
      await page.locator('[data-testid="restock-form"] [data-testid="restock-cost"]').fill("99.00");
      await page.locator('[data-testid="restock-form"] [data-testid="restock-vendor"]').fill("Double Tap Hay");
      const beforeDouble = baseline + QTY;
      // THIS IS A REAL DOUBLE TAP: one form, filled once, submitted twice back
      // to back — so both requests carry the SAME client_request_id (the app
      // generates it once per form-open). Two requests must therefore add the
      // new stock ONCE. Count only THIS step's requests: earlier steps' calls
      // are still in serverFnCalls, and counting them made the old log read
      // "requestsObserved=3" for a two-request tap.
      const DOUBLE_TAP_BALES = 10;
      serverFnCalls.length = 0;
      await page.evaluate(() => {
        const form = document.querySelector('[data-testid="restock-form"]') as HTMLFormElement | null;
        if (!form) throw new Error("restock form missing");
        form.requestSubmit();
        form.requestSubmit();
      });
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      await reloadHydrated(page);
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterDouble = Number(await qtyCell.getAttribute("data-quantity"));
      const dbAfterDouble = await hayRow(hayId);
      const restocksAfterDouble = await restockCount(opId);
      const expensesAfterDouble = await linkedExpenses(opId);
      const doubleTapExpenses = expensesAfterDouble.filter((e) => e.vendor === "Double Tap Hay");

      // The ids the two taps actually sent, read out of the raw request bodies.
      const doubleTapRequests = serverFnCalls.filter((c) => c.body.includes("client_request_id"));
      // The dev server serializes a server-fn call as { t: { p: { k: [...],
      // v: [...] } } } — a KEY list and a PARALLEL VALUE list. The id therefore
      // appears as a value node ({"t":1,"s":"<uuid>"}), NOT as a
      // "client_request_id":"…" pair, which is why the first version of this
      // reader returned "" for every request and the run failed its own new
      // assertion ("a double-tap request carried no client_request_id").
      // Read the envelope: find the { k, v } node whose key list contains
      // client_request_id and take the value at the same index; fall back to a
      // UUID scan of the raw body.
      // The dev server serializes a server-fn call as { t: { p: { k: [...],
      // v: [...] } } } — a KEY list and a PARALLEL VALUE list. The id therefore
      // appears as a value ({\"t\":1,\"s\":\"<uuid>\"}), not as a \"key\":\"value\"
      // pair, which is why the first version of this reader found nothing.
      const idOf = (body: string): string => {
        const walk = (node: any): string => {
          if (!node || typeof node !== "object") return "";
          if (Array.isArray(node.k) && Array.isArray(node.v)) {
            const i = node.k.indexOf("client_request_id");
            const val = i >= 0 ? node.v[i] : undefined;
            const s = typeof val === "string" ? val : val && typeof val === "object" ? val.s : undefined;
            if (typeof s === "string" && s) return s;
          }
          for (const child of Object.values(node)) {
            const found = walk(child);
            if (found) return found;
          }
          return "";
        };
        try {
          const found = walk(JSON.parse(body) as unknown);
          if (found) return found;
        } catch {
          /* fall through to the raw scan */
        }
        return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(body)?.[0] ?? "";
      };
      const doubleTapIds = doubleTapRequests.map((c) => idOf(c.body));
      const sameRequestId = doubleTapIds.length > 1 && new Set(doubleTapIds).size === 1;
      const quantityDelta = afterDouble - beforeDouble;
      writeEvidence(
        `double-tap-${width}-requests.json`,
        `${JSON.stringify(
          {
            note:
              "One form, one client_request_id, submitted twice. Both requests must resolve to a single restock.",
            restockBales: DOUBLE_TAP_BALES,
            requests: doubleTapRequests.map((c) => ({ httpStatus: c.status, body: c.body })),
            clientRequestIds: doubleTapIds,
            distinctClientRequestIds: new Set(doubleTapIds).size,
          },
          null,
          2
        )}\n`
      );

      check(
        quantityDelta === DOUBLE_TAP_BALES,
        `width ${width}: a double tap of a ${DOUBLE_TAP_BALES}-bale restock moved inventory by ${quantityDelta}, not ${DOUBLE_TAP_BALES} — the same submission was applied more than once`
      );
      check(dbAfterDouble.quantity === beforeDouble + DOUBLE_TAP_BALES, `width ${width}: DB inventory double-counted the restock`);
      check(restocksAfterDouble === 2, `width ${width}: double-submit created ${restocksAfterDouble - 1} extra restock rows`);
      check(doubleTapExpenses.length === 1, `width ${width}: double-submit created ${doubleTapExpenses.length} expenses instead of 1`);
      check(doubleTapRequests.length >= 1, `width ${width}: the double tap produced no restock request at all`);
      check(
        doubleTapIds.every((id) => id.length > 0),
        `width ${width}: a double-tap request carried no client_request_id`
      );
      // A stronger claim than before: if the second tap really reached the
      // server, the two requests must have carried the SAME id — otherwise the
      // run would be "proving" idempotency with two unrelated submissions.
      check(
        doubleTapRequests.length < 2 || sameRequestId,
        `width ${width}: the two taps carried DIFFERENT client_request_ids (${doubleTapIds.join(", ")}) — this is not a double tap`
      );
      record({
        width,
        step: "double-submit",
        restockBales: DOUBLE_TAP_BALES,
        requestsSeenForThisTap: doubleTapRequests.length,
        sameClientRequestId: doubleTapRequests.length < 2 ? "n/a (only one request reached the server)" : sameRequestId,
        clientRequestIdsDistinct: new Set(doubleTapIds).size,
        quantityBefore: beforeDouble,
        quantityAfter: afterDouble,
        quantityDelta: quantityDelta,
        applications: quantityDelta / DOUBLE_TAP_BALES,
        restockRowsForOperation: restocksAfterDouble,
        expensesForThisRestock: doubleTapExpenses.length,
        ledgerExpensesTotal: expensesAfterDouble.length,
      });
      // clean up the double-submit restock through the UI (void)
      await voidRestock(page, width, "double-submit");
      const afterVoidDouble = await hayRow(hayId);
      check(afterVoidDouble.quantity === beforeDouble, `width ${width}: voiding the double-submit restock did not restore the count`);

      // =====================================================================
      // 4. INVENTORY ONLY — no expense of any kind
      // =====================================================================
      await gotoHydrated(page, `${BASE_URL}/feed`, "the /feed page");
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const expensesBeforeInventoryOnly = await allExpenses(opId);
      await openRestock();
      await page.locator('[data-testid="restock-form"] [data-testid="restock-quantity"]').fill("10");
      const costField = page.locator('[data-testid="restock-form"] [data-testid="restock-cost"]');
      await costField.fill("99.00");
      await costField.fill(""); // blank cost → the explicit inventory-only choice takes over
      check(
        (await page.locator('[data-testid="restock-form"] [data-testid="restock-inventory-only"]').getAttribute("aria-pressed")) === "true",
        `width ${width}: a blank cost did not select "Inventory only — no expense"`
      );
      check(
        (await submit.innerText()).trim() === "Save restock (inventory only)",
        `width ${width}: blank-cost submit label is not the inventory-only label`
      );
      await shot(page, `form-${width}-inventory-only.png`);
      await submit.click();
      await page.locator('[data-testid="restock-form"]').waitFor({ state: "detached", timeout: 20000 });
      await reloadHydrated(page);
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
      await voidRestock(page, width, "inventory-only");
      check((await hayRow(hayId)).quantity === beforeDouble, `width ${width}: inventory-only void did not restore the count`);

      // =====================================================================
      // 5. EDIT — the SAME expense row is updated
      // =====================================================================
      await gotoHydrated(page, `${BASE_URL}/feed`, "the /feed page");
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await page.locator('[data-testid^="restock-row-"]').first().getByRole("button", { name: "Edit" }).click();
      const editForm = page.locator('[data-testid="restock-edit-form"]');
      await editForm.waitFor({ state: "visible", timeout: 15000 });
      await page.locator('[data-testid="restock-edit-quantity"]').fill(String(EDITED_QTY));
      await page.locator('[data-testid="restock-edit-cost"]').fill(EDITED_COST.toFixed(2));
      await page.locator('[data-testid="restock-edit-vendor"]').fill(VENDOR);
      await shot(page, `edit-${width}.png`);
      await page.locator('[data-testid="restock-edit-submit"]').click();
      await editForm.waitFor({ state: "detached", timeout: 20000 });
      await reloadHydrated(page);
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      const afterEdit = Number(await qtyCell.getAttribute("data-quantity"));
      const expensesAfterEdit = await linkedExpenses(opId);
      check(afterEdit === baseline + EDITED_QTY, `width ${width}: edit left inventory at ${afterEdit}`);
      check(expensesAfterEdit.length === 1, `width ${width}: edit produced ${expensesAfterEdit.length} rows instead of 1`);
      check(expensesAfterEdit[0].id === expenseId, `width ${width}: edit created a DIFFERENT expense row`);
      check(expensesAfterEdit[0].amount_cents === EDITED_COST_CENTS, `width ${width}: edit did not update the amount`);
      await gotoHydrated(page, `${BASE_URL}/expenses`, "the Expenses page");
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
      await gotoHydrated(page, `${BASE_URL}/feed`, "the /feed page");
      await qtyCell.waitFor({ state: "visible", timeout: 30000 });
      await voidRestock(page, width, "main restock");
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
    // Last step before this run may be called PASSED: the evidence it just
    // printed has to be ON DISK, non-empty, and nothing from an earlier run may
    // have been destroyed. A wiped proof directory fails the run here.
    verifyEvidence(preExisting);
    record({ result: "PASS", widths: WIDTHS.join(",") });
    console.log(`\nE2E evidence written to ${PROOF_DIR}`);
  } finally {
    await browser.close();
    if (sql) await sql.end({ timeout: 5 });
  }
};

/**
 * Click Void on the newest restock row, confirm, and wait for the modal to close.
 *
 * The wait is 60s, not 20s: the confirm button shows "Voiding…" while the request
 * is in flight, and on a dev server the server-function module compiles on first
 * use. A 20s budget once failed a void that was NOT broken — the transaction
 * committed a few seconds later and the inventory was reversed (the row and its
 * expense were gone and the stack was back to its pre-restock count). On failure
 * the modal's own text is captured, so a real refusal is never mistaken for a
 * slow one.
 */
const voidRestock = async (page: AnyPage, width: number, label: string): Promise<number> => {
  const row = page.locator('[data-testid^="restock-row-"]').first();
  check((await row.count()) > 0, "expected a restock row to void");
  await row.getByRole("button", { name: "Void" }).click();
  const confirm = page.locator('[data-testid="restock-void-confirm"]');
  await confirm.waitFor({ state: "visible", timeout: 30000 });
  const started = Date.now();
  await confirm.click();
  try {
    await confirm.waitFor({ state: "detached", timeout: 60000 });
  } catch (err) {
    const modalText = await page
      .locator('[data-testid="restock-void-confirm"]')
      .evaluate((el: any) => {
        const box = el.closest("div")?.parentElement;
        return String((box ?? el).innerText ?? "");
      })
      .catch(() => "");
    throw new E2EFailure(
      `width ${width}: the void modal (${label}) never closed after ${Date.now() - started}ms — ` +
        `${err instanceof Error ? err.message : String(err)}. Modal said: ` +
        `"${String(modalText).replace(/\s+/g, " ").trim().slice(0, 300)}"`
    );
  }
  const ms = Date.now() - started;
  record({ width, step: "void-response", voided: label, ms });
  return ms;
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\nE2E FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    console.error("this run's proof dir (partial evidence is kept, never deleted):", PROOF_DIR);
    for (const path of artifacts) {
      console.error(`  ${relative(PROOF_ROOT, path)} bytes=${existsSync(path) ? statSync(path).size : "MISSING"}`);
    }
    console.error("evidence so far:", JSON.stringify(evidence, null, 2));
    process.exit(1);
  }
);
