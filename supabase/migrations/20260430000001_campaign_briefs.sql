-- ============================================================
-- Campaign Briefs Pipeline
-- Multiple active campaigns per client (concurrent product lines)
-- ============================================================

-- 1. campaign_briefs table
CREATE TABLE IF NOT EXISTS campaign_briefs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'archived')),
  title            TEXT        NOT NULL,
  description      TEXT,
  source_urls      TEXT[]      NOT NULL DEFAULT '{}',
  source_file_urls TEXT[]      NOT NULL DEFAULT '{}',
  parsed_content   TEXT,
  semrush_keywords JSONB       NOT NULL DEFAULT '[]',
  valid_from       DATE,
  valid_until      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_client_id
  ON campaign_briefs(client_id);

CREATE INDEX IF NOT EXISTS idx_campaign_client_active
  ON campaign_briefs(client_id)
  WHERE status = 'active';

-- RLS
ALTER TABLE campaign_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_briefs_service_role_full
  ON campaign_briefs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_campaign_briefs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_campaign_briefs_updated_at
  BEFORE UPDATE ON campaign_briefs
  FOR EACH ROW EXECUTE FUNCTION update_campaign_briefs_updated_at();

-- ============================================================
-- 2. content_posts — add campaign tracking
-- ============================================================
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS campaign_id   UUID
    REFERENCES campaign_briefs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_mode  VARCHAR(20) NOT NULL DEFAULT 'brand'
    CHECK (content_mode IN ('brand', 'campaign'));

CREATE INDEX IF NOT EXISTS idx_posts_campaign_id
  ON content_posts(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ============================================================
-- 3. keywords — add source tracking
-- ============================================================
ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS source      VARCHAR(30) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'airtable', 'master_brief', 'campaign', 'semrush')),
  ADD COLUMN IF NOT EXISTS campaign_id UUID
    REFERENCES campaign_briefs(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Storage bucket for campaign file uploads
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-uploads',
  'campaign-uploads',
  false,
  31457280,   -- 30 MB
  ARRAY['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY campaign_uploads_service_role
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'campaign-uploads')
  WITH CHECK (bucket_id = 'campaign-uploads');
