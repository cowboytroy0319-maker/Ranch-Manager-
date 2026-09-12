// Vercel Node entry: the TanStack Start SSR fetch handler plus the HTTP-layer
// routes that serve.ts wires around it (Stripe webhook + authenticated CSV
// template downloads). Bundled by vercel-build.mjs into api/render.bundle.mjs;
// invoked at runtime through the api/render.js wrapper.
//
// This file is bundled with bun (which resolves the site's `~/` TS alias), so
// it can import from src/ and dist/ freely — Vercel's own toolchain never sees
// those imports, only the finished bundle.
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "./dist/server/server.js";
import { handleWebhookRequest } from "~/server/webhook";
import { handleTemplateDownload, TEMPLATE_DOWNLOAD_PATH } from "~/server/templateDownload";

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: req as unknown as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
};

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const pathname = new URL(req.url ?? "/", "http://placeholder").pathname;
    const webRes =
      pathname === "/webhook"
        ? await handleWebhookRequest(toWebRequest(req))
        : pathname.startsWith(`${TEMPLATE_DOWNLOAD_PATH}/`) && pathname.endsWith(".csv")
          ? await handleTemplateDownload(toWebRequest(req))
          : await fetchHandler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
