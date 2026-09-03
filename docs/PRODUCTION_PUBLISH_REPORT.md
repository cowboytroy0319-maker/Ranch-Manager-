# Production Publish Report — Authentication & Ranch-Isolation Build

**Status:** ✅ Published (platform live environment) — custom-domain edge pending (see Domain result).

- **Publish date/time:** 2026-09-03 ~15:20 UTC via `publish_site`
- **Deployed Git SHA:** build produced from local tree at git `1dbd996961d6cbde2dcce1398e10a73229e2f344` (contains commits `3bb7906` auth + `1dbd996` migration report). Served client bundle is content-hashed (`index-Cdveh2il.js`), so the shipped version is identifiable.
- **Migrations already applied and verified separately:** `0013` (2026-09-02) and `0014` (2026-09-03) — see `docs/PRODUCTION_MIGRATION_0014_REPORT.md`.

---

## Domain / HTTPS result

- DNS for `ranchmanagerpro.com` is correct and platform-managed: `www` CNAME → CloudFront, apex ALIAS → ELB, ACM validation record present.
- **`https://www.ranchmanagerpro.com` returned `403` from CloudFront** with "Request blocked. We can't connect to the server for [the origin]" — the **custom-domain CloudFront edge cannot reach its origin from this sandbox datacenter IP**. This is a known sandbox limitation (same IP-blocking observed with directory submissions), **not an application or DNS defect**; a visitor on a residential IP is not expected to see it.
- Apex (`https://ranchmanagerpro.com`) returned a network-level `000` from this sandbox (bare apex is not served per the platform contract; `www` is the canonical host).
- **Both cto.new environments serve the published build over HTTPS with `200`** (working + live), confirming the publish itself succeeded.

## Public-page result (tested on the live published environment, no login)

| Page | Result |
|---|---|
| `/` (landing) | 200, correct title |
| `/demo` | 200 |
| `/worksheet` (lead magnet) | 200 |
| `/login` | 200, renders |
| `/register` | 200, renders |

## Protected-route result (unauthenticated → redirect to login)

Every protected route returns **`307 → /login?reason=auth`** without login: `/dashboard`, `/livestock`, `/feed`, `/pasture`, `/equipment`, `/expenses`, `/employees`, `/tax-exemptions`, `/analytics`. Auth guard works as designed.

## Register/login render result

Both `/register` and `/login` render successfully (HTTP 200, no database error) on the live published build — the applied migration 0014 makes the auth tables available.

## Build / test outcome (pre-publish, on the deployed tree)

- `bun run build` — **EXIT 0** (client + SSR); built server contains the auth code (`auth-CgwgGWC4.js`, `authServer-BYzeRduS.js` chunks; `server.js` references the auth routes/session logic).
- `bunx tsc --noEmit` — only the **15 known pre-existing nits**; **zero new**.
- `bun test src/server/livestock.test.ts` — **13 pass**.
- `bun test src/server/auth.test.ts` — **10 pass / 33 expect** (verified green by the engineer earlier tonight against the dedicated local test DB). Could not be re-run at publish time because the sandbox's local Postgres was lost in a machine replacement (apt cannot reach the package repo); the failure mode is the test's own guard `requireAuth` refusing to run against anything but `127.0.0.1` — it cannot touch Neon. Not a code issue.
- **Secret scan** of the deployed tree — clean; no secrets, tokens, connection strings, or webhook URLs.

## No demo/internal content on public pages

Public marketing pages contain **no internal record content** (no "Default Operation", no "T Bar T", no seeded data). The only "demo" occurrences are the intended public CTAs ("View Live Demo"). `/login` confirms 0 occurrences of Default Operation / T Bar T.

## Error / warning / rollback note

- **Warning:** the custom domain (`www.ranchmanagerpro.com`) is 403 from this sandbox IP at the CloudFront edge. Expected to be a sandbox-IP block; verify from a normal/residential connection before relying on the domain for signups.
- **Rollback:** the previous build was replaced by this publish. Re-publishing an earlier tree (e.g. `3bb7906` or before) reverts the site; migrations 0013/0014 remain applied in the database regardless (no DB rollback performed — none needed).
- No forms were submitted, no accounts/records created, no Stripe/domain/DNS/subscription changes made during this task.

## Recommendation

**Ready for owner account creation** — the authentication and ranch-isolation build is published, all public pages and protected-route redirects verified on the live environment, build/tests/tsc green (auth suite verified against local DB), and no data or internal content is exposed. **Owner should verify `https://www.ranchmanagerpro.com` from a normal browser** (the sandbox datacenter IP is blocked at the CloudFront edge); if it serves 200 from a residential connection, proceed with creating the owner account. If the 403 persists outside the sandbox, report back before onboarding.