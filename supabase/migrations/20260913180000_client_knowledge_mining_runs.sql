-- ============================================================================
-- 客户知识库 v1 — 萃取回执表（客户知识库设计 §9.14 E.3 / §3.2 / §9.8）
--
-- 只记账，不做判定：这张表**永不**自己批准任何事实——萃取工作流写进
-- client_knowledge_facts 的行永远是 status='candidate'，本表只留一条
-- "这一轮扫了什么、花了多少钱、留下多少候选" 的回执，供人工审核页和花费
-- 巡检使用。
--
-- 增量萃取（设计 §9.8）：`high_watermark_at` 记这一轮实际处理到的最新一条
-- 员工消息时间，下一轮从上一次成功轮的 watermark 之后开始，重跑不重复付费。
--
-- 花费硬顶（设计 §9.8）：三项预算字段全部 NOT NULL——缺任一项，应用层
-- assertMiningBudget() 直接拒绝运行，不允许"不限"这种隐式默认值。
--
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_knowledge_mining_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  status                text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  error                 text,
  CONSTRAINT error_matches_status CHECK (
    (status = 'failed') = (error IS NOT NULL)
  ),

  -- 本轮实际使用的预算硬顶（不是"当前配置"，是"这一轮真的受这三条约束"）。
  max_messages          integer NOT NULL CHECK (max_messages > 0),
  max_model_calls       integer NOT NULL CHECK (max_model_calls > 0),
  max_spend_usd         numeric NOT NULL CHECK (max_spend_usd > 0 AND max_spend_usd < 'Infinity'::numeric),

  -- 增量萃取水位：只处理上一次成功轮之后新出现的员工消息。
  low_watermark_at      timestamptz,
  high_watermark_at     timestamptz,

  conversations_scanned integer NOT NULL DEFAULT 0,
  messages_scanned      integer NOT NULL DEFAULT 0,
  templates_merged      integer NOT NULL DEFAULT 0,
  candidates_written    integer NOT NULL DEFAULT 0,
  conflict_groups       integer NOT NULL DEFAULT 0,
  -- 两个丢弃原因分开记账：deal_specific 是"这本来就是个案，不该成为通用事实"；
  -- provenance_rejected 是"模型编了一个源消息里没有的数字，直接判定为幻觉丢弃"
  -- （PITFALLS D1）。混在一起会让"模型经常编数字"这个信号被"正常个案多"盖住。
  provenance_rejected   integer NOT NULL DEFAULT 0,
  deal_specific_skipped integer NOT NULL DEFAULT 0,

  model_calls_used      integer NOT NULL DEFAULT 0,
  cost_usd              numeric NOT NULL DEFAULT 0,
  -- 🔴 T2c 同款坑（20260808000003 已踩过）：花费字段本身也必须是真实金额。
  CONSTRAINT cost_usd_is_a_real_amount CHECK (
    cost_usd >= 0 AND cost_usd <> 'NaN'::numeric AND cost_usd < 'Infinity'::numeric
  ),

  created_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_knowledge_mining_runs_client
  ON public.client_knowledge_mining_runs (client_id, created_at DESC);

ALTER TABLE public.client_knowledge_mining_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_mining_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
