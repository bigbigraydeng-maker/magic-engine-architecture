-- P8.0.8: Corrective migration for GIN index on client_site_pages
--
-- Migration 20260505000002_gin_index_site_audit_pages.sql targeted the
-- non-existent table "site_audit_pages" instead of "client_site_pages".
-- This migration creates the correct indexes and search infrastructure.

-- Add tsvector column for full-text search
ALTER TABLE client_site_pages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_client_site_pages_search_vector
  ON client_site_pages USING GIN(search_vector);

-- GIN index for topic array searches
CREATE INDEX IF NOT EXISTS idx_client_site_pages_topics
  ON client_site_pages USING GIN(topics);

-- Composite index for common filter queries: (client_id, page_type, has_geo_block)
CREATE INDEX IF NOT EXISTS idx_client_site_pages_client_type_geo
  ON client_site_pages(client_id, page_type, has_geo_block);

-- Function to keep search_vector in sync
CREATE OR REPLACE FUNCTION update_client_site_pages_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.url, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.primary_keyword, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.markdown_content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update search_vector on insert/update
DROP TRIGGER IF EXISTS trigger_client_site_pages_search_vector ON client_site_pages;
CREATE TRIGGER trigger_client_site_pages_search_vector
BEFORE INSERT OR UPDATE ON client_site_pages
FOR EACH ROW
EXECUTE FUNCTION update_client_site_pages_search_vector();

-- Back-fill search_vector for any existing rows
UPDATE client_site_pages
SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(url, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(primary_keyword, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(markdown_content, '')), 'C')
WHERE search_vector IS NULL;
