-- P8.10.S0: Persist raw Claude output on validation failure.
-- Validation failures cost $0.80+ per run; this lets us diagnose schema
-- mismatches without re-running the agent.

ALTER TABLE client_discovery_jobs
  ADD COLUMN IF NOT EXISTS raw_output TEXT;

COMMENT ON COLUMN client_discovery_jobs.raw_output IS
  'Final assistant text from Claude when validation fails — lets us diagnose validator bugs without re-running ($0.80+/run).';
