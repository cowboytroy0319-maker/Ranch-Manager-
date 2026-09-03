# Auth onboarding — what happens after migration 0014 is applied

This doc is for the site owner/operator. It describes the account flow that is
already built and committed in this repo. Migration `0014_auth_users_operations.sql`
must be applied to the live Neon database **by you** (the lead applies it only on
your separate approval) before any of the flows below work on the live site.

## Before the migration is applied (today's state)

- The live site works as a single "Default Operation" demo: visitors can browse the
  demo modules, and the internal tables carry the seeded demo data. There are no
  user accounts yet on live.
- `/register` and `/login` will show the "Database error" state on live until the
  migration is applied (they need the new `users` / `sessions` /
  `operation_memberships` tables).

## After the migration is applied

1. **Create your account**
   - Go to `/register` ("Start your free month").
   - Enter your **ranch / operation name** (e.g. `T Bar T Ranch`, 80 chars max),
     your **email**, and a **password** (min 8 characters).
   - Click **Create my account**. This:
     - creates a `users` row (email stored lowercase, salted scrypt password hash —
       plaintext is never stored),
     - creates a **brand-new** `operations` row named exactly what you typed (NOT
       the seeded "Default Operation" — your account never sees the demo data),
     - creates the owner membership (`operation_memberships` role `owner`),
     - opens your session (HttpOnly cookie) and lands you on `/dashboard`.
2. **You are the owner.** You see only your operation's data. All the modules
   (livestock, hay/feed, pasture, equipment, expenses, employees, tax exemptions)
   read and write rows scoped to your operation, so your records stay isolated from
   the demo data and from any other account.
3. **Signing in later**
   - Go to `/login`, enter your email + password, and you land back on `/dashboard`.
   - Wrong password shows "Incorrect email or password." (same message for an unknown
     email — no account enumeration).
   - Anyone hitting a protected page (`/dashboard` and the live-data module pages)
     without a session is sent to `/login` with a "Please sign in to view that page."
     notice.
4. **Inviting crew (planned, not built yet)**
   - Worker/viewer memberships are supported by the schema (role CHECK allows
     `owner`, `worker`, `viewer`) and by `resolveAuth`, but there is **no invite UI**
     yet. Today each account = one operation = one owner. Crew invites are a later
     milestone.

## Notes for whoever applies the migration

- The migration is **additive and idempotent** (safe to re-run; tracked in
  `schema_migrations`).
- It backfills every existing row in the operational tables onto the seeded
  "Default Operation", so the demo/internal data stays visible inside that
  operation and nothing is deleted.
- Applying it to live is a **separate, owner-approved step** — it is committed in
  `site/db/migrations/0014_auth_users_operations.sql` with this change only.