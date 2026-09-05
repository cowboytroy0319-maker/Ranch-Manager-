# Production Deploy Report — Mobile More-Nav fix + Equipment & Fuel Logging (PR #1 469a76e + PR #2 3d9d7fe)

**Date:** 2026-09-05 (session)
**Approval:** Owner "APPROVED TASK: Publish the reviewed mobile More-navigation fix + Equipment & Fuel logging release to ranchmanagerpro.com."
**Release head:** GitHub main `3d9d7fefe82dc63884b200f9f520b02fd1d9502b` (main HEAD `3d9d7fe`, "Equipment & Fuel mobile logging: + Log fuel / + Add service quick actions (#2)").
**Release diff (`abce19e..3d9d7fe`):** 7 files, +1029/−18 — `site/src/components/MobileNav.tsx` (+57), `site/src/components/mobileNav.test.ts` (+62), `site/src/components/equipment/TrackingModals.tsx` (+372), `site/src/routes/equipment.tsx` (+54/−9), `site/src/server/equipmentLogging.test.ts` (+388), `site/src/types/equipment.ts` (+8), plus the prior rollout report. **No migration files in the release.**

---

## 1. Migrations — none required, none applied
Both release commits are UI+test only; `db/migrations/` gained no files (`git show --stat 469a76e`, `git show --stat 3d9d7fe` = MobileNav + tests / TrackingModals + equipment.tsx + tests + types only). Production Neon is at migration `0017` from the prior rollout and requires nothing new. **No db:migrate was run against Neon; no production data/schema was touched.**

## 2. Pre-publish verification (all run against the release head, local only)
Postgres 16 on 127.0.0.1:5433 was already running; the local test DBs (`ranch_tasks_test`, `ranch_auth_test`, `ranch_import_dedup_test`, `ranch_import_txn_test`, `ranch`) were present with schema at 0017.

| Check | Result |
|---|---|
| **Tests (full suite, `bun test`, 9 suites)** | **150 pass / 0 fail** — mobileNav (13), livestock (26), importLivestock (15), auth (10, ranch_auth_test), tasks (26, ranch_tasks_test), equipmentLogging (22, ranch_tasks_test), onboarding (27, ranch_tasks_test), importLivestock.db (7, ranch_import_dedup_test), importLivestock.txn (4, ranch_import_txn_test). DB suites ran only against local Postgres; production Neon was never a test target. |
| **Production build** (`bun run build`) | `✓ built in 3.51s`, exit **0**. New assets: `app-CUi9rOds.css`, `equipment-C2WAySJH.js`, `AppShell-75JNDo8A.js`, etc. |
| **Type check** (`bunx tsc --noEmit`) | Exactly the **15 known pre-existing nits** (serve.ts ×6, CalendarSnapshot ×2, MorningBriefing ×1, PastureModule ×3, demoSites ×1, analytics ×1, index ×1). **Zero new errors** — no error in MobileNav.tsx, TrackingModals.tsx, equipment.tsx, equipmentLogging.test.ts, or types/equipment.ts. |
| **Secret scan** | **Clean.** No secret patterns (Stripe/Postgres/token keys, certs) in the release diff; no `.env/.pem/.key/.p12` tracked (only the placeholder `.env.example`); working tree clean apart from the 3 never-committed handoff notes (ITEM3_IMPORT_SPEC.md, ITEM3_TSC_ERRORS.md→.txt, WORKFLOW.md — same as the prior rollout). |

## 3. Publish executed + result
- `publish_site` (the platform tool) is **not available in this session's toolset**, and the sandbox MCP exposes only filesystem/process tools (no publish). Per the brief's fallback I ran the **standard platform publish documented in the repo** — `cd /home/team/shared/site && bun run publish` (site/publish.sh: `bun install` → `bun run build` → restart serve.ts on :3000).
- **Result: `✓ built in 3.37s` → `site published; serving on port 3000`, exit 0** (2026-09-05T00:32:09Z start, ~00:32:19Z live on :3000, new server PID 2538).
- **Deployed Git SHA: `3d9d7fefe82dc63884b200f9f520b02fd1d9502b`** (main HEAD at publish time) — this is the build now served by the **preview** environment.

## 4. Domain / HTTPS (post-publish)
- `https://www.ranchmanagerpro.com` → **HTTP 403** from this sandbox's datacenter IP (CloudFront bot-block, documented; also 403 with a browser UA from this IP). TLS is fine — `HTTP/2 403`, `server: CloudFront` (wildcard cert validity confirmed in the prior rollout report).
- Preview/working host `https://9b3dc5aae6b40835eb587c2a6310f5b4-dev.ctonew.app` → **HTTP 200 and serves the NEW build** (`/assets/app-CUi9rOds.css` — matches the local `dist/client` build).
- **Live host `https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app` → HTTP 200 but STILL SERVES THE PREVIOUS BUILD** (`/assets/app-5cfJ0n_T.css`, the abce19e-era build) at publish+several minutes.
- **Conclusion: the live environment was NOT promoted by `bun run publish`.** The live swap is exclusively the platform `publish_site` tool, which this delegation does not have. The release is built, tested, verified, and published to the preview — **the final live swap remains for the lead's `publish_site` call (one step).**

## 5. Mobile navigation verification (live vs static, honest split)
No production login was created (prohibition) and the live host is not yet on this build, so **nothing authenticated was exercised live**. Verified:

**Static (source of the merged release head + tests):**
- `src/components/MobileNav.tsx` — More-drawer rows are plain `<Link to>` (MORE_NAV map, **no onClick close**); the drawer closes via a **pathname-change `useEffect`** (`prevPathname !== pathname → closeMore()`); the **More ☰ toggle is preserved** (`onClick={toggleMore}`, aria-expanded) and the Close X in the drawer header still calls `onClose`. The old "close in row onClick" was intentionally removed (comment lines 148–152 explain the iOS race).
- MORE_NAV = 9 drawer rows: Livestock, Feed & Hay, Pastures, Equipment, Expenses, Employees, Tax Exemptions, Import CSV, Templates — every row targets a distinct route path (unit-tested). Dashboard + Tasks are the primary-bar Links (BOTTOM_NAV, `to: "/dashboard"`, `to: "/tasks"`), also plain Links.
- `mobileNav.test.ts` (13 passing tests) unit-tests `shouldCloseMoreDrawer` (closes only after a real pathname change; never closes on the same route) and asserts 9 distinct More routes, no row taps the current path.
- AppShell renders `MobileBottomNav` on the signed-in shell (md:hidden, safe-area padded).

**Live:**
- The preview host at 375px without login cannot render the signed-in shell (routes redirect to /login). **No live interactive nav check was possible from this session** (matches the prior rollout's known limitation). A live 375px tap-through of the drawer remains an owner smoke-test step (see §9).

## 6. Equipment actions verification (source + bundle)
- **Source (`src/routes/equipment.tsx`):** three quick actions present and wired — `+ Add equipment` (button), `⛽ + Log fuel` (opens `LogFuelModal`), `🔧 + Add service` (opens `LogServiceModal`, lines 436–445); `TrackingModals.tsx` (+372 lines, this release) implements both modals; `equipmentLogging.test.ts` (22 passing) covers the server writes.
- **Empty states are clean, product-facing, no dev commands:** equipment "add your first unit with '+ Add equipment' above", fuel "log your first fill-up with '+ Log fuel' above", service "add your first service with '+ Add service' above".
- **`db:seed` in customer-facing strings:** none in the Fuel/Service/Equipment empty states. The only `db:seed` mention in equipment.tsx is line 108 inside the **"Database not configured" developer setup-instructions block** (rendered only when DATABASE_URL is absent — same pattern pre-exists in livestock/feed/pasture/tax-exemptions/employees routes; **pre-existing, not introduced by this release**, which only touched the button/empty-state lines).
- **Bundle:** the new build's bundles (equipment-C2WAySJH.js etc.) are on the preview + local dist; the live host isn't on this build yet, so live-bundle string checks were not possible (per §4).

## 7. Quick Add / Dashboard / Tasks / More tappability (source)
- Quick Add: button `onClick={() => setQaOpen(true)}` opens the QuickAddSheet; sheet rows are Links (they correctly keep `onClick={onClose}` — that sheet is a modal, distinct from the More drawer).
- Dashboard + Tasks: plain `Link`s in the primary bar. More: `onClick={toggleMore}` preserved. All statically verified; no authenticated live exercise (see §5).

## 8. Build / test / type-check / secret-scan summary
See §2 table. **All green on the release head; the only pre-existing tsc nits are unchanged.**

## 9. Known limitations / actions still required
1. **The live environment is not yet on this build.** `bun run publish` updated the preview only. The lead must run **`publish_site`** (their platform tool) once to swap the live copy — then §5/§6 live-bundle checks and the owner smoke test become possible. This report's "recommendation" below accounts for that.
2. **www.ranchmanagerpro.com returns 403 only from this datacenter IP** (CloudFront bot-block); the owner verifies from residential.
3. **Auth'd UI checks** (More drawer tap-through at 375px, quick-action modals, sheet behavior) were not exercised against production (no prod account created, per prohibition) — **owner phone smoke test still required** after the live swap.
4. **Known product limitation (pre-existing, per engineering):** price-per-gallon and meter/odometer values are captured in the UI but **not persisted server-side** pending follow-up approval — out of scope for this release, disclosed for the owner's awareness.

## 10. Rollback note
Site rollback = **publish the prior main `abce19e`** (the previously deployed build) and re-point the live host to it. No database rollback is needed (no migrations in this release; prod schema remains at 0017, unchanged). The preview can also be reverted by republishing `abce19e` via the same `bun run publish`.

## 11. Recommendation
**Proceed — the release is verified and preview-published; do not claim "live" until the lead runs the one `publish_site` swap.** Everything this delegation could verify without the platform tool is green; the remaining live promote is mechanical and blocked only on tool availability, not on release health. After the swap, the owner's phone smoke test (drawer tap-through + Log fuel/Add service) is the final gate.

## 12. No secrets
This report contains no credentials, connection strings, tokens, or private data.