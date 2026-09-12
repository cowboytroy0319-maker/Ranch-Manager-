// Vercel serverless entry for the preview deployment.
//
// The build (see the buildCommand in vercel.json: `bun run build && bun
// vercel-build.mjs`) produces:
//   - dist/client            -> served as static assets (outputDirectory)
//   - dist/server/server.js  -> TanStack Start portable fetch handler
//   - api/render.bundle.mjs  -> ONE self-contained bundle of the SSR handler
//     plus the Stripe webhook + authenticated CSV template-download wiring
//     (mirroring serve.ts), built by vercel-build.mjs so Vercel's
//     file-tracing only ever sees finished JS, never the site's `~/` TS
//     path aliases (which Vercel's Node toolchain cannot resolve).
//
// This file is ESM (the site package is `"type": "module"`). The static import
// lets Vercel's tracer include the bundle; Node 22 provides the global
// Request/Response/Headers/ReadableStream the bundle relies on.
import bundle from "./render.bundle.mjs";

const handler = bundle.default || bundle;

export default function vercelHandler(req, res) {
  return handler(req, res);
}

export const config = { runtime: "nodejs22.x" };
