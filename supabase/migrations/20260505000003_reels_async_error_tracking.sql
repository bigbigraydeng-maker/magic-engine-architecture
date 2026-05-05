-- ============================================
-- Reels Studio — async error tracking
-- 2026-05-05  Phase 8.R
-- ============================================

-- Add video_error column to track async failures
ALTER TABLE public.reels_drafts
  ADD COLUMN IF NOT EXISTS video_error TEXT;
