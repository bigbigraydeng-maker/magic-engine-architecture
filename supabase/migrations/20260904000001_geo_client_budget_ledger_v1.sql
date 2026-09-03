-- ============================================================================
-- Magic Engine 2.0 · GEO 每客户预算账本 + 原子预留 RPC（Issue #1347 · 自动重测预算闸）
--
-- ⚠️ **本文件只提交代码与测试，尚未 apply。** apply 是单独授权的运维动作，
--    绝不夹带进任何 PR（WP00 §9.2 / CLAUDE.md 铁律 2 的不可逆操作例外）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么必须有这张表 + 这个函数
-- ────────────────────────────────────────────────────────────────────────────
--
-- WP04 的 `preflightBudget`（src/lib/geo-measurement-runtime/budget.ts:26）只在**单次
-- 进程的内存账**上工作：`plan.budgetUsd - ledger.worstCaseSpent`，而 `plan.budgetUsd`
-- 在手动脚本里来自环境变量、每次运行都从满额开始。GEO 一旦自动化（Inngest 定时 + 人手
-- 脚本两个入口），两个批次可能在同一分钟各读到「还剩 $X」、各自在自己进程内认为没超、
-- 合计花掉两倍 —— preflightBudget 是纯函数，对这个并发场景无能为力（魏征复审 #1）。
--
-- 真正缺的不是「另一个闸」，是**一个跨进程、原子的额度来源**：每客户每月一个上限，
-- reserved（在途预留）+ spent（已结算）两个累加器，预留时**在数据库里一次原子判断+累加**。
-- 两个并发预留里只有一个能拿到额度，另一个被拒 —— 这是 preflightBudget 之前那一层。
--
-- ────────────────────────────────────────────────────────────────────────────
-- fail-closed 设计
-- ────────────────────────────────────────────────────────────────────────────
--
-- 🔴 **没有预算行 = 拒绝，不自动建默认额度。** PM 没为这个客户这个月批额度，就不许自动花钱。
-- 🔴 预留判据是 `cap - reserved - spent >= worst_case`；判断与累加在**同一条 UPDATE** 里，
--    靠行锁做到原子（两个并发 UPDATE 串行化，第二个看到的是第一个累加后的 reserved）。
-- 🔴 刻意 INVOKER（不写 SECURITY DEFINER），与 geo_persist_batch_v1 一致：调用方已是
--    service_role，不需要提权；提权只会扩大攻击面。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.geo_client_budgets (
  client_id     uuid        NOT NULL,
  -- 预算窗口，形如 '2026-09'（月）。窗口粒度由调用方决定，这里只存字符串键。
  period_key    text        NOT NULL,
  -- PM 授权的该窗口花费上限（USD）。只有 PM 能改（改额度走单独授权的运维动作）。
  cap_usd       numeric(12,4) NOT NULL,
  -- 在途预留：已放行但尚未结算的最坏成本之和。
  reserved_usd  numeric(12,4) NOT NULL DEFAULT 0,
  -- 已结算实际花费之和。
  spent_usd     numeric(12,4) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_client_budgets_pk PRIMARY KEY (client_id, period_key),
  CONSTRAINT geo_budget_cap_non_negative      CHECK (cap_usd >= 0),
  CONSTRAINT geo_budget_reserved_non_negative CHECK (reserved_usd >= 0),
  CONSTRAINT geo_budget_spent_non_negative    CHECK (spent_usd >= 0),
  -- 🔴 reserved + spent 永不超过 cap（数据库层硬约束，防任何路径把账写穿）。
  CONSTRAINT geo_budget_within_cap CHECK (reserved_usd + spent_usd <= cap_usd)
);

ALTER TABLE public.geo_client_budgets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.geo_client_budgets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 原子预留：判断+累加在同一条 UPDATE 里。返回 jsonb，绝不抛「余额不足」当异常。
--   { reserved: true,  remaining_usd }                        额度足，已预留 worst_case
--   { reserved: false, reason: 'no_budget_row' }              该客户该窗口没批额度 → fail-closed
--   { reserved: false, reason: 'insufficient', remaining_usd} 额度不足以覆盖 worst_case
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_reserve_budget_v1(
  p_client_id   uuid,
  p_period_key  text,
  p_worst_case_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
-- 🔴 刻意 INVOKER（不写 SECURITY DEFINER）。
AS $$
DECLARE
  v_row public.geo_client_budgets%ROWTYPE;
  v_remaining numeric;
BEGIN
  IF p_worst_case_usd IS NULL OR NOT (p_worst_case_usd > 0) THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_worst_case');
  END IF;

  -- 先锁行看存在性（区分「没批额度」与「余额不足」两种拒绝）。
  SELECT * INTO v_row FROM public.geo_client_budgets
    WHERE client_id = p_client_id AND period_key = p_period_key
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'no_budget_row');
  END IF;

  v_remaining := v_row.cap_usd - v_row.reserved_usd - v_row.spent_usd;
  IF v_remaining < p_worst_case_usd THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'insufficient',
                              'remaining_usd', v_remaining);
  END IF;

  UPDATE public.geo_client_budgets
    SET reserved_usd = reserved_usd + p_worst_case_usd, updated_at = now()
    WHERE client_id = p_client_id AND period_key = p_period_key;

  RETURN jsonb_build_object('reserved', true,
                            'remaining_usd', v_remaining - p_worst_case_usd);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 结算：批次跑完后把预留挪成实际花费。actual 未知时传 worst_case（保守，不退钱）。
--   释放的预留 = min(reserved_usd, p_reserved_usd)（防重复结算把 reserved 减成负）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_settle_budget_v1(
  p_client_id   uuid,
  p_period_key  text,
  p_reserved_usd numeric,
  p_actual_usd   numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.geo_client_budgets%ROWTYPE;
  v_release numeric;
  v_charge  numeric;
BEGIN
  IF p_reserved_usd IS NULL OR p_reserved_usd < 0 OR p_actual_usd IS NULL OR p_actual_usd < 0 THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'invalid_amounts');
  END IF;

  SELECT * INTO v_row FROM public.geo_client_budgets
    WHERE client_id = p_client_id AND period_key = p_period_key
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'no_budget_row');
  END IF;

  v_release := LEAST(v_row.reserved_usd, p_reserved_usd);
  -- 实际花费不采信超过预留上界的值（provider 报的成本是输入不是事实）。
  v_charge  := LEAST(p_actual_usd, p_reserved_usd);

  UPDATE public.geo_client_budgets
    SET reserved_usd = reserved_usd - v_release,
        spent_usd    = spent_usd + v_charge,
        updated_at   = now()
    WHERE client_id = p_client_id AND period_key = p_period_key;

  RETURN jsonb_build_object('settled', true, 'charged_usd', v_charge);
END;
$$;

GRANT EXECUTE ON FUNCTION public.geo_reserve_budget_v1(uuid, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.geo_settle_budget_v1(uuid, text, numeric, numeric) TO service_role;
