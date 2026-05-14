-- P8.10.S5.3: 项目级鲁班对话线程
-- 区别于 luban_messages（绑定单个 execution_item），本表绑定整个 client，
-- 鲁班在这里能看到所有处方 + 所有执行项 + 全部进度。
-- 访问方式：仅通过 supabaseAdmin（service role）+ Bearer token API，沿用 luban_messages 的 RLS-disabled 模式。

CREATE TABLE IF NOT EXISTS luban_project_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_luban_project_messages_client
  ON luban_project_messages(client_id, created_at);

COMMENT ON TABLE luban_project_messages IS '项目级鲁班对话线程 — FDE 与鲁班讨论整个项目进度（P8.10.S5.3）';
