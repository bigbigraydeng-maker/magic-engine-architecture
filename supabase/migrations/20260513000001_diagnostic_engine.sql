-- P8.5.1: Diagnostic Engine — four-table schema
-- Dimensions: seo, ai_visibility, ads, social, reputation, competitor
-- Reference: ROADMAP.md P8.5, DIAGNOSTIC_ENGINE_SPEC.md §2

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE diagnostic_dimension AS ENUM (
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'
);

CREATE TYPE diagnostic_severity AS ENUM (
  'critical', 'high', 'medium', 'low', 'info'
);

CREATE TYPE diagnostic_fix_type AS ENUM (
  'me_auto', 'fde_manual', 'third_party'
);

CREATE TYPE diagnostic_run_status AS ENUM (
  'pending', 'running', 'completed', 'failed'
);

CREATE TYPE diagnostic_trigger AS ENUM (
  'user', 'cron', 'onboarding'
);

CREATE TYPE prescription_status AS ENUM (
  'draft', 'approved', 'rejected', 'superseded'
);

CREATE TYPE execution_item_status AS ENUM (
  'pending', 'in_progress', 'completed', 'skipped'
);

-- ── §2.1: diagnostic_runs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  triggered_by          diagnostic_trigger NOT NULL DEFAULT 'user',
  status                diagnostic_run_status NOT NULL DEFAULT 'pending',
  dimensions_requested  diagnostic_dimension[] NOT NULL DEFAULT '{}',
  overall_score         SMALLINT CHECK (overall_score >= 0 AND overall_score <= 100),
  dimension_scores      JSONB,         -- {seo: 72, ai_visibility: 45, ...}
  findings_count        INTEGER NOT NULL DEFAULT 0,
  critical_count        INTEGER NOT NULL DEFAULT 0,
  high_count            INTEGER NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagnostic_runs_client_id     ON diagnostic_runs(client_id);
CREATE INDEX idx_diagnostic_runs_client_status ON diagnostic_runs(client_id, status);
CREATE INDEX idx_diagnostic_runs_created_at    ON diagnostic_runs(created_at DESC);

ALTER TABLE diagnostic_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view diagnostic runs for their clients"
  ON diagnostic_runs FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_runs.client_id));

CREATE POLICY "Users can insert diagnostic runs for their clients"
  ON diagnostic_runs FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_runs.client_id));

CREATE POLICY "Users can update diagnostic runs for their clients"
  ON diagnostic_runs FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_runs.client_id));

-- ── §2.2: diagnostic_findings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES diagnostic_runs(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dimension       diagnostic_dimension NOT NULL,
  finding_type    TEXT NOT NULL,       -- FK-free; validated in application layer
  severity        diagnostic_severity NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  evidence        JSONB,               -- raw collector data supporting the finding
  recommendation  TEXT NOT NULL,
  fix_type        diagnostic_fix_type NOT NULL,
  priority_score  FLOAT NOT NULL DEFAULT 0 CHECK (priority_score >= 0 AND priority_score <= 100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagnostic_findings_run_id     ON diagnostic_findings(run_id);
CREATE INDEX idx_diagnostic_findings_client_dim ON diagnostic_findings(client_id, dimension);
CREATE INDEX idx_diagnostic_findings_severity   ON diagnostic_findings(run_id, severity);
CREATE INDEX idx_diagnostic_findings_priority   ON diagnostic_findings(run_id, priority_score DESC);

ALTER TABLE diagnostic_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view diagnostic findings for their clients"
  ON diagnostic_findings FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_findings.client_id));

CREATE POLICY "Users can insert diagnostic findings for their clients"
  ON diagnostic_findings FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = diagnostic_findings.client_id));

-- ── §2.3: prescriptions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id          UUID NOT NULL REFERENCES diagnostic_runs(id) ON DELETE CASCADE,
  status          prescription_status NOT NULL DEFAULT 'draft',
  intake          JSONB,               -- PrescriptionIntake (§4.1)
  content         JSONB,               -- PrescriptionContent (§4.3)
  generated_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prescriptions_client_id     ON prescriptions(client_id);
CREATE INDEX idx_prescriptions_run_id        ON prescriptions(run_id);
CREATE INDEX idx_prescriptions_client_status ON prescriptions(client_id, status);

CREATE OR REPLACE FUNCTION update_prescriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescriptions_updated_at_trigger
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION update_prescriptions_updated_at();

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view prescriptions for their clients"
  ON prescriptions FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = prescriptions.client_id));

CREATE POLICY "Users can insert prescriptions for their clients"
  ON prescriptions FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = prescriptions.client_id));

CREATE POLICY "Users can update prescriptions for their clients"
  ON prescriptions FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = prescriptions.client_id));

-- ── §2.4: execution_items ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS execution_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id  UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  finding_id       UUID REFERENCES diagnostic_findings(id) ON DELETE SET NULL,
  dimension        diagnostic_dimension NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  fix_type         diagnostic_fix_type NOT NULL,
  status           execution_item_status NOT NULL DEFAULT 'pending',
  assigned_to      TEXT,
  due_date         DATE,
  completed_at     TIMESTAMPTZ,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_execution_items_prescription_id ON execution_items(prescription_id);
CREATE INDEX idx_execution_items_client_status   ON execution_items(client_id, status);
CREATE INDEX idx_execution_items_client_dimension ON execution_items(client_id, dimension);
CREATE INDEX idx_execution_items_sort            ON execution_items(prescription_id, sort_order);

CREATE OR REPLACE FUNCTION update_execution_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_items_updated_at_trigger
  BEFORE UPDATE ON execution_items
  FOR EACH ROW EXECUTE FUNCTION update_execution_items_updated_at();

ALTER TABLE execution_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view execution items for their clients"
  ON execution_items FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = execution_items.client_id));

CREATE POLICY "Users can insert execution items for their clients"
  ON execution_items FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = execution_items.client_id));

CREATE POLICY "Users can update execution items for their clients"
  ON execution_items FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = execution_items.client_id));
