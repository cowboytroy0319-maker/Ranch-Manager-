// Vercel build-time bundler for api/render.js.
//
// Runs AFTER `vite build` (see the buildCommand in vercel.json). Bundles
// vercel-node-entry.ts — the TanStack Start SSR fetch handler plus the Stripe
// webhook and authenticated CSV template-download wiring, mirroring serve.ts —
// into ONE self-contained ESM file (api/render.bundle.mjs) that the api/render.js
// wrapper loads at runtime. One file = no module-tracing risk on Vercel.
//
// Usage: bun vercel-build.mjs   (runs from the site dir)
import { build } from "bun";

const result = await build({
  entrypoints: ["./vercel-node-entry.ts"],
  outdir: "./api",
  naming: "render.bundle.mjs",
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  console.error("vercel-build.mjs: bundle failed");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("vercel-build.mjs: api/render.bundle.mjs ready");
