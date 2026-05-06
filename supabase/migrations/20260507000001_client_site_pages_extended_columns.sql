-- P8.0.8: Add extended columns to client_site_pages for rescan endpoint
--
-- The POST /pages/[pageId]/rescan route writes these columns on every rescan.
-- They were missing from the original 20260504000001_client_site_pages.sql migration.

ALTER TABLE client_site_pages
  ADD COLUMN IF NOT EXISTS status_code               INTEGER,
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS geo_detection_method      TEXT,
  ADD COLUMN IF NOT EXISTS geo_confidence            NUMERIC(4,3);

-- Index for status_code range queries (2xx/3xx/4xx/5xx filters in the pages list endpoint)
CREATE INDEX IF NOT EXISTS idx_client_site_pages_status_code
  ON client_site_pages(client_id, status_code);
