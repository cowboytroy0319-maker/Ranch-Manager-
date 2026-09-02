// ============================================================================
// Ranch Manager Pro — Stripe webhook handler (server-only).
//
// Receives Stripe subscription event deliveries on POST /webhook, verifies the
// Stripe-Signature HMAC over the RAW body, and records the event into the
// `subscription_events` table so we have our own durable record of renewals,
// trials, cancellations and payment outcomes — our checkout already handles
// billing itself (hosted Checkout, auto-renew, trials), this is just our log.
//
// This runs at the HTTP layer, wired into the server entries (serve.ts and
// vercel-entry.ts) so it works before/upstream of the TanStack render handler:
//   - it reads the raw request body BEFORE any JSON parsing (required for the
//     signature check),
//   - the secret stays server-side and is never returned to the client,
//   - events are idempotent (event_id unique + ON CONFLICT DO NOTHING).
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDatabaseConfigured, sql } from "~/db";

// Events we explicitly record. Anything else is acknowledged (200) but skipped.
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

// How far (seconds) past the signature timestamp we still accept an event —
// replay protection. Stripe signs within milliseconds; 5 minutes is generous.
const SIGNATURE_TOLERANCE_SECONDS = 300;

// Resolve the webhook signing secret server-side. Preference order:
// 1) process.env.STRIPE_WEBHOOK_SECRET (injected by the host/publish env)
// 2) /etc/profile.d/cto-env-vars.sh (source of truth on the box, in case the
//    running server wasn't launched from a shell that sourced it). The file may
//    declare it under this exact name, or just hold a whsec_ value — accept both.
// 3) the `app_settings` table (key = 'stripe_webhook_secret'). This is the
//    cross-environment fallback: the LIVE host does not read profile.d nor
//    receive the secret via a Secrets-page value, but it DOES have DATABASE_URL,
//    so we persist the server-side signing secret in our own DB to make the
//    live webhook self-sufficient. The live DB row is seeded by migration 0006.
// Never returned to the client.
export async function resolveWebhookSecret(): Promise<string | undefined> {
  const fromEnv = process.env.STRIPE_WEBHOOK_SECRET;
  if (fromEnv) return fromEnv;
  try {
    const text = await readFile("/etc/profile.d/cto-env-vars.sh", "utf8");
    const named = text.match(/STRIPE_WEBHOOK_SECRET=["']?([^"'\n]+)/);
    if (named) return named[1].trim();
    const bare = text.match(/whsec_[A-Za-z0-9]+/);
    if (bare) return bare[0];
  } catch {
    /* file missing / unreadable — fall through */
  }
  // Third fallback: read the signing secret from our own database. Dependent on
  // DATABASE_URL being present (it is on both the working and live hosts). Any
  // failure — no DB configured, query error — must NOT throw the request; we
  // return undefined so the caller returns 503 and Stripe retries later.
  if (isDatabaseConfigured()) {
    try {
      const db = sql();
      const row = await db`
        SELECT value FROM app_settings WHERE key = 'stripe_webhook_secret'
      `;
      const value = (row[0]?.value as string | undefined) ?? undefined;
      if (value && value.startsWith("whsec_")) return value;
    } catch (err) {
      console.error("[webhook] could not read signing secret from app_settings:", err);
    }
  }
  return undefined;
}

// Parse `t=<ts>,v1=<hex>` from the Stripe-Signature header.
function parseSignatureHeader(header: string | null): {
  timestamp: number | null;
  signature: string | null;
} {
  if (!header) return { timestamp: null, signature: null };
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (!v) continue;
    if (k === "t") {
      const n = Number(v);
      timestamp = Number.isFinite(n) ? n : null;
    } else if (k === "v1") {
      signature = v;
    }
  }
  return { timestamp, signature };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// Verify the HMAC-SHA256 signature over `${timestamp}.${rawBody}` and the
// 5-minute replay window. Returns an error message when invalid, null when valid.
export function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null
): { ok: true } | { ok: false; reason: string; status: number } {
  const { timestamp, signature } = parseSignatureHeader(header);
  if (timestamp === null || signature === null) {
    return {
      ok: false,
      reason: "Missing or malformed Stripe-Signature header",
      status: 400,
    };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: "Webhook signature timestamp too old (possible replay)",
      status: 400,
    };
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  if (!timingSafeEqualHex(expected, signature)) {
    return { ok: false, reason: "Webhook signature verification failed", status: 400 };
  }
  return { ok: true };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Map a Stripe price id to the readable tier, mirroring the prices in checkout.ts.
const PRICE_TO_TIER: Record<string, string> = {
  price_1UAJQQRQ3GjX4x9CUHKeI51G: "Herd",
  price_1UAJQRRQ3GjX4x9CqKhgmSYt: "Herd",
  price_1UAJQQRQ3GjX4x9CQQO0D7tD: "Ranch",
  price_1UAJQRRQ3GjX4x9COJaQ7XHM: "Ranch",
  price_1UAJQQRQ3GjX4x9CJmQOGfAa: "Manager",
  price_1UAJQRRQ3GjX4x9CRw3sc5Pa: "Manager",
  price_1UAJQRRQ3GjX4x9CpQdVq9Sh: "Legacy",
  price_1UAJQRRQ3GjX4x9CGuGKIDNe: "Legacy",
};

type RecordedEvent = {
  event_id: string;
  type: string;
  customer_id: string | null;
  subscription_id: string | null;
  price_id: string | null;
  tier: string | null;
  amount_cents: number | null;
  currency: string | null;
  status: string | null;
  email: string | null;
  raw: Record<string, unknown> | null;
};

// Pull the fields we care about out of a Stripe event. Stripe's payload shapes
// differ by event type, so every field is guarded/looked up across the common
// locations. Returns null for events we don't record.
function extractEvent(event: {
  id?: string;
  type?: string;
  data?: { object?: Record<string, any> };
}): RecordedEvent | null {
  const id = str(event.id);
  const type = str(event.type);
  if (!id || !type || !HANDLED_EVENTS.has(type)) return null;
  const obj = (event.data && event.data.object) || {};

  const customerId = str(obj.customer) ?? str(obj.customer_details?.email) ?? null;
  const subscriptionId =
    str(obj.subscription) ?? (type.startsWith("customer.subscription") ? str(obj.id) : null);
  const email =
    str(obj.customer_email) ?? str(obj.customer_details?.email) ?? null;

  // price id — found on subscription.items / invoice.lines (webhook payloads
  // include the embedded line items).
  let priceId: string | null = null;
  for (const list of [obj.items, obj.lines]) {
    const first = Array.isArray(list) ? list[0] : null;
    if (!first) continue;
    priceId = str(first.price?.id) ?? str(first.price);
    if (priceId) break;
  }

  let amountCents: number | null = null;
  const amount =
    obj.amount_paid ??
    obj.amount_due ??
    obj.amount_total ??
    obj.amount ?? obj.items?.data?.[0]?.price?.unit_amount ??
    obj.lines?.data?.[0]?.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) amountCents = amount;

  const status =
    str(obj.payment_status) ?? str(obj.status) ?? str(obj.paid ? "paid" : null);

  return {
    event_id: id,
    type,
    customer_id: customerId,
    subscription_id: subscriptionId,
    price_id: priceId,
    tier: priceId ? (PRICE_TO_TIER[priceId] ?? null) : null,
    amount_cents: amountCents,
    currency: str(obj.currency),
    status,
    email,
    raw: event as unknown as Record<string, unknown>,
  };
}

async function recordEvent(event: RecordedEvent): Promise<"ok" | "missing-db" | "error"> {
  if (!isDatabaseConfigured()) return "missing-db";
  try {
    const db = sql();
    await db`
      INSERT INTO subscription_events
        (event_id, type, customer_id, subscription_id, price_id, tier,
         amount_cents, currency, status, email, raw)
      VALUES
        (${event.event_id}, ${event.type}, ${event.customer_id},
         ${event.subscription_id}, ${event.price_id}, ${event.tier},
         ${event.amount_cents}, ${event.currency}, ${event.status}, ${event.email},
         ${JSON.stringify(event.raw ?? null)}::jsonb)
      ON CONFLICT (event_id) DO NOTHING
    `;
    return "ok";
  } catch (err) {
    console.error("[webhook] DB write failed:", err);
    return "error";
  }
}

// Full HTTP handler for POST /webhook. Returns a Response to send back to
// Stripe: it must ACK (200) as soon as we have verified + durably recorded the
// event so Stripe stops retrying. Returns 400 for bad signatures and 503 when
// the signing secret is unavailable (so Stripe retries later).
export async function handleWebhookRequest(req: Request): Promise<Response> {
  const body = await req.text().catch(() => "");
  const signatureHeader = req.headers.get("stripe-signature");

  const secret = await resolveWebhookSecret();
  if (!secret) {
    console.error(
      "[webhook] STRIPE_WEBHOOK_SECRET is not available — returning 503 so Stripe retries."
    );
    return new Response(
      JSON.stringify({ received: false, error: "webhook not configured" }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  const verified = verifySignature(secret, body, signatureHeader);
  if (!verified.ok) {
    console.warn(`[webhook] rejected: ${verified.reason}`);
    return new Response(
      JSON.stringify({ received: false, error: verified.reason }),
      { status: verified.status, headers: { "content-type": "application/json" } }
    );
  }

  // Valid signature: parse the JSON event (safe now) and record it.
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    console.warn("[webhook] valid signature but unparseable JSON body");
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const record = extractEvent(event);
  if (!record) {
    // Acknowledged but not one of the events we record (or missing id/type).
    return new Response(JSON.stringify({ received: true, recorded: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await recordEvent({ ...record, raw: event });
  if (result === "error") {
    console.warn(
      "[webhook] DB write errored; returning 503 so Stripe retries this event."
    );
    return new Response(
      JSON.stringify({ received: true, recorded: false, error: "storage error" }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }
  if (result === "missing-db") {
    console.warn(
      "[webhook] DATABASE_URL not configured; acking the event without recording (Stripe will not retry)."
    );
    return new Response(JSON.stringify({ received: true, recorded: false, note: "no database" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ received: true, recorded: true, type: record.type }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
