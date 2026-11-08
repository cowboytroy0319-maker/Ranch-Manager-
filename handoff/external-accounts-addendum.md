# External accounts addendum (compiled by the lead, 2026-10-26)

All facts in this file were checked live today. No secret values are included.

## Domain registration (LIVE VERIFIED 2026-10-26)

| Fact | Value |
|---|---|
| Domain | `ranchmanagerpro.com` (bare + `www` both serve the live site) |
| Status | `registered` — owned by the owner (bought via the CTO.new platform registrar 2026-09-02, $14.00) |
| Renewal | **2027-09-02** |
| DNS management | Managed through the CTO.new platform (managed records: website + business inbox). **If CTO.new is canceled, DNS management ends** — transfer the registration to the owner's own registrar (registrar-of-record change requires an auth/EPP code from the current registrar, requested by the owner) or repoint nameservers at a third-party DNS host BEFORE leaving. |
| What breaks | The public site URL mapping, and the platform-managed inbox record (`ranch-manager-pro-ffec3e5e@ctomail.io` — platform inbox, dies with CTO.new regardless). |

## Stripe account (LIVE VERIFIED 2026-10-26 via Stripe API read)

- Account: the team's connected Stripe account — **express (payments-only)**: can sell one-time payments, cannot sell subscriptions.
- **4 products, 4 one-time prices (USD, livemode, all active):**
  - Herd — $15.00 — `price_1UAFCIRW6YxuWmgskNQkt0gY` (product `prod_VAaNozStVj4l4Z`)
  - Ranch — $30.00 — `price_1UAFCIRW6YxuWmgseyxWokhL` (product `prod_VAaNq1Xi1idOWO`)
  - Manager — $75.00 — `price_1UAFCIRW6YxuWmgsQrESzdUq` (product `prod_VAaNt607yg3L8e`)
  - Legacy — $200.00 — `price_1UAFCHRW6YxuWmgsfsjrWzIm` (product `prod_VAaNNo8Z3ZtXcL`)
- 4 active payment links also exist (same amounts). **No monthly, annual, or subscription price exists. 0 subscriptions. 0 payments — $0.00 ever received.**
- The app's `checkout.ts` requests `mode=subscription` against 8 price IDs whose code comment calls them "authoritative" — that conflicts with this read; a fresh Stripe read must precede ANY billing work. The homepage "Get started" buttons call this function live: a visitor clicking one gets a Stripe error. Correcting this is proposal (b) in `shared/proposals/homepage-claims-correction-proposal.md` — nothing changed.
- Stripe is an EXTERNAL account — it survives CTO.new cancellation. The owner controls it from their own Stripe dashboard.

## Financial/billing standing (for the record)

- 0 real transactions have ever completed (finance reads). The 4 prices above are the only sellable items today.
- The intended four-tier monthly model (Herd $15/mo … Legacy $200/mo) is PLANNED and requires migrating the account from express to full Stripe — owner decision, not started.
