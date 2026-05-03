-- ============================================
-- Generation Queue Enhancements
-- 2026-04-28
-- ============================================

-- 1. Add retry tracking and scheduling columns to visual_assets
ALTER TABLE visual_assets
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(50);

-- 2. Create generation_attempts table for historical tracking
CREATE TABLE IF NOT EXISTS public.generation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'processing', 'success', 'failed', 'timeout')),
  error_code VARCHAR(50),
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_generation_attempts_asset ON public.generation_attempts(asset_id);
CREATE INDEX idx_generation_attempts_status ON public.generation_attempts(status, created_at DESC);
CREATE INDEX idx_generation_attempts_created ON public.generation_attempts(created_at DESC);

ALTER TABLE public.generation_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.generation_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Create indexes for efficient retry scheduling
CREATE INDEX IF NOT EXISTS idx_visual_assets_next_retry_at ON public.visual_assets(next_retry_at) WHERE generation_status = 'queued_for_retry';
CREATE INDEX IF NOT EXISTS idx_visual_assets_queued_at ON public.visual_assets(queued_at);

-- 4. updated_at trigger for generation_attempts
CREATE TRIGGER generation_attempts_updated_at
  BEFORE UPDATE ON public.generation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
