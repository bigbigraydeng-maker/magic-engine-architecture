-- P8.10.S6: 三代理复盘引擎
-- 一键复盘：基于原诊断 + 处方 KPI + 执行进度 + 工作日志，由 Claude 产出结构化复盘报告。
-- content 遵循 ProjectReviewContent schema（src/lib/review/types.ts）。
-- 访问方式：仅通过 supabaseAdmin（service role）+ Bearer token API。

CREATE TABLE IF NOT EXISTS project_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('generating', 'completed', 'failed')),
  summary      TEXT,
  content      JSONB,
  meta         JSONB,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_reviews_client
  ON project_reviews(client_id, created_at DESC);

COMMENT ON TABLE project_reviews IS '三代理复盘引擎产出的复盘报告（P8.10.S6）';
