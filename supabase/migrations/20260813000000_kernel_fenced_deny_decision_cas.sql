-- ============================================================================
-- Magic Engine 2.0 · 人工批准失败落地的决策指针 CAS（K-WP01A · PR #962 复审整改）
--
-- 🔴 已合并进 main 的历史迁移一律不可变 —— 直接改写
--    `20260808000003_me2_execution_kernel_v1.sql` 只对「从未 apply 过」的环境生效，
--    已 apply 过的环境仍然停在旧函数上，永远拿不到新行为。所以走前向迁移。
--
-- 改的是什么
--   `kernel_record_fenced_deny` 原来只有两道闸：代际（fencing）和状态
--   （`p_expected_status`，人工批准失败落地传 'pending_approval'）。
--   两道都挡不住这一种：**审批人点同意之后、preflight 还在读政策的那段时间里，
--   这条 run 被重新排了一次，挂上了另一份待审批请求**。状态仍是 pending_approval，
--   于是那次迟到的「批不了」会把新请求直接盖成 denied —— 而正在看新请求的人
--   什么都不知道。
--
--   新增第六个参数 `p_expected_decision_id`（DEFAULT NULL）+ 锁内 CAS，
--   判据跟 `kernel_resolve_pending_approval` 第 ③ 步逐字一致。
--   传 NULL = 跳过（自动授权路径没有「审批人看到的那份」这个概念）。
--
-- 🔴 为什么要先 DROP：加了带默认值的第六参之后，旧的五参版本**不会**被替换掉，
--    两个重载会同时存在，而五参形式的调用从此有歧义（PostgREST 会报
--    "Could not choose the best candidate function"）。必须先把旧签名删干净。
--    这个函数除 Kernel 之外没有任何调用方，删了不影响别的东西。
--
-- 函数体其余部分与历史迁移里的版本逐字相同。
-- 见 src/lib/kernel/store.ts 的 recordFencedDeny 与 authorize.ts 的 recordDeny。
-- ============================================================================

-- 旧签名（五参）—— 先删，避免与新签名形成有歧义的重载
DROP FUNCTION IF EXISTS public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny(
  p_run_id              uuid,
  p_expected_generation bigint,
  p_expected_status     text,
  p_decision            jsonb,
  p_reason              text,
  p_expected_decision_id uuid DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run    public.action_runs%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- 🔴 代际闸：过期的执行者不许把别人已经推进的 run 写成 denied。
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 跨客户：决策必须属于这条 run 的客户，否则会往审计表里写一条串台的记录。
  --    kernel_ensure_run_steps 有这道闸，这里以前没有 —— 同一类漏洞要一起堵。
  IF (p_decision->>'client_id')::uuid IS DISTINCT FROM v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client', NULL::uuid; RETURN;
  END IF;

  -- 状态闸（人工批准失败落地用）：只在仍停在那个状态时才写。
  IF p_expected_status IS NOT NULL AND v_run.status <> p_expected_status THEN
    RETURN QUERY SELECT false, 'not_' || p_expected_status || ':' || v_run.status, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 指针闸（人工批准失败落地用）：run 当前指着的必须还是**审批人看到的那一份**。
  --
  --    只有状态闸是不够的。`pending_approval` 期间这条 run 可能已经被重新排过一次：
  --    状态照样是 pending_approval，但挂着的已经是**另一份**待审批请求了。
  --    这时一次迟到的「批不了」会把那份**新的、还没人看过的**请求直接盖成 denied，
  --    而正在看它的人什么都不知道 —— 等于系统替他把那件事否了。
  --
  --    判据跟 kernel_resolve_pending_approval 第 ③ 步逐字一致，在同一把行锁里。
  --    p_expected_decision_id 为 NULL = 调用方没有「审批人看到的那份」这个概念
  --    （自动授权路径），跳过这道闸。
  IF p_expected_decision_id IS NOT NULL
     AND v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
  END IF;

  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id,
     (p_decision->>'client_id')::uuid,
     p_decision->>'action_key',
     (p_decision->>'action_version')::integer,
     'deny',
     p_decision->>'deny_code',
     p_reason,
     COALESCE(p_decision->'policy_snapshot', '{}'::jsonb),
     NULLIF(p_decision->>'policy_id','')::uuid,
     NULLIF(p_decision->>'policy_version','')::integer,
     COALESCE(p_decision->>'decided_by','policy'),
     NULLIF(p_decision->>'decided_by_user',''),
     NULLIF(p_decision->>'cost_cap_usd','')::numeric,
     NULLIF(p_decision->>'cost_estimate_usd','')::numeric,
     p_decision->>'idempotency_key',
     NULL)
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'denied',
         authorization_decision_id = v_new_id,
         needs_human = true,
         last_error  = p_reason,
         finished_at = now(),
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'denied', v_new_id;
END;
$$;

-- 🔴 签名变了，收口语句必须跟着变到新签名上。
--    漏掉 REVOKE 的话，新函数对 PUBLIC / anon / authenticated 保持默认可执行 ——
--    而 anon key 是印在浏览器 bundle 里的。
REVOKE EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text, uuid)
  TO service_role;
