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
  v_run     public.action_runs%ROWTYPE;
  v_pending public.authorization_decisions%ROWTYPE;
  v_new_id  uuid;
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
  IF p_expected_decision_id IS NOT NULL THEN
    IF v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
      RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
    END IF;

    -- 🔴 **锚的完整身份核对 —— 跟 kernel_resolve_pending_approval 同一套判据。**
    --
    --    「指针指着它」还不够。`authorization_decision_id` 是外键，数据库只保证
    --    这个 id **存在**，不保证它指着的那条决策属于这条 run、这个客户。
    --    库里一次错挂（并发写歪、恢复路径写歪、手工改数据）之后，
    --    preflight 失败 / 政策漂移的失败落地会一路走到底 —— 而新签的 deny 记录里
    --    `policy_id` / `policy_version` 是**从那份别人的决策里抄过来的**：
    --    跨客户的数据被写进这个客户的 append-only 审计记录。
    --
    --    resolve 那边（第 ④ / ④b 步）早就在锁内做这组核对了。写入的两条路
    --    不许一条严一条松 —— 松的那条就是被绕过去的那条。
    SELECT * INTO v_pending FROM public.authorization_decisions
     WHERE id = p_expected_decision_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'pending_not_found', NULL::uuid; RETURN;
    END IF;
    IF v_pending.action_run_id <> v_run.id THEN
      RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
    END IF;
    IF v_pending.verdict <> 'require_approval' THEN
      RETURN QUERY SELECT false, 'not_require_approval', NULL::uuid; RETURN;
    END IF;
    IF v_pending.client_id <> v_run.client_id
       OR v_pending.action_key <> v_run.action_key
       OR v_pending.action_version <> v_run.action_version
       OR v_pending.idempotency_key <> v_run.idempotency_key THEN
      RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
    END IF;

    -- 🔴 **这里刻意不镜像 resolve 的「政策三连」（行身份 / 版本 / 模式）。**
    --    那三条问的是「政策自挂起以来变没变」—— 而这条路**正是为了记下
    --    「它变了、所以做不了」**。把它镜像过来，政策一漂移这条 deny 就永远
    --    落不了地：run 卡在 pending_approval，谁都不知道为什么。
    --    resolve 自己的 reject 分支同样跳过政策三连，理由一样。
    --    身份判据（这份请求是不是这条 run 的）跟批不批准无关，两条路都过；
    --    政策判据（现在还准不准做）只属于放行那条路。
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


-- ============================================================================
-- 人工批准/拒绝：身份核对提到 approve / reject 的**公共**分支
--
-- 🔴 原来 `kernel_resolve_pending_approval` 只在 approve 分支核对
--    「这份审批请求是不是这条 run 的」（client_id / action_key / 版本 / 幂等键）。
--    reject 分支在那之前就返回了 —— 于是库里一次错挂（decision 的
--    action_run_id 对得上，但 client_id 属于**另一个客户**）时，
--    当前客户可以把它拒掉，而新签的 deny 记录会把**那个客户的**
--    policy_id / policy_version 抄进自己的 append-only 审计记录。
--
--    拒绝不需要查政策（政策删了、变了，人依然有权说「不做」）——
--    但「这份请求是不是这条 run 的」跟批不批准无关，两条路都得过。
--
-- 函数体其余部分与历史迁移里的版本逐字相同；签名没变，
-- 所以这里是真正的 CREATE OR REPLACE（不需要 DROP，也不动 REVOKE/GRANT）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval(
  p_run_id              uuid,
  p_pending_decision_id uuid,
  p_resolution          text,     -- 'approve' | 'reject'
  p_resolved_by         text,
  p_reason              text,
  p_policy_snapshot     jsonb DEFAULT '{}',
  p_cost_estimate_usd   numeric DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_pending  public.authorization_decisions%ROWTYPE;
  v_policy   public.client_automation_policies%ROWTYPE;
  v_new_id   uuid;
  v_cost_cap numeric;
BEGIN
  IF p_resolution NOT IN ('approve','reject') THEN
    RETURN QUERY SELECT false, 'bad_resolution', NULL::uuid; RETURN;
  END IF;

  -- ① 锁 run —— 批准、拒绝、以及并发的另一次批准，全在这把锁上排队
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- ② 必须**仍然**停在等审批。running / succeeded / denied 一律不许覆盖。
  IF v_run.status <> 'pending_approval' THEN
    RETURN QUERY SELECT false, 'not_pending:' || v_run.status, NULL::uuid; RETURN;
  END IF;

  -- ③ run 当前指着的必须还是这份审批请求（防拿旧页面上的过期请求来批）
  IF v_run.authorization_decision_id IS DISTINCT FROM p_pending_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
  END IF;

  -- ④ 锁住这份审批请求本身，并核对它的身份
  SELECT * INTO v_pending FROM public.authorization_decisions
   WHERE id = p_pending_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'pending_not_found', NULL::uuid; RETURN;
  END IF;
  IF v_pending.action_run_id <> v_run.id THEN
    RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
  END IF;
  IF v_pending.verdict <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'not_require_approval', NULL::uuid; RETURN;
  END IF;

  -- 🔴 ④b 身份核对 —— **approve 和 reject 共用**。（Codex P2）
  --
  --    这一段原来只在 approve 分支里（原第 ⑥ 步）。于是库里一次错挂
  --    （decision 的 action_run_id 对得上这条 run，但 client_id 是**另一个客户**）
  --    时，reject 这条路会一路走到底：新签的 deny 记录 client_id 是对的，
  --    但 policy_id / policy_version 是**从那份别人的决策里抄过来的** ——
  --    跨客户的数据被写进了这个客户的 append-only 审计记录里。
  --
  --    拒绝确实不需要查政策（政策删了、变了，人依然有权说「不做」），
  --    但「这份请求到底是不是这条 run 的」跟批不批准无关，两条路都得过。
  IF v_pending.client_id <> v_run.client_id
     OR v_pending.action_key <> v_run.action_key
     OR v_pending.action_version <> v_run.action_version
     OR v_pending.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
  END IF;

  IF p_resolution = 'reject' THEN
    -- 拒绝不查政策：政策被删了、变了，人依然有权说「不做」。
    INSERT INTO public.authorization_decisions
      (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
       policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
       cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
    VALUES
      (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'deny',
       'policy_deny', p_reason, p_policy_snapshot, v_pending.policy_id,
       v_pending.policy_version, 'human', p_resolved_by,
       v_run.cost_cap_usd, v_run.cost_estimate_usd, v_run.idempotency_key, NULL)
    RETURNING id INTO v_new_id;

    UPDATE public.action_runs
       SET status = 'denied',
           authorization_decision_id = v_new_id,
           needs_human = false,
           -- 🔴 T1：这是一次**交接**，不是继续推进 —— 把租约清干净。
           --    挂起等审批期间那份租约的 owner 早就走了；不清的话，
           --    真正要来推进的人会被这份僵尸租约挡成「已经有人在做了」。
           claimed_by       = NULL,
           claimed_at       = NULL,
           heartbeat_at     = NULL,
           lease_expires_at = NULL,
           last_error  = p_reason,
           finished_at = now(),
           updated_at  = now()
     WHERE id = v_run.id;

    RETURN QUERY SELECT true, 'rejected', v_new_id; RETURN;
  END IF;

  -- ── approve ────────────────────────────────────────────────────────────
  -- ⑤ 政策三连（跟执行前同一套）：当前生效的那一行必须还是挂起时那一行、
  --    同一版、且模式仍是「要人审」。时间窗口径与 kernel_begin_authorized_run 一致。
  --
  -- 🔴 **`FOR UPDATE` —— 政策行必须被锁住，一路锁到事务提交。**（Codex P2）
  --
  --    不锁的话有一个真实窗口：Settings 在这句 `SELECT` 读到旧版
  --    `require_approval` 之后、下面那条 allow 写进去之前提交了一次改动
  --    （比如把模式改成 `deny`）。这个函数拿着旧快照照签 allow、把 run 改成
  --    `authorized`、并向审批人回「成功」—— 而客户的规则此刻已经是「禁止」。
  --    Gateway 开跑前会重读政策再拦一次，所以**不会**真的执行；但
  --    append-only 的审计表里已经留下一条**签发当时就已失效**的放行，
  --    而那条 run 还得再走一次重新授权才能恢复。审计记录说的必须是当时的事实。
  --
  --    🔴 **锁顺序固定：run → pending decision → active policy。**
  --       三把锁在这个函数里永远按这个顺序拿；`kernel_record_fenced_deny`
  --       只拿前两把（它不读政策）。顺序一致 = 不会互相成环 = 不会死锁。
  --
  --    🔴 `ORDER BY … LIMIT 1 FOR UPDATE` 的语义要说清：并发事务把选中那行
  --       改成不再满足 WHERE 时，Postgres 会重新求值（EvalPlanQual）并返回 0 行 ——
  --       于是这里走 `no_active_policy`，那是**正确**的答案（此刻确实没有生效的规则）。
  --
  --    ⚠️ 代价要写明：锁住当前活动行会挡住并发的 UPDATE / DELETE，也会挡住
  --       「先关掉旧行、再插一条新活动行」那种切换流程 —— 它得等这次审批提交。
  --       这是刻意的取舍：审批只占一个很短的事务，而拿旧快照签放行是错的。
  SELECT * INTO v_policy
    FROM public.client_automation_policies p
   WHERE p.client_id = v_run.client_id
     AND p.action_key = v_run.action_key
     AND p.effective_from <= now()
     AND (p.effective_to IS NULL OR p.effective_to > now())
   ORDER BY p.effective_from DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_active_policy', NULL::uuid; RETURN;
  END IF;
  -- 🔴 三连一律在**拿到锁之后**核对 —— 锁之前比等于比一份可能马上过期的快照。
  IF v_policy.id IS DISTINCT FROM v_pending.policy_id THEN
    RETURN QUERY SELECT false, 'policy_identity_changed', NULL::uuid; RETURN;
  END IF;
  IF v_policy.policy_version IS DISTINCT FROM v_pending.policy_version THEN
    RETURN QUERY SELECT false, 'stale_policy_version', NULL::uuid; RETURN;
  END IF;
  IF v_policy.mode <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed', NULL::uuid; RETURN;
  END IF;

  v_cost_cap := COALESCE(v_policy.spend_cap_per_run_usd, 0);

  -- ⑦ 一次性：签人签的放行 + run → authorized + 指向新决策
  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'allow',
     NULL, p_reason, p_policy_snapshot, v_policy.id, v_policy.policy_version,
     'human', p_resolved_by, v_cost_cap, p_cost_estimate_usd,
     v_run.idempotency_key,
     now() + (v_policy.decision_ttl_seconds * interval '1 second'))
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'authorized',
         authorization_decision_id = v_new_id,
         cost_cap_usd = v_cost_cap,
         cost_estimate_usd = p_cost_estimate_usd,
         needs_human = false,
         -- 🔴 T1：批准是一次**交接**。挂起等审批期间留下的那份租约，
         --    它的 owner 早就走了 —— 不清掉的话，真正要来推进这条 run 的人
         --    会被这份僵尸租约挡成「已经有人在做了」，而实际没有任何人在做。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'approved', v_new_id;
END;
$$;
