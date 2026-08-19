-- ============================================================================
-- Magic Engine 2.0 · 广告中枢 v1 原子预算预留（ADR 2026-08-20-me-ads-hub-v1-
-- atomic-budget-reservation，Build Control 木桶原则裁决修订版）
--
-- ⚠️ **本文件只提交代码与测试，尚未 apply。** apply 是单独授权的运维动作，
--    绝不夹带进任何 PR（CLAUDE.md 铁律 2 的不可逆操作例外 / kernel v1 migration
--    同一先例：见 20260808000003_me2_execution_kernel_v1.sql 文件头）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么是「单条终身额度记录」而不是按日/周分表
-- ────────────────────────────────────────────────────────────────────────────
--
-- Codex 复审 BLOCKER #2 指出：从 `ad_daily_insights`（次日才有数据）汇总历史
-- 花费判断超没超顶，不是真硬顶 —— 同一天多次批准会都读到同一份过期余额。
--
-- v1 广告中枢锁定「单一已发布 Reel、单一投放路径」（Build Control 裁决），
-- 不是一个跑很久的循环投放系统，所以不需要 daily/weekly 分周期表 —— 一条
-- （client_id, scope_key）的终身额度记录 + 四个状态桶就够表达全部状态。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 四态桶（Build Control 木桶原则第二轮裁决明确要求）
-- ────────────────────────────────────────────────────────────────────────────
--
--   reserved_amount_nzd               —— 已占用但还没真正写到 Meta 的额度
--   committed_amount_nzd              —— Meta 写入确认成功（建成 + 回读校验过）的额度
--   released_amount_nzd               —— 失败但确定没有产生任何外部副作用，退回去的额度
--   failed_needs_reconcile_amount_nzd —— Meta 写入结果不确定（超时/网络错误/回读跟
--                                        草案对不上）的额度 —— **仍然算在硬顶里**，
--                                        直到人工核实清楚移去 committed 或 released，
--                                        绝不能因为「不确定」就当作没花过
--
-- 硬顶判定公式：reserved + committed + failed_needs_reconcile <= cap
-- （released 不算——那是确认过真的没发生的钱；failed_needs_reconcile 必须算，
--  因为「不知道」比「确定没花」危险，宁可拦住下一笔也不能让不确定的钱溜过硬顶）
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么是「单条语句原子读改写」而不是 SELECT FOR UPDATE + 应用层判断再 UPDATE
-- ────────────────────────────────────────────────────────────────────────────
--
-- 后者是两次往返（一次 SELECT、一次 UPDATE），中间有窗口：两个并发请求都读到
-- 「还有余额」，都决定通过，都写。真正的原子性来自把「检查 + 更新」写进
-- **同一条** UPDATE 语句的 WHERE 子句 —— Postgres 对单条语句里同一行的
-- 读-判-写是原子的，不需要显式加锁。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ads_spend_reservations (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope_key                           text NOT NULL,  -- 'me_sandbox_v1_cts' 等

  currency                            text NOT NULL DEFAULT 'NZD',
  cap_amount_nzd                      numeric NOT NULL,
  reserved_amount_nzd                 numeric NOT NULL DEFAULT 0,
  committed_amount_nzd                numeric NOT NULL DEFAULT 0,
  released_amount_nzd                 numeric NOT NULL DEFAULT 0,
  failed_needs_reconcile_amount_nzd   numeric NOT NULL DEFAULT 0,

  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),

  -- 跟 kernel policy 的 spend_caps_are_real_amounts 同一招：NaN 最阴，
  -- `x > 'NaN'::numeric` 恒假，硬顶判定会悄悄失效。
  CONSTRAINT ads_spend_amounts_are_real_amounts CHECK (
    cap_amount_nzd >= 0 AND cap_amount_nzd <> 'NaN'::numeric AND cap_amount_nzd < 'Infinity'::numeric
    AND reserved_amount_nzd >= 0 AND reserved_amount_nzd <> 'NaN'::numeric
    AND committed_amount_nzd >= 0 AND committed_amount_nzd <> 'NaN'::numeric
    AND released_amount_nzd >= 0 AND released_amount_nzd <> 'NaN'::numeric
    AND failed_needs_reconcile_amount_nzd >= 0 AND failed_needs_reconcile_amount_nzd <> 'NaN'::numeric
  ),

  UNIQUE (client_id, scope_key)
);

ALTER TABLE public.ads_spend_reservations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.ads_spend_reservations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- ads_reserve_spend_v1 —— 原子预留
--
-- 第一次调用时若该 (client_id, scope_key) 还没有记录，用 p_cap_amount_nzd 建一条
-- （`ON CONFLICT DO NOTHING`，cap 只在首次生效，后续调用即便传不同的 cap 也不改
--  —— 改 cap 是 policy 变更，应该走独立的管理动作，不能藏在一次 reserve 调用里）。
--
-- 核心那条 UPDATE 的 WHERE 子句就是硬顶判定本身：
--   (reserved + committed + failed_needs_reconcile + 这次要加的) <= cap
-- 判定和更新是同一条语句，不存在「判完到写之间」的窗口。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_reserve_spend_v1(
  p_client_id       uuid,
  p_scope_key       text,
  p_cap_amount_nzd  numeric,
  p_amount_nzd      numeric
)
RETURNS jsonb
LANGUAGE plpgsql
-- 🔴 刻意 INVOKER（不写 SECURITY DEFINER）——唯一调用方是 service_role，
--    本来就有这张表的读写权限，DEFINER 只会凭空造一个提权面，理由同
--    geo_persist_batch_v1 文件头。
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.ads_spend_reservations;
BEGIN
  IF p_amount_nzd IS NULL OR p_amount_nzd <= 0 OR p_amount_nzd = 'NaN'::numeric THEN
    RAISE EXCEPTION 'ads_reserve_spend_v1: p_amount_nzd 必须是大于 0 的实数'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 首次调用才建行；已存在则忽略（cap 不因后续调用而改变）
  INSERT INTO public.ads_spend_reservations (client_id, scope_key, cap_amount_nzd)
  VALUES (p_client_id, p_scope_key, p_cap_amount_nzd)
  ON CONFLICT (client_id, scope_key) DO NOTHING;

  -- 原子读-判-写：整条语句是一次原子操作，WHERE 里的判定和 SET 里的更新
  -- 对同一行不可能被另一个并发调用插进中间。
  UPDATE public.ads_spend_reservations
     SET reserved_amount_nzd = reserved_amount_nzd + p_amount_nzd,
         updated_at = now()
   WHERE client_id = p_client_id
     AND scope_key = p_scope_key
     AND (reserved_amount_nzd + committed_amount_nzd + failed_needs_reconcile_amount_nzd + p_amount_nzd)
         <= cap_amount_nzd
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- 没更新到行 = 超顶，把当前状态原样读回来给调用方看清楚差多少
    SELECT * INTO v_row FROM public.ads_spend_reservations
     WHERE client_id = p_client_id AND scope_key = p_scope_key;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'over_cost_cap',
      'row', to_jsonb(v_row)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- ads_commit_spend_v1 / ads_release_spend_v1 / ads_mark_needs_reconcile_v1
--
-- 三个状态迁移都遵守同一个约束：**只能从 reserved 桶挪走**，不能凭空捏造
-- committed/released/needs_reconcile —— 钱必须先被预留过才能变成别的状态。
-- 这条约束靠 WHERE 里的 `reserved_amount_nzd >= p_amount_nzd` 保证，
-- 挪不动（reserved 不够）就返回 ok:false，不会把 reserved 减成负数。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_commit_spend_v1(
  p_client_id  uuid,
  p_scope_key  text,
  p_amount_nzd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.ads_spend_reservations;
BEGIN
  UPDATE public.ads_spend_reservations
     SET reserved_amount_nzd  = reserved_amount_nzd - p_amount_nzd,
         committed_amount_nzd = committed_amount_nzd + p_amount_nzd,
         updated_at = now()
   WHERE client_id = p_client_id AND scope_key = p_scope_key
     AND reserved_amount_nzd >= p_amount_nzd
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_reserved');
  END IF;
  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.ads_release_spend_v1(
  p_client_id  uuid,
  p_scope_key  text,
  p_amount_nzd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.ads_spend_reservations;
BEGIN
  UPDATE public.ads_spend_reservations
     SET reserved_amount_nzd = reserved_amount_nzd - p_amount_nzd,
         released_amount_nzd = released_amount_nzd + p_amount_nzd,
         updated_at = now()
   WHERE client_id = p_client_id AND scope_key = p_scope_key
     AND reserved_amount_nzd >= p_amount_nzd
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_reserved');
  END IF;
  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.ads_mark_needs_reconcile_v1(
  p_client_id  uuid,
  p_scope_key  text,
  p_amount_nzd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.ads_spend_reservations;
BEGIN
  UPDATE public.ads_spend_reservations
     SET reserved_amount_nzd               = reserved_amount_nzd - p_amount_nzd,
         failed_needs_reconcile_amount_nzd = failed_needs_reconcile_amount_nzd + p_amount_nzd,
         updated_at = now()
   WHERE client_id = p_client_id AND scope_key = p_scope_key
     AND reserved_amount_nzd >= p_amount_nzd
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_reserved');
  END IF;
  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$;

COMMENT ON FUNCTION public.ads_reserve_spend_v1(uuid, text, numeric, numeric) IS
  'ME 广告中枢 v1 原子预算预留：单条 UPDATE 的 WHERE 子句同时做硬顶判定和占用，无窗口期。';
COMMENT ON FUNCTION public.ads_commit_spend_v1(uuid, text, numeric) IS
  'reserved → committed：Meta 写入确认成功后调用。';
COMMENT ON FUNCTION public.ads_release_spend_v1(uuid, text, numeric) IS
  'reserved → released：确认没有产生任何外部副作用时调用。';
COMMENT ON FUNCTION public.ads_mark_needs_reconcile_v1(uuid, text, numeric) IS
  'reserved → failed_needs_reconcile：Meta 写入结果不确定时调用。这个桶仍然算在硬顶里，需要人工核实后再移走。';

-- 🔴 EXECUTE 先全撤再单授 —— 不留 PUBLIC 默认可执行。
REVOKE EXECUTE ON FUNCTION public.ads_reserve_spend_v1(uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ads_commit_spend_v1(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ads_release_spend_v1(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ads_mark_needs_reconcile_v1(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ads_reserve_spend_v1(uuid, text, numeric, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ads_commit_spend_v1(uuid, text, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ads_release_spend_v1(uuid, text, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ads_mark_needs_reconcile_v1(uuid, text, numeric) TO service_role;

-- 🔴 不发这一句，PostgREST 的 schema 缓存里没有这些函数，第一次 .rpc() 会拿到
--    「function does not exist」—— 看起来像「migration 没 apply」，能把人带偏很久。
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后必须自验的几条：
--
--   -- 四个函数都在，且都是 INVOKER (prosecdef = false)
--   SELECT p.proname, p.prosecdef
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'ads_%_spend_v1' OR p.proname = 'ads_mark_needs_reconcile_v1';
--
--   -- 只有 service_role 能执行
--   SELECT grantee, routine_name FROM information_schema.routine_privileges
--    WHERE routine_name IN ('ads_reserve_spend_v1','ads_commit_spend_v1',
--                            'ads_release_spend_v1','ads_mark_needs_reconcile_v1');
--
--   -- 并发硬顶回归（拿测试客户/scope 跑，跑完清理这一行）：
--   -- 连续调 20 次 ads_reserve_spend_v1(..., cap=300, amount=20)，
--   -- 应该恰好 15 次 ok:true（15*20=300），5 次 ok:false reason=over_cost_cap
-- ============================================================================
