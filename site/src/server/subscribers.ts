// ============================================================================
// Ranch Manager Pro — Email signup capture (server-only).
// The landing-page form is the opt-in: submitting it records explicit consent.
// UNIQUE(email) + ON CONFLICT (email) DO NOTHING keeps re-submits idempotent
// (no duplicates, no errors). Guarded with isDatabaseConfigured(); never throws.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import type { SubscribeResult } from "~/types/subscribers";

type SubscribeInput = {
  email: string;
  name?: string | null;
};

// Simple, permissive email regex — good enough to catch typos without being so
// strict it rejects legitimate addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const subscribeEmail = createServerFn({ method: "POST" })
  .validator((data: SubscribeInput) => data)
  .handler(async ({ data }): Promise<SubscribeResult> => {
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const name = data.name ? String(data.name).trim() || null : null;
    if (!email || !EMAIL_RE.test(email)) return { ok: false };
    if (!isDatabaseConfigured()) return { ok: false };
    try {
      const db = sql();
      const rows = await db<{ id: number }[]>`
        INSERT INTO subscribers (email, name)
        VALUES (${email}, ${name})
        ON CONFLICT (email) DO NOTHING
        RETURNING id`;
      return {
        ok: true,
        status: rows.length > 0 ? "subscribed" : "already-subscribed",
      };
    } catch {
      return { ok: false };
    }
  });
