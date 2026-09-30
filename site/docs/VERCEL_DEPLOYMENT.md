# Vercel preview deployment configuration (why it exists)

The Vercel project `ranch-management-pro/ranch-manager-preview` builds this
directory (`site/`) from Git. Its deployments only succeed when the repository
contains the configuration below — the framework auto-detection cannot build a
TanStack Start SSR app, and the Build Output bundle in `build-vercel.sh` used to
fail with:

```
error: Could not resolve: "#tanstack-router-entry". Maybe you need to "bun install"?
    at .../node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js:28:10
```

## Files

- **`vercel.json`** — build/install commands, `outputDirectory: dist/client`,
  and the rewrites that hand `/webhook`, `/templates/:slug.csv` and every other
  path to the SSR function (`/api/render`).
- **`vercel-build.mjs`** — bundles `vercel-entry.ts` into
  `api/render.bundle.mjs`. Site code (including the `~/` alias) and
  `dist/server/server.js` are **inlined**; runtime `dependencies` stay
  **external** so Node resolves them from `node_modules` at run time. That
  externality is the fix: the `@tanstack/*` packages use package-internal `#…`
  subpath imports that no bundler can resolve statically.
- **`api/render.js`** — the serverless entry, `export const config = { runtime:
  "nodejs" }`. `"nodejs"` is the supported runtime string; `"nodejs22.x"` is not.
- **`vercel-entry.ts`** — Node `(req, res)` → web `Request`/`Response` adapter
  around the TanStack Start fetch handler, with the Stripe webhook and the
  authenticated CSV template download wired ahead of it (mirrors `serve.ts`).
- **`build-vercel.sh`** — the Build Output API variant used by `go-live.sh`
  (`vercel deploy --prebuilt`). It now calls the same `vercel-build.mjs`, so the
  two deployment paths cannot drift apart.

## Verifying a change locally (no Vercel credentials needed)

```bash
cd site
rm -rf dist api/render.bundle.mjs
bun run build && bun vercel-build.mjs   # must exit 0 and write api/render.bundle.mjs
```

A green build is not proof the deployment works: the produced entry has to
render. Serve it the way Vercel routes it (static `dist/client` first, then the
SSR function) and load a page — `/` must return the app HTML, and `/webhook` and
`/templates/<slug>.csv` must reach their own handlers (400 JSON for a
signature-less webhook POST, 302 to `/login` for an unauthenticated download).

## Not verified by the team

The Vercel project's own dashboard settings and build logs are not readable with
the credentials the team holds, so a failure that survives this configuration is
a project-setting problem, not a repository one.
