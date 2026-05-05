-- ============================================
-- Reels Studio — enable Realtime via anon SELECT
-- 2026-05-06  Phase 8.R bugfix
-- ============================================
-- Problem: reels_drafts only had service_role policy.
-- Frontend Realtime subscription uses anon_key, so RLS
-- blocked postgres_changes events from being delivered.
-- Fix: allow anon SELECT so Supabase Realtime can push
-- row-change payloads to subscribed browser clients.

ALTER TABLE public.reels_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_for_realtime"
  ON public.reels_drafts
  FOR SELECT
  TO anon
  USING (true);
