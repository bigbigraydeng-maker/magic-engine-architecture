-- Add 'generating' and 'failed' statuses to blog_posts
-- Enables background generation: POST returns immediately, generation runs async.
-- Reference: Phase 14 background blog generation feature

ALTER TABLE blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_status_check;

ALTER TABLE blog_posts
  ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'approved', 'published', 'rejected', 'generating', 'failed'));
