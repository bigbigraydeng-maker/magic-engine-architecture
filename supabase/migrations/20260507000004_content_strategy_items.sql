-- P8.1.1: Create content_strategy_items table for three-dimensional content strategy analysis

CREATE TYPE action_type_enum AS ENUM ('upgrade_page', 'new_blog', 'social_content');
CREATE TYPE content_mode_enum AS ENUM ('unified', 'geo_only', 'seo_only');
CREATE TYPE strategy_priority_enum AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE strategy_status_enum AS ENUM ('pending', 'approved', 'in_progress', 'done', 'dismissed');

CREATE TABLE IF NOT EXISTS content_strategy_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  strategy_run_id     UUID NOT NULL,

  -- Strategy classification
  action_type         action_type_enum NOT NULL,
  content_mode        content_mode_enum NOT NULL,
  priority            strategy_priority_enum NOT NULL,
  priority_score      FLOAT NOT NULL CHECK (priority_score >= 0 AND priority_score <= 100),

  -- Strategy content
  proposed_title      TEXT NOT NULL,
  rationale           TEXT NOT NULL,
  content_angle       TEXT,

  -- Data sources (three-dimensional signals)
  source_page_id      UUID REFERENCES client_site_pages(id) ON DELETE SET NULL,
  source_query_id     UUID REFERENCES ai_visibility_queries(id) ON DELETE SET NULL,
  source_keyword      TEXT,
  keyword_volume      INTEGER,
  keyword_kd          INTEGER,

  -- Execution status
  status              strategy_status_enum NOT NULL DEFAULT 'pending',
  linked_blog_post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_strategy_items_client_status
  ON content_strategy_items(client_id, status);

CREATE INDEX idx_strategy_items_client_run
  ON content_strategy_items(client_id, strategy_run_id);

CREATE INDEX idx_strategy_items_priority_score
  ON content_strategy_items(client_id, priority_score DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_content_strategy_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_strategy_items_updated_at_trigger
BEFORE UPDATE ON content_strategy_items
FOR EACH ROW
EXECUTE FUNCTION update_content_strategy_items_updated_at();

-- RLS
ALTER TABLE content_strategy_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view strategy items for their clients"
  ON content_strategy_items FOR SELECT
  USING (
    auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = content_strategy_items.client_id)
  );

CREATE POLICY "Users can insert strategy items for their clients"
  ON content_strategy_items FOR INSERT
  WITH CHECK (
    auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = content_strategy_items.client_id)
  );

CREATE POLICY "Users can update strategy items for their clients"
  ON content_strategy_items FOR UPDATE
  USING (
    auth.uid() IN (SELECT user_id FROM client_team WHERE client_id = content_strategy_items.client_id)
  );
