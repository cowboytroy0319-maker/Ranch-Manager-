-- Tax & ag-exemption REGISTRY (Phase 2 after the Employees module; both part of
-- the owners' requested build-out). This is RECORD-KEEPING ONLY — it stores the
-- operation's tax identifiers and exemption/registration details so nothing
-- lapses; it is explicitly not tax advice.
--
-- Jurisdiction-aware and region/locale-ready:
--   * `jurisdiction` is a free-text issuing state/province/jurisdiction (e.g.
--     "Texas", "US federal", "Alberta") — deliberately NOT hard-coded to US
--     states, so a Canada/province or any other region can be supported without
--     a schema change.
--   * `identifier_number` is stored as TEXT, because tax IDs / exemption
--     numbers are identifiers (they may contain letters and dashes and leading
--     zeros), NOT integers and NOT money. Keeping it text avoids any
--     locale/currency formatting concerns entirely.
--   * `expires_on` is nullable — things like an EIN never lapse, while
--     ag-use-valuation applications and brand registrations do. NULL means
--     "does not expire". Upcoming/expired surfacing is derived at read time
--     from expires_on relative to "today".
CREATE TABLE IF NOT EXISTS tax_exemptions (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier_type   text NOT NULL,   -- e.g. 'Sales-tax ag exemption', 'Employer ID (EIN)', 'Ag-use valuation application', 'Brand registration'
  identifier_number text,            -- the number/ID itself — text (an identifier, not money/integer)
  jurisdiction      text NOT NULL,   -- issuing state/province/jurisdiction (free text, region-agnostic)
  entity            text,            -- which operation/entity it applies to (e.g. a dba or ranch name)
  expires_on        date,            -- expiry date -- null means never expires
  contact           text,            -- issuing office / contact
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_exemptions_jurisdiction_idx ON tax_exemptions (jurisdiction);
CREATE INDEX IF NOT EXISTS tax_exemptions_expires_on_idx ON tax_exemptions (expires_on);
