-- Add missing core_proposition column to master_briefs
-- Omitted from 20260429000001_master_brief_pipeline.sql

ALTER TABLE public.master_briefs
  ADD COLUMN IF NOT EXISTS core_proposition TEXT;
