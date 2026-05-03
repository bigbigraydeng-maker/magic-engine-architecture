-- ============================================
-- Master Brief Pipeline
-- 2026-04-29
-- ============================================
-- Extends master_briefs with full pipeline fields.
-- Backward-compatible: keeps is_active, adds status with backfill.
-- ============================================

-- 1. Allow brand_name to be null (needed for AI-generated drafts)
ALTER TABLE public.master_briefs
  ALTER COLUMN brand_name DROP NOT NULL;

-- 2. Add status enum + backfill from is_active
ALTER TABLE public.master_briefs
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived'));

UPDATE public.master_briefs
  SET status = CASE WHEN is_active = true THEN 'active' ELSE 'archived' END
  WHERE status IS NULL OR status = 'draft';

-- 3. Add pillar_id to content_posts
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS pillar_id VARCHAR(50);

-- 4. Add all new pipeline fields
ALTER TABLE public.master_briefs
  ADD COLUMN IF NOT EXISTS content_pillars       JSONB,
  ADD COLUMN IF NOT EXISTS brand_voice           JSONB,
  ADD COLUMN IF NOT EXISTS target_audience       JSONB,
  ADD COLUMN IF NOT EXISTS platform_strategy     JSONB,
  ADD COLUMN IF NOT EXISTS keyword_seeds         TEXT[],
  ADD COLUMN IF NOT EXISTS competitor_domains    TEXT[],
  ADD COLUMN IF NOT EXISTS vi_colors             JSONB,
  ADD COLUMN IF NOT EXISTS vi_style_keywords     TEXT[],
  ADD COLUMN IF NOT EXISTS vi_dos                TEXT[],
  ADD COLUMN IF NOT EXISTS vi_donts              TEXT[],
  ADD COLUMN IF NOT EXISTS brand_story_md        TEXT,
  ADD COLUMN IF NOT EXISTS style_guide_md        TEXT,
  ADD COLUMN IF NOT EXISTS competitive_notes_md  TEXT,
  ADD COLUMN IF NOT EXISTS source_file_urls      TEXT[],
  ADD COLUMN IF NOT EXISTS source_website_urls   TEXT[],
  ADD COLUMN IF NOT EXISTS semrush_snapshot      JSONB,
  ADD COLUMN IF NOT EXISTS generated_by          VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS input_tokens          INT,
  ADD COLUMN IF NOT EXISTS model_used            VARCHAR(80);

-- 5. Unique index: only one active brief per client
CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_client_active
  ON public.master_briefs(client_id)
  WHERE status = 'active';

-- 6. Storage bucket for brief uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brief-uploads',
  'brief-uploads',
  false,
  31457280,  -- 30MB
  ARRAY['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage policy for brief-uploads (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'service_role_brief_uploads'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY service_role_brief_uploads
        ON storage.objects FOR ALL TO service_role
        USING (bucket_id = 'brief-uploads')
        WITH CHECK (bucket_id = 'brief-uploads')
    $policy$;
  END IF;
END
$$;

-- 8. Index for efficient brief queries
CREATE INDEX IF NOT EXISTS idx_mb_client_status
  ON public.master_briefs(client_id, status);
