#!/usr/bin/env bash
# Build the Vercel Build Output API v3 bundle (.vercel/output) used by
# go-live.sh (`vercel deploy --prebuilt`).
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (site code inlined, runtime
#    dependencies left external for Node to resolve) in a single render.func
#    removes all tracing/detection risk. vercel-entry.ts adapts the Node
#    (req,res) launcher to the web fetch handler.
#
# The bundle step is the shared vercel-build.mjs, so this path and the
# git-integration path (vercel.json) cannot drift apart.
set -euo pipefail
cd "$(dirname "$0")"
umask 002
echo "[1/3] vite build"
bun run build
echo "[2/3] bundle SSR handler + wired HTTP routes into api/render.bundle.mjs"
bun vercel-build.mjs
echo "[3/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell
cp api/render.bundle.mjs .vercel/output/functions/render.func/index.mjs
cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON
echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
