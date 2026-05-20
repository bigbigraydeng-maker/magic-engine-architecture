-- Migration: zhuge_sessions
-- Stores the full ZhugeOutput (all 6 dimensions including reputation + competitor)
-- so that the ZhugePriorityWidget can restore its state after navigation.
--
-- Previously, only the 4-flywheel dimensions were saved to flywheel_actions,
-- which caused reputation/competitor actions to be lost on page navigation.
-- This table holds the complete output keyed by session_key (stable hash of
-- client_id + discovery_id + diagnostic_run_id).

CREATE TABLE IF NOT EXISTS zhuge_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  session_key   text        NOT NULL,
  output        jsonb       NOT NULL,
  generated_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT zhuge_sessions_client_session_unique UNIQUE (client_id, session_key)
);

-- Index for fast lookup of the latest session per client
CREATE INDEX IF NOT EXISTS idx_zhuge_sessions_client_generated
  ON zhuge_sessions (client_id, generated_at DESC);

-- RLS: service role only (internal API)
ALTER TABLE zhuge_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_zhuge_sessions"
  ON zhuge_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
