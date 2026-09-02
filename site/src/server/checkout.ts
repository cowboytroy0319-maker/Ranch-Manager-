// ============================================================================
// Ranch Manager Pro — Stripe subscription checkout (server-only).
// Creates a Checkout Session (mode=subscription) against the OWNER's Stripe
// account so subscriptions auto-renew, with a one-time trial applied at
// creation. The secret key stays server-side here and is never shipped to the
// client — only the resulting hosted Checkout URL returns to the browser, and
// the browser redirects the visitor there.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";

export type BillingPeriod = "monthly" | "annual";
export type TierName = "Herd" | "Ranch" | "Manager" | "Legacy";

// Exact price ids already created in the owner's Stripe account.
// DO NOT create new ones — these are authoritative.
const PRICES: Record<TierName, { monthly: string; annual: string }> = {
  Herd: {
    monthly: "price_1UAJQQRQ3GjX4x9CUHKeI51G",
    annual: "price_1UAJQRRQ3GjX4x9CqKhgmSYt",
  },
  Ranch: {
    monthly: "price_1UAJQQRQ3GjX4x9CQQO0D7tD",
    annual: "price_1UAJQRRQ3GjX4x9COJaQ7XHM",
  },
  Manager: {
    monthly: "price_1UAJQQRQ3GjX4x9CJmQOGfAa",
    annual: "price_1UAJQRRQ3GjX4x9CRw3sc5Pa",
  },
  Legacy: {
    monthly: "price_1UAJQRRQ3GjX4x9CpQdVq9Sh",
    annual: "price_1UAJQRRQ3GjX4x9CGuGKIDNe",
  },
};

// One-time trial applied at subscription creation:
// Herd/Ranch/Manager = 30 days (1 free month); Legacy = 60 days (2 free months).
const TRIAL_DAYS: Record<TierName, number> = {
  Herd: 30,
  Ranch: 30,
  Manager: 30,
  Legacy: 60,
};

const TIER_BY_KEY: Record<string, TierName> = {
  herd: "Herd",
  ranch: "Ranch",
  manager: "Manager",
  legacy: "Legacy",
};

type CheckoutInput = {
  tier: string; // "herd" | "ranch" | "manager" | "legacy"
  billing: BillingPeriod;
  origin: string; // site origin the visitor is on, used for success/cancel urls
};

type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// Resolve the Stripe secret key server-side. Preference order:
// 1) process.env.secertkey (injected by the host/publish environment)
// 2) /etc/profile.d/cto-env-vars.sh (source of truth on the box, in case the
//    running server wasn't launched from a shell that sourced it).
// Never returned to the client — used only here to authenticate to Stripe.
async function resolveSecretKey(): Promise<string | undefined> {
  if (process.env.secertkey) return process.env.secertkey;
  try {
    const text = await readFile("/etc/profile.d/cto-env-vars.sh", "utf8");
    const m = text.match(/export\s+secertkey=['"]?([^'"\n]+)['"]?/);
    if (m) return m[1];
  } catch {
    /* file missing / unreadable — fall through */
  }
  return undefined;
}


export const createCheckout = createServerFn({ method: "POST" })
  .validator((d: CheckoutInput) => d)
  .handler(async ({ data }): Promise<CheckoutResult> => {
    // --- Resolve tier + billing to a price id ------------------------------
    const tier = TIER_BY_KEY[String(data.tier).toLowerCase()];
    if (!tier) return { ok: false, error: "Unknown plan selected." };
    const billing: BillingPeriod = data.billing === "annual" ? "annual" : "monthly";
    const price = PRICES[tier][billing];
    const trialDays = TRIAL_DAYS[tier];

    const secretKey = await resolveSecretKey();
    if (!secretKey) {
      return { ok: false, error: "Checkout is not configured yet. Please try again shortly." };
    }

    // Origin for return urls. Default to the live site origin so it works even
    // if the origin header is unhelpful behind the reverse proxy.
    const origin = (data.origin || "").trim() || "https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app";

    const body = new URLSearchParams();
    body.set("mode", "subscription");
    // Auto-renew is native to Stripe subscriptions (mode=subscription).
    body.set("subscription_data[trial_period_days]", String(trialDays));
    body.set("line_items[0][price]", price);
    body.set("line_items[0][quantity]", "1");
    body.set("success_url", `${origin}/?checkout=success&tier=${encodeURIComponent(tier)}&billing=${billing}`);
    body.set("cancel_url", `${origin}/#pricing`);

    let resp: Response;
    let json: { url?: string; error?: { message?: string } };
    try {
      resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      json = (await resp.json()) as typeof json;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!resp.ok || !json.url) {
      return { ok: false, error: json.error?.message ?? "Stripe could not start checkout. Please try again." };
    }

    return { ok: true, url: json.url };
  });
