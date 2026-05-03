-- ============================================
-- Reels Studio — reels_drafts table
-- 2026-05-02  Phase 8.R
-- ============================================

-- 1. Allow post_id to be NULL so visual_assets can be linked to reels drafts
--    (previously always required a content_post parent)
ALTER TABLE public.visual_assets
  ALTER COLUMN post_id DROP NOT NULL;

-- 2. Add a reels_draft_id back-reference on visual_assets
ALTER TABLE public.visual_assets
  ADD COLUMN IF NOT EXISTS reels_draft_id UUID;

-- 3. reels_drafts table
CREATE TABLE IF NOT EXISTS public.reels_drafts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_brief_id       UUID REFERENCES public.campaign_briefs(id) ON DELETE SET NULL,

  -- AI-generated prompts (all editable by user)
  opening_frame_prompt    TEXT,
  closing_frame_prompt    TEXT,
  i2v_video_prompt        TEXT,   -- Opening: ... | Middle: ... | Closing: ...
  fb_caption              TEXT,

  -- Reference frame URLs (uploaded by user after Loveart generation)
  opening_frame_url       TEXT,
  closing_frame_url       TEXT,

  -- Video result (populated after I2V completes)
  video_url               TEXT,
  provider_job_id         TEXT,   -- Atlas job ID for polling

  -- Chat history for AI refinement: [{role: "user"|"assistant", content: string}]
  chat_history            JSONB NOT NULL DEFAULT '[]',

  status                  TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'images_ready', 'video_generating', 'video_ready')),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reels_drafts_client_id_idx
  ON public.reels_drafts(client_id);

CREATE INDEX IF NOT EXISTS reels_drafts_status_idx
  ON public.reels_drafts(client_id, status);

ALTER TABLE public.reels_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.reels_drafts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. updated_at auto-trigger
CREATE TRIGGER reels_drafts_updated_at
  BEFORE UPDATE ON public.reels_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
