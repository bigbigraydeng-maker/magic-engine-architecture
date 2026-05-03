-- blog_posts: Dual-Signal Blog generation output
-- Mode: 'geo_only' for P7.3 MVP (unified/seo_only reserved for Phase 8)
-- Reference: ROADMAP.md P7.3.7, ARCHITECTURE.md §13.2

CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Content mode (MVP only uses geo_only)
  mode TEXT NOT NULL DEFAULT 'geo_only'
    CHECK (mode IN ('unified', 'geo_only', 'seo_only')),

  -- Topic origin
  topic                TEXT NOT NULL,
  source_query_id      UUID REFERENCES ai_visibility_queries(id) ON DELETE SET NULL,
  source_query_text    TEXT,          -- snapshot at generation time

  -- Article content
  title                TEXT NOT NULL DEFAULT '',
  meta_title           TEXT NOT NULL DEFAULT '',
  meta_description     TEXT NOT NULL DEFAULT '',
  slug                 TEXT,
  html_body            TEXT NOT NULL DEFAULT '',
  word_count           INT,

  -- GEO injection (P7.2 ↔ P7.3 integration)
  geo_directive_id     UUID REFERENCES geo_directives(id) ON DELETE SET NULL,
  geo_html_snapshot    TEXT,          -- locked at generation time, independent of future directive changes

  -- SEO extras
  schema_json          JSONB,
  internal_links       JSONB NOT NULL DEFAULT '[]',  -- [{anchor, target_slug, resolved}]

  -- Visual
  featured_image_prompt TEXT,
  featured_image_url    TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'published', 'rejected')),
  published_at         TIMESTAMPTZ,

  -- Generation metadata
  cost_usd             NUMERIC(10, 6),
  model_used           TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_client_status ON blog_posts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_client_mode   ON blog_posts(client_id, mode);
CREATE INDEX IF NOT EXISTS idx_blog_posts_query         ON blog_posts(source_query_id) WHERE source_query_id IS NOT NULL;

-- Auto-update updated_at (reuse function if it already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS: service_role_all (internal admin tool only)
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'blog_posts' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON blog_posts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
