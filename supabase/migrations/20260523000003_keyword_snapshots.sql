-- P12.I.8: Weekly keyword ranking snapshots for SEO Intelligence trends.
-- Stores DataForSEO ranked_keywords/live output per client/domain/keyword.

CREATE TABLE IF NOT EXISTS keyword_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain             TEXT NOT NULL,
  keyword            TEXT NOT NULL,
  position           INTEGER,
  search_volume      INTEGER,
  keyword_difficulty NUMERIC,
  cpc                NUMERIC,
  competition        NUMERIC,
  intent             TEXT,
  source             TEXT NOT NULL DEFAULT 'dataforseo',
  location_code      INTEGER NOT NULL,
  semrush_db         TEXT,
  snapshot_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  measured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT keyword_snapshots_position_check
    CHECK (position IS NULL OR position > 0),
  CONSTRAINT keyword_snapshots_unique_weekly
    UNIQUE (client_id, keyword, location_code, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_client_date
  ON keyword_snapshots(client_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_keyword_trend
  ON keyword_snapshots(client_id, keyword, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_position
  ON keyword_snapshots(client_id, position, snapshot_date DESC);

ALTER TABLE keyword_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON keyword_snapshots FOR ALL USING (true);

COMMENT ON TABLE keyword_snapshots IS
  'Weekly DataForSEO keyword ranking snapshots. Used by SEO Intelligence trend and position-change views.';
