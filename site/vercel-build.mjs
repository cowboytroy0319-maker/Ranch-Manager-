// Vercel build-time bundler for api/render.js.
//
// Runs AFTER `vite build` (see the buildCommand in vercel.json: `bun run build
// && bun vercel-build.mjs`). Bundles vercel-entry.ts — the TanStack Start SSR
// fetch handler plus the Stripe webhook and authenticated CSV template-download
// wiring, mirroring serve.ts — into api/render.bundle.mjs, which the
// api/render.js wrapper loads at runtime.
//
// Bundling strategy: the site's own TS (including the `~/` alias) plus the
// prebuilt dist/server/server.js are INLINED. Runtime `dependencies` from
// package.json stay EXTERNAL so Node resolves them from node_modules at
// runtime — in particular the @tanstack/* packages, which use package-internal
// `#...` subpath imports that no bundler (bun build, esbuild, Vercel nft) can
// statically resolve. Without this the build dies with:
//   error: Could not resolve: "#tanstack-router-entry". Maybe you need to "bun install"?
// Vercel's file tracer follows external package imports into node_modules, and
// the build installs with `bun install --frozen-lockfile` (see installCommand
// in vercel.json), so those packages are present at runtime.
//
// Also used by build-vercel.sh (the Build Output API path used by go-live.sh)
// so both Vercel paths share one fixed bundle step.
//
// Usage: bun vercel-build.mjs   (runs from the site dir)
import { build } from "bun";
import pkg from "./package.json";
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  "@tanstack/react-start/server",
];
const result = await build({
  entrypoints: ["./vercel-entry.ts"],
  outdir: "./api",
  naming: "render.bundle.mjs",
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "none",
  external,
});
if (!result.success) {
  console.error("vercel-build.mjs: bundle failed");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("vercel-build.mjs: api/render.bundle.mjs ready");
