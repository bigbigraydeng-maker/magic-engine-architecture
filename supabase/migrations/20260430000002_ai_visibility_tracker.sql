-- ============================================================
-- AI Visibility Tracker (Phase 7.1)
-- Track brand rankings across multiple AI engines
-- (OpenAI / Anthropic / Perplexity, with Google AIO in Phase 8)
--
-- Reference: ARCHITECTURE.md §12, ROADMAP.md P7.1.1
-- ============================================================

-- ============================================================
-- 1. ai_visibility_queries — Industry questions to track
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_visibility_queries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question      TEXT        NOT NULL,
  source        VARCHAR(20) NOT NULL DEFAULT 'manual'
                CHECK (source IN ('auto_generated', 'manual')),
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  -- Geographic context tag for the question (AU/NZ market focus)
  market_tag    VARCHAR(20)             DEFAULT NULL,
  notes         TEXT                    DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_queries_client_id
  ON ai_visibility_queries(client_id);

CREATE INDEX IF NOT EXISTS idx_ai_queries_client_enabled
  ON ai_visibility_queries(client_id)
  WHERE enabled = true;

-- ============================================================
-- 2. ai_visibility_runs — Each LLM invocation result
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_visibility_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  query_id            UUID        NOT NULL REFERENCES ai_visibility_queries(id) ON DELETE CASCADE,
  -- Engine grouping (stable across model upgrades)
  ai_engine           VARCHAR(20) NOT NULL
                      CHECK (ai_engine IN ('openai', 'anthropic', 'perplexity', 'google')),
  -- Specific model name (free-form, evolves over time)
  ai_model            VARCHAR(50) NOT NULL,
  raw_response        TEXT                    DEFAULT NULL,
  -- Structured ranking extracted from raw_response
  -- Shape: [{ "brand": "CTS Tours", "rank": 1, "snippet": "...", "url": "..." }]
  brands_mentioned    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Client's own brand rank in this run (NULL = not mentioned)
  client_brand_rank   INT                     DEFAULT NULL,
  -- Run metadata for cost / performance tracking
  tokens_used         INT                     DEFAULT NULL,
  cost_usd            NUMERIC(10,4)           DEFAULT NULL,
  latency_ms          INT                     DEFAULT NULL,
  error_message       TEXT                    DEFAULT NULL,
  ran_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_client_ran_at
  ON ai_visibility_runs(client_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_runs_query_engine_ran_at
  ON ai_visibility_runs(query_id, ai_engine, ran_at DESC);

-- ============================================================
-- 3. ai_visibility_snapshots — Weekly aggregated state
-- One row per client per week (Monday's date as key)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Monday of the week this snapshot covers (e.g. 2026-04-27)
  week_of         DATE        NOT NULL,
  -- Aggregated metrics
  avg_rank        NUMERIC(5,2)            DEFAULT NULL,
  mentions_count  INT         NOT NULL DEFAULT 0,
  total_runs      INT         NOT NULL DEFAULT 0,
  models_covered  TEXT[]      NOT NULL DEFAULT '{}',
  -- Full ranking table for reporting
  -- Shape: { "brands": [{ name, avg_rank, by_engine: {...} }],
  --          "queries": [{ question, ranks: {...} }] }
  ranking_table   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ensure one snapshot per client per week
  UNIQUE(client_id, week_of)
);

CREATE INDEX IF NOT EXISTS idx_ai_snapshots_client_week
  ON ai_visibility_snapshots(client_id, week_of DESC);

-- ============================================================
-- 4. Row-Level Security
-- ============================================================
ALTER TABLE ai_visibility_queries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_visibility_queries_service_role_full
  ON ai_visibility_queries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY ai_visibility_runs_service_role_full
  ON ai_visibility_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY ai_visibility_snapshots_service_role_full
  ON ai_visibility_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. updated_at trigger (queries only — runs/snapshots are append-only)
-- ============================================================
CREATE OR REPLACE FUNCTION update_ai_visibility_queries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_ai_visibility_queries_updated_at
  BEFORE UPDATE ON ai_visibility_queries
  FOR EACH ROW EXECUTE FUNCTION update_ai_visibility_queries_updated_at();
