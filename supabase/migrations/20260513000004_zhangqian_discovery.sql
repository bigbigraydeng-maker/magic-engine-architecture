-- P8.10.S0.1-S0.2: 张骞 Zhangqian Discovery Agent — DB schema
-- One discovery report per client (UPSERT semantics); 30-day expiry.

DO $$ BEGIN
  CREATE TYPE discovery_job_status AS ENUM ('pending','running','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── client_discovery ─────────────────────────────────────────────────────────
-- One row per client. UPSERT on (client_id). JSONB payload follows the
-- DiscoveryReport schema defined in src/lib/zhangqian/types.ts.

CREATE TABLE IF NOT EXISTS client_discovery (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,
  payload       JSONB NOT NULL,
  cost_usd      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  model         TEXT NOT NULL,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  confirmed_at  TIMESTAMPTZ,
  confirmed_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_discovery_client_id  ON client_discovery(client_id);
CREATE INDEX IF NOT EXISTS idx_client_discovery_expires_at ON client_discovery(expires_at);

ALTER TABLE client_discovery ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_discovery FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE client_discovery IS
  'P8.10.S0: Zhangqian Discovery Agent output. One row per client (UPSERT). 30-day expiry. payload follows DiscoveryReport schema.';

-- ── client_discovery_jobs ────────────────────────────────────────────────────
-- Async task tracking. Multiple rows per client (one per run attempt).

CREATE TABLE IF NOT EXISTS client_discovery_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  status          discovery_job_status NOT NULL DEFAULT 'pending',
  progress_note   TEXT,             -- e.g. "searching Instagram…"
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10, 4) NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_discovery_jobs_client_id  ON client_discovery_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_client_discovery_jobs_status     ON client_discovery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_client_discovery_jobs_created_at ON client_discovery_jobs(created_at DESC);

ALTER TABLE client_discovery_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_discovery_jobs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE client_discovery_jobs IS
  'P8.10.S0: Async job tracking for Zhangqian Discovery Agent runs.';
