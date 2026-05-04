/**
 * GIN index migration for site_audit_pages table
 *
 * Adds full-text search capabilities and performance optimization:
 * - tsvector column: searchable text combining title + url + markdown content
 * - GIN indexes: for fast full-text search, topic array queries, and common filters
 */

-- Add tsvector column for full-text search
ALTER TABLE site_audit_pages
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create index on tsvector for full-text search (GIN for speed)
CREATE INDEX IF NOT EXISTS idx_site_audit_pages_search_vector
ON site_audit_pages USING GIN(search_vector);

-- Create GIN index for array searches (topics)
CREATE INDEX IF NOT EXISTS idx_site_audit_pages_topics
ON site_audit_pages USING GIN(topics);

-- Create composite index for common queries: (client_id, page_type, has_geo_block)
CREATE INDEX IF NOT EXISTS idx_site_audit_pages_client_type_geo
ON site_audit_pages(client_id, page_type, has_geo_block);

-- Create index for URL lookups (commonly needed for deduplication)
CREATE INDEX IF NOT EXISTS idx_site_audit_pages_client_url
ON site_audit_pages(client_id, url);

-- Create index for pagination and sorting
CREATE INDEX IF NOT EXISTS idx_site_audit_pages_client_updated
ON site_audit_pages(client_id, updated_at DESC);

-- Create function to update search_vector on insert/update
CREATE OR REPLACE FUNCTION update_site_audit_pages_search_vector()
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

-- Create trigger to update search_vector on insert/update
DROP TRIGGER IF EXISTS trigger_site_audit_pages_search_vector ON site_audit_pages;
CREATE TRIGGER trigger_site_audit_pages_search_vector
BEFORE INSERT OR UPDATE ON site_audit_pages
FOR EACH ROW
EXECUTE FUNCTION update_site_audit_pages_search_vector();

-- Populate search_vector for existing rows
UPDATE site_audit_pages
SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(url, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(primary_keyword, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(markdown_content, '')), 'C')
WHERE search_vector IS NULL;
