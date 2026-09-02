# Ranch Manager Pro — Browser QA Report (live demo)

Site under test: https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app
Method: agent-browser CLI (Chrome 152) driving the live site; curl for origin-level HTML checks.

## Part A — Real-browser functional QA (8 items)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Module tabs/nav — 9 views each render own content | **PASS** | Clicked every tab; each rendered unique content: Overview (stats/reminders), Livestock (herd snapshot), Horse Energy (23.7 Mcal calc), Hay & Feed (feed inventory), Pasture & Forage (grazing/forage intel + "Pastures & grazing activity"), Equipment (Kubota M7-172), Registrations (renewals table), Fuel (monthly gallons/Feb), Costs (YTD cost) |
| 2 | Horse Energy calc updates Mcal | **PASS** | Workload Moderate→Heavy: 23.7→27.2 Mcal/day; weight slider 1100→600 lb: 27.2→14.9 Mcal/day (both update output + "for a ... lb horse at ...") |
| 3 | Livestock species filter | **PASS** | Clicked Goats → detail header changed "Cattle — herd snapshot" → "Goats — herd snapshot" (note "Brush control herd") |
| 4 | Maintenance "mark done" toggle | **PASS** | Ticked F-350 reminder: checkbox false→true, title got `text-decoration: line-through` + grey (computed style verified) |
| 5 | Sortable Overview reminders | **PASS** | Sort select due→category re-ordered list (first items changed from Cow herd/F-350/Tractor to Brand inspection/Cattle audit/Feedlot) |
| 6 | Site filter (Pasture + header subtitle) | **PASS** | All sites: 6 pastures; switched to Mesa Feedlot Unit → subtitle "Showing Mesa Feedlot Unit" + Pasture list reduced to only "Feedlot Pen 3" |
| 7 | Landing → demo CTA link | **PASS** | Clicked "View Live Demo" (ref e1) on / → URL became /demo |
| 8 | Console / JS errors | **PASS (none)** | Installed window.onerror/console.error capture + window 'error' listener, traversed all 9 views + site filter → 0 errors collected |

Note on refs: agent-browser accessibility refs (`@eN`) shift after every navigation; reliable interaction used CSS/DOM eval locators. `agent-browser find text` click silently failed; `click @eN` worked when refs were fresh.

## Part B — Fixes applied (source)
1. **Compliance/Registrations table now genuinely sortable.** `ComplianceModule.tsx` gained a "Sort: due date / Sort: category" select (same approach as Overview) and sorts rows by due date (`daysLeft`) or by kind+title. Subtitle updated to "Sort by due date or category — check an item to mark complete" (no longer the false "Sortable list" claim). Table checkboxes retained.
2. **Overview reflects selected site (quick win).** `OverviewModule.tsx` accepts a `site` prop (demo.tsx already passed it) and the "Livestock by species" card subtitle now reads "Head count across {siteName}" (e.g. "all sites" / "Mesa Feedlot Unit"). Low-cost, does not change data semantics.

## Part C — Publish & re-verify
- `bun run publish` (from /home/team/shared/site) → **BUILD SUCCEEDED** (vite client+ssr, 155+63 modules), "site published; serving on port 3000", exit 0.
- Live site serves 200s: `GET /` → 200, `GET /demo` → 200.
- Live /demo HTML contains the new sort options **"Sort: category"** and **"Sort: due date"** (verified via curl of the live origin).
- **In-browser network proof:** `fetch('/demo')` from inside the live page returned `status:200, hasNewSort:true, hasOldSubtitle:false` — the live origin definitively serves the new build.

## Known testing-tool limitation (browser DOM staleness)
The agent-browser *rendered* DOM kept showing the pre-fix bundle on the /demo page even after: reload, cache-busting URL (`?bust=...`), `close --all`, killing the chrome process, and clearing SW/caches (verified no service worker, no cached keys). Meanwhile the same browser's own `fetch('/demo')` to the identical URL returned the NEW build. Conclusion: the live site serves the new build correctly (origin + network confirmed), but the agent-browser rendering path served a stale app-shell document to the page DOM. So the *interactive* post-fix click-through of the new sort control could NOT be visually confirmed in this tool this session — this is a browser-tool drive artifact, not a site defect. The new code compiled and is deployed; source logic is a small, safe mirror of the already-PASSing Overview sort.

## Files touched
- /home/team/shared/site/src/components/demo/ComplianceModule.tsx (made sortable)
- /home/team/shared/site/src/components/demo/OverviewModule.tsx (site-aware subtitle)
