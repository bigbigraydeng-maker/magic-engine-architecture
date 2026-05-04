-- Migration: Add dual-signal blog generation fields to blog_posts table
-- Phase: P7.3 (Dual-Signal Blog Generation)
-- Date: 2026-05-05
-- Purpose: Support three blog generation modes (unified/geo_only/seo_only) with keyword/SEMrush integration

-- Add new columns to blog_posts table
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'geo_only' NOT NULL CHECK (mode IN ('unified', 'geo_only', 'seo_only')),
ADD COLUMN IF NOT EXISTS primary_keyword VARCHAR(255),
ADD COLUMN IF NOT EXISTS keyword_volume INTEGER,
ADD COLUMN IF NOT EXISTS keyword_kd DECIMAL(5, 2),
ADD COLUMN IF NOT EXISTS keyword_intent VARCHAR(50),
ADD COLUMN IF NOT EXISTS source_query_id UUID REFERENCES ai_visibility_queries(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS geo_directive_version_id UUID REFERENCES geo_directives(id) ON DELETE SET NULL;

-- Create index on mode for faster filtering
CREATE INDEX IF NOT EXISTS idx_blog_posts_mode ON blog_posts(mode);

-- Create index on source_query_id for tracking GEO weak points
CREATE INDEX IF NOT EXISTS idx_blog_posts_source_query ON blog_posts(source_query_id);

-- Create composite index for finding unified opportunities (high-value content)
CREATE INDEX IF NOT EXISTS idx_blog_posts_unified_candidates
ON blog_posts(mode, keyword_kd, keyword_volume)
WHERE mode = 'unified' AND keyword_kd IS NOT NULL AND keyword_volume IS NOT NULL;

-- Add comment documenting the new schema
COMMENT ON COLUMN blog_posts.mode IS 'Blog generation mode: unified (SEO+GEO signals), geo_only (GEO signal only), seo_only (SEO signal only)';
COMMENT ON COLUMN blog_posts.primary_keyword IS 'Primary target keyword from SEMrush data';
COMMENT ON COLUMN blog_posts.keyword_volume IS 'Monthly search volume from SEMrush';
COMMENT ON COLUMN blog_posts.keyword_kd IS 'Keyword difficulty score from SEMrush (0-100)';
COMMENT ON COLUMN blog_posts.keyword_intent IS 'Search intent classification: comparison, how_to, recommendation, decision, discovery';
COMMENT ON COLUMN blog_posts.source_query_id IS 'Reference to AI Tracker weak-point query that triggered this blog';
COMMENT ON COLUMN blog_posts.geo_directive_version_id IS 'Version of GEO directive used in this blog (for tracking GEO signal effectiveness)';
