-- ============================================
-- Add format + ratio columns to content_posts
-- 2026-05-28
-- ============================================
-- These columns were referenced by Launch Hub (/api/clients/[id]/posts)
-- but were never added to the table, causing the query to fail and
-- preventing approved posts from appearing in Launch Hub.
--
-- format: post format type (reel, video, feed, image, story, carousel)
-- ratio:  aspect ratio string (9:16, 16:9, 4:5, 1:1, etc.)
-- Both nullable — existing posts created via Social Matrix will have NULL.
-- ============================================

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS ratio  text;
