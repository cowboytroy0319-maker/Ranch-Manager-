import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Load the LOCAL, gitignored preview environment file — and ONLY for the
 * dev / "working site" server (`command === "serve"`).
 *
 * Why this exists: platform secrets reach BOTH the working site and the live
 * site, so `APP_ENV` must never be a platform secret (a global `APP_ENV=preview`
 * would point the published site at the scratch database). The reverse proxy
 * also rewrites the Host to `localhost:3000` (see `server.allowedHosts` below),
 * so host-based detection is impossible. The one remaining lever is the local
 * process environment of the dev server: this file loads the three preview
 * variables into `process.env` *before* the server starts.
 *
 * `.preview-env` (chmod 600, gitignored, excluded from the shared-tree rsync) holds:
 *
 *   APP_ENV=preview
 *   PREVIEW_DATABASE_URL=postgres://<preview role>@127.0.0.1:5432/ranch_preview
 *   PREVIEW_ENV_EXPECTED=1
 *
 * `scripts/preview-env.sh up|down|status` recreates it from the root-only
 * credential file (`/root/.preview-env-credentials`) if a sync ever wipes it,
 * and prints the database identity it points at. Missing file = no-op, so a
 * developer with no preview setup is unaffected.
 *
 * WHY NOT `.env.local`: **Bun automatically loads `.env`, `.env.local` and
 * `.env.<NODE_ENV>[.local]` into `process.env` for EVERY process it starts in
 * this directory** — `bun run dev`, `bun run build`, `bun run start`
 * (`serve.ts`, the published server), `bun test`, `bun run db:migrate`. A file
 * named `.env.local` would therefore hand `APP_ENV=preview` to the published
 * server the moment that process started (observed in this sandbox: a bare
 * `bun db/migrate.ts` in this directory came up in preview mode purely from the
 * file). A name Bun does not know about cannot do that: the preview variables
 * reach the dev server through the explicit branch below and nowhere else.
 *
 * The BUILT / published site never executes this path (`vite build` uses
 * `command === "build"`, and the published server runs `serve.ts`, never this
 * config), so the live site stays on `DATABASE_URL` byte for byte.
 *
 * Values here are read with `readFileSync` on purpose: `import.meta.env` /
 * `VITE_*` would bake them into the client bundle, and these must stay
 * server-side process env. Only KEY NAMES are ever logged — never a value.
 */
function loadPreviewEnvFile(): void {
  const file = join(import.meta.dirname, ".preview-env");
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return; // no local preview file — nothing to do
  }
  const applied: string[] = [];
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    applied.push(key);
  }
  if (applied.length) {
    console.log(
      `[preview-env] loaded ${file} (${applied.join(", ")}) — this dev server runs the PREVIEW environment, not production.`
    );
  }
}

export default defineConfig(({ command }) => {
  // Dev / working-site server only. `vite build` (and the published serve.ts
  // process) never take this branch.
  if (command === "serve") loadPreviewEnvFile();

  return {
    server: {
      port: 3000,
      host: true,
      // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
      // masks the Host to localhost:3000, but accept any host so a dev server never
      // rejects a proxied request with "Blocked request".
      allowedHosts: true,
      // The dev server is reachable through the TLS proxy, so the HMR websocket
      // must dial back on 443, not the dev port. If the socket can't connect,
      // pages still serve — hot reload degrades, never breaks.
      hmr: { clientPort: 443 },
      // The dev server can serve source files; never let it serve local secrets,
      // and never let it serve anything outside the site dir. Gotchas this list
      // encodes: a custom `deny` REPLACES Vite's defaults (so .git must be
      // restated), patterns containing "/" match the ABSOLUTE path (so dir
      // patterns need a leading **/), and `allow` left to its default widens to
      // the nearest workspace root — a stray .git or workspaces package.json in
      // /home/team/shared would expose the whole shared dir. The preview
      // credential file (`.preview-env`) is denied here as well as gitignored.
      fs: {
        strict: true,
        allow: [import.meta.dirname],
        deny: [
          ".env",
          ".env.*",
          ".preview-env",
          ".preview-deployment.json",
          "*.{crt,pem,key}",
          "**/.run/**",
          "**/.git/**",
        ],
      },
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tanstackStart(),
      viteReact(),
    ],
  };
});
