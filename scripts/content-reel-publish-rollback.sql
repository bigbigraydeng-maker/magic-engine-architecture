-- =============================================================================
-- Rollback for supabase/migrations/20260915140000_content_reel_publish_attempts.sql
-- (spec docs/specs/2026-09-15-creatomate-reel-publish-spec-v2.md v2.1 §10.5)
--
-- NOT a migration — run by hand, only after PM go, and only after the order in
-- spec §10.5 has been followed:
--   1. CONTENT_REEL_PUBLISH_LIVE off; every client switch set false via the RPC
--   2. every in-flight attempt driven to a terminal state through the normal flow
--   3. application code rolled back (routes, Inngest functions, measurement
--      trigger, entry-point guards) and Inngest re-synced
-- Then run this file in ONE transaction:
--   psql -v ON_ERROR_STOP=1 -1 -f scripts/content-reel-publish-rollback.sql
--
-- Behaviour:
--   * RPCs are always dropped (nothing can write through them any more).
--   * If any of the three tables holds rows, tables, their guard triggers and
--     the two added columns are KEPT as audit evidence (service_role keeps read
--     access). ON DELETE RESTRICT stays: deleting a client/post that has publish
--     records keeps failing on purpose; relaxing that needs a separate PM go.
--   * If all three tables are empty, everything this migration created is dropped
--     (columns only when they carry no non-default value).
-- =============================================================================

DROP FUNCTION IF EXISTS public.content_reel_video_copy_start(uuid, uuid, uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.content_reel_video_copy_finish(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.content_reel_authorize(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.content_reel_transition(uuid, text[], text, jsonb);
DROP FUNCTION IF EXISTS public.content_reel_mark_post_published(uuid);
DROP FUNCTION IF EXISTS public.content_reel_followup_patch(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.content_reel_append_event_id(uuid, text);
DROP FUNCTION IF EXISTS public.content_reel_next_restart_seq(uuid);
DROP FUNCTION IF EXISTS public.content_reel_abandon_post(uuid, uuid);
DROP FUNCTION IF EXISTS public.set_content_reel_live_enabled(uuid, boolean, boolean, uuid, text, text);

DO $$
DECLARE
  v_has_data boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.content_reel_publish_attempts)
      OR EXISTS (SELECT 1 FROM public.content_reel_video_copies)
      OR EXISTS (SELECT 1 FROM public.content_reel_live_switch_events)
    INTO v_has_data;

  IF v_has_data THEN
    RAISE NOTICE 'content-reel rollback: tables contain rows -> kept as audit evidence; RPCs dropped';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS clients_content_reel_live_guard ON public.clients;
  DROP FUNCTION IF EXISTS public.clients_content_reel_live_guard();

  DROP TABLE public.content_reel_publish_attempts;
  DROP TABLE public.content_reel_live_switch_events;
  DROP TABLE public.content_reel_video_copies;
  DROP FUNCTION IF EXISTS public.content_reel_attempts_guard();
  DROP FUNCTION IF EXISTS public.content_reel_video_copies_guard();
  DROP FUNCTION IF EXISTS public.content_reel_live_switch_events_guard();
  DROP FUNCTION IF EXISTS public.content_reel_transition_allowed(text, text);

  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE content_reel_live_enabled) THEN
    ALTER TABLE public.clients DROP COLUMN content_reel_live_enabled;
  ELSE
    RAISE NOTICE 'content-reel rollback: some client still has content_reel_live_enabled=true -> column kept';
  END IF;

  DROP INDEX IF EXISTS public.content_posts_import_source_url;
  IF NOT EXISTS (SELECT 1 FROM public.content_posts WHERE import_source_url IS NOT NULL) THEN
    ALTER TABLE public.content_posts DROP COLUMN import_source_url;
  ELSE
    RAISE NOTICE 'content-reel rollback: content_posts.import_source_url has values -> column kept (index dropped)';
  END IF;

  RAISE NOTICE 'content-reel rollback: all objects removed';
END $$;
