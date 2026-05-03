-- ============================================
-- Visual Asset Version Management
-- Phase 8.Q.1 — External Edit Workflow
-- 2026-05-03
-- ============================================

-- 1. Add version-tracking columns to visual_assets
ALTER TABLE public.visual_assets
  ADD COLUMN IF NOT EXISTS current_version_num  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_final             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_edit_status TEXT
    CHECK (external_edit_status IN ('needs_external_edit', 'in_external_edit', 'final'));

-- 2. Create visual_asset_versions table
CREATE TABLE IF NOT EXISTS public.visual_asset_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID        NOT NULL REFERENCES public.visual_assets(id) ON DELETE CASCADE,
  version_num  INT         NOT NULL DEFAULT 1,
  storage_url  TEXT        NOT NULL,
  uploaded_by  TEXT        NOT NULL DEFAULT 'system',
  -- 'system' = AI generated | 'user:<email>' = manually uploaded
  edit_type    TEXT        NOT NULL DEFAULT 'ai_generated'
                           CHECK (edit_type IN ('ai_generated', 'external_edit', 'manual_replacement')),
  edit_notes   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.visual_asset_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.visual_asset_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_visual_asset_versions_asset ON public.visual_asset_versions(asset_id, version_num DESC);

-- 3. Back-fill: create a v1 record for every existing asset that has a storage_url
INSERT INTO public.visual_asset_versions (asset_id, version_num, storage_url, uploaded_by, edit_type)
SELECT
  id,
  1,
  storage_url,
  'system',
  CASE provider
    WHEN 'upload' THEN 'manual_replacement'
    ELSE 'ai_generated'
  END
FROM public.visual_assets
WHERE storage_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4. Mark all existing ready assets as is_final=true (they are the current "best" version)
UPDATE public.visual_assets
SET is_final = true
WHERE generation_status = 'ready'
  AND storage_url IS NOT NULL;
