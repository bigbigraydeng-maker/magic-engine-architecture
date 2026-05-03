-- Monthly Report Aggregation: P8.C.1
-- Consolidated dashboard of all datasources (AI Tracker, Link Intelligence, SERP, Local, Market Baseline, Billing)

-- Main monthly report table
CREATE TABLE datasource_monthly_reports (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM format

  -- AI Visibility Tracker metrics
  ai_avg_ranking DECIMAL(5, 2),
  ai_ranking_change DECIMAL(5, 2),
  ai_tracked_questions INTEGER DEFAULT 0,

  -- Link Intelligence metrics
  backlinks_total INTEGER DEFAULT 0,
  backlinks_new_this_month INTEGER DEFAULT 0,
  backlinks_lost_this_month INTEGER DEFAULT 0,
  backlinks_quality_score DECIMAL(5, 2),

  -- SERP Intelligence metrics
  serp_avg_position DECIMAL(5, 2),
  serp_position_change DECIMAL(5, 2),
  serp_tracked_keywords INTEGER DEFAULT 0,
  serp_top10_keywords INTEGER DEFAULT 0,
  serp_top50_keywords INTEGER DEFAULT 0,
  serp_new_rankings INTEGER DEFAULT 0,
  serp_lost_rankings INTEGER DEFAULT 0,

  -- Local Visibility metrics
  local_avg_position DECIMAL(5, 2),
  local_tracked_keywords INTEGER DEFAULT 0,
  local_top10_keywords INTEGER DEFAULT 0,
  local_cities_covered INTEGER DEFAULT 0,

  -- Market Baseline metrics
  market_opportunity_score DECIMAL(5, 2),
  market_top_opportunities INTEGER DEFAULT 0,
  market_underperformers INTEGER DEFAULT 0,

  -- Billing metrics
  billing_total_cost DECIMAL(12, 4) DEFAULT 0,
  billing_total_api_calls BIGINT DEFAULT 0,

  -- Metadata
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(client_id, month)
);

-- Report snapshots (hourly/daily for trend analysis)
CREATE TABLE datasource_monthly_report_snapshots (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES datasource_monthly_reports(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Key metrics snapshot
  ai_avg_ranking DECIMAL(5, 2),
  serp_avg_position DECIMAL(5, 2),
  serp_top10_keywords INTEGER,
  backlinks_total INTEGER,
  market_opportunity_score DECIMAL(5, 2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(report_id, snapshot_date)
);

-- Detailed datasource sections (normalized for flexibility)
CREATE TABLE datasource_report_sections (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES datasource_monthly_reports(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL, -- 'ai_tracker', 'link_intel', 'serp', 'local', 'market', 'billing'
  section_data JSONB NOT NULL, -- Flexible storage for various section data
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(report_id, section_type)
);

-- Indexes
CREATE INDEX idx_monthly_reports_client_month ON datasource_monthly_reports(client_id, month DESC);
CREATE INDEX idx_monthly_reports_updated ON datasource_monthly_reports(updated_at DESC);
CREATE INDEX idx_monthly_snapshots_report ON datasource_monthly_report_snapshots(report_id);
CREATE INDEX idx_report_sections_report ON datasource_report_sections(report_id);
CREATE INDEX idx_report_sections_type ON datasource_report_sections(section_type);

-- Row Level Security (optional, for multi-tenant safety)
ALTER TABLE datasource_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasource_monthly_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasource_report_sections ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see reports for their clients
CREATE POLICY "monthly_reports_client_isolation" ON datasource_monthly_reports
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE workspace_id = auth.jwt() ->> 'workspace_id'
    )
  );
