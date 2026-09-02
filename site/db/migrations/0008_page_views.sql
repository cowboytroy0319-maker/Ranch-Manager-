-- 0008_page_views.sql — self-hosted site analytics (Ranch Manager Pro)
-- Additive only: creates a single table for page-view beacons, no impact on
-- existing tables. Re-running is safe (CREATE TABLE IF NOT EXISTS + index IF
-- NOT EXISTS). Each row is one page view recorded fire-and-forget by the client
-- beacon in __root.tsx. visitor_id is a client-generated UUID kept in the
-- visitor's localStorage so we can count unique visitors with no cookies and no
-- third-party analytics service.
CREATE TABLE IF NOT EXISTS page_views (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path       text NOT NULL,
  visitor_id text NOT NULL,
  referrer   text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_path_idx ON page_views (path);
