-- Facebook 帖子 T+N 表现回收：测量回执表 + 三处业务身份唯一约束
--
-- 为什么要新表：现有三张 flywheel 表都表达不了「读不到」。
--   · flywheel_metrics.metric_value 是 NOT NULL —— 无法测量没法写行；
--   · flywheel_outcomes 是归因结论，本期不写，冒充它会污染归因语义；
--   · 把回执塞进 flywheel_actions.payload 需要 read-modify-write，
--     T+4 与 T+72 两个独立 run 并发时会互相覆盖。
--
-- 所以只加这一张最小表，只装完成 Act→Check 所需字段。不存 token、不存完整响应。
--
-- 可重复执行：全部 IF NOT EXISTS / EXCEPTION WHEN duplicate_object。

CREATE TABLE IF NOT EXISTS public.social_post_measurement_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 发布动作行。回执与它一一对应，单帖查询从这里进。
  action_id       UUID NOT NULL REFERENCES public.flywheel_actions(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  post_id         TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  -- 这次测量对应事件里的哪个窗口（4 / 72 …）。窗口值来自事件，不是常量。
  window_hours    INTEGER NOT NULL CHECK (window_hours > 0),
  -- 事件约定的应测时刻 vs 实际读到的时刻。迟测不算错，但要看得见。
  target_at       TIMESTAMPTZ NOT NULL,
  measured_at     TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'unmeasurable')),
  -- 明确读到的数字，例如 {"likes": 12, "comments": 3, "shares": 1}
  values          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 没读到的字段及保守原因，例如 {"shares": "omitted_unverified"}
  missing         JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT,
  graph_code      INTEGER,
  graph_subcode   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 业务身份：一个动作的一个窗口只有一条回执。重跑同窗口更新同一行，不新增第二行。
CREATE UNIQUE INDEX IF NOT EXISTS social_post_measurement_receipts_identity
  ON public.social_post_measurement_receipts (action_id, window_hours);

CREATE INDEX IF NOT EXISTS social_post_measurement_receipts_client
  ON public.social_post_measurement_receipts (client_id, created_at DESC);

ALTER TABLE public.social_post_measurement_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.social_post_measurement_receipts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 业务身份唯一约束：并发只能靠数据库挡，不能靠「先查询再插入」 ──────────────

-- 发布动作：同一客户、同一动作类型、同一 idempotency_key 只有一行。
-- 部分索引 —— 只约束本功能写的行（带 idempotency_key 的），对既有 social.publish_post
-- 行（Publer 路径，payload 里没有这个键）零影响。
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_idempotency
  ON public.flywheel_actions (client_id, action_type, (payload ->> 'idempotency_key'))
  WHERE action_type = 'social.publish_post'
    AND payload ->> 'idempotency_key' IS NOT NULL;

-- 测量数字：同一客户、同一指标、同一帖子、同一窗口只有一行。
-- 重跑复用原行，不产生重复数字。
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_metrics_post_measurement_identity
  ON public.flywheel_metrics (
    client_id,
    metric_key,
    (source_ref ->> 'idempotency_key'),
    (source_ref ->> 'window_hours')
  )
  WHERE source_ref ->> 'idempotency_key' IS NOT NULL
    AND source_ref ->> 'window_hours' IS NOT NULL;
