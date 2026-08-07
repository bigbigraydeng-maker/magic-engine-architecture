-- ============================================================================
-- Magic Engine 2.0 · Execution Kernel v1  (Issue #859 · ADR-001 / ADR-002 / ADR-004)
--
-- 域无关的执行内核。形状是从 `content_work_orders` 抬上来的（它是仓库里唯一
-- 一个已经跑对过的执行状态机），但**不是复制**：域阶段被赶进 step_key，
-- 通用状态留在 status，16 态收敛成 8 态。逐字段依据见 Issue #859 的
-- DESIGN-SUPPLEMENT-1 §2 extraction matrix。
--
-- 本迁移只**建表**。v1 不接任何 cron、不产生任何客户外部副作用。
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
--
-- 新增：
--   1. client_automation_policies  — 客户级 policy envelope（默认 deny 是「没有行」）
--   2. authorization_decisions     — append-only 授权审计
--   3. action_runs                 — 域无关执行实例
--   4. action_run_steps            — 多步 / 断点续跑 / 重试 / 死信 / 验证
--   5. kernel_claim_run_step()     — 原子认领（照抄 factory_claim_work_order 的形状）
--   6. flywheel_actions.action_run_id — 补上 lineage 的最后一条边（可空，零行为变化）
--   7. kernel_action_lineage       — 一条 SQL 走通 goal → outcome 的视图
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. client_automation_policies —— 客户级 policy envelope
--
-- 🔴 默认 deny 的实现方式是「查不到行 = deny」，不是给 mode 一个默认值。
--    默认值会让「忘了配」和「明确配了自动」在库里长得一样。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_automation_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_key               text NOT NULL,
  mode                     text NOT NULL CHECK (mode IN ('auto_approve','require_approval','deny')),

  -- 政策版本。改一次 +1；已签发但未消费的授权决策会因此变 stale，必须重新授权。
  policy_version           integer NOT NULL DEFAULT 1,

  -- 花钱信封。NULL = 该动作不许花钱（不是「不限」—— 不限必须显式写一个大数）。
  spend_cap_per_run_usd    numeric,
  spend_cap_per_period_usd numeric,
  spend_cap_period         text CHECK (spend_cap_period IN ('day','week','month')),

  -- 授权有效期。签发的 decision 最多活这么久，过期必须重走授权。
  decision_ttl_seconds     integer NOT NULL DEFAULT 900 CHECK (decision_ttl_seconds > 0),

  effective_from           timestamptz NOT NULL DEFAULT now(),
  effective_to             timestamptz,

  updated_by               text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT policy_window_sane CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- 有花费上限就必须说清是哪个周期，反之亦然
  CONSTRAINT policy_period_paired CHECK (
    (spend_cap_per_period_usd IS NULL) = (spend_cap_period IS NULL)
  )
);

-- 同一个客户 + 同一个动作，同一时刻只能有一条**还没过期**的政策。
CREATE UNIQUE INDEX IF NOT EXISTS idx_cap_active
  ON public.client_automation_policies (client_id, action_key)
  WHERE effective_to IS NULL;

ALTER TABLE public.client_automation_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.client_automation_policies
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. authorization_decisions —— append-only 授权审计
--
-- 当前 12 张日志表没有一张记「谁授权的、依据哪条政策」。这张补上。
-- append-only 由触发器强制：只允许把 consumed_at 从 NULL 写成一次值，
-- 其余列一律不可改，行不可删。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.authorization_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id          uuid NOT NULL,
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  action_key             text NOT NULL,
  action_version         integer NOT NULL,

  verdict                text NOT NULL CHECK (verdict IN ('allow','require_approval','deny')),
  -- 机器可读的拒绝原因（unknown_action / no_policy / policy_deny / over_cost_cap / ...）
  deny_code              text,
  -- 给人看的一句话，沿用 judgeAutoRun 已确立的风格
  reason                 text NOT NULL,

  -- 判定当时的政策快照 —— 政策后来改了也能复盘「当时凭什么放行」
  policy_snapshot        jsonb NOT NULL DEFAULT '{}',
  policy_version         integer,

  decided_by             text NOT NULL CHECK (decided_by IN ('policy','human')),
  decided_by_user        text,

  cost_cap_usd           numeric,
  cost_estimate_usd      numeric,
  idempotency_key        text NOT NULL,

  expires_at             timestamptz,
  -- 一次授权只能兑换一次执行。重放同一个 decision 必须失败。
  consumed_at            timestamptz,
  consumed_by            text,

  created_at             timestamptz NOT NULL DEFAULT now(),

  -- 人做的决定必须留下是谁做的；机器做的不许冒充人
  CONSTRAINT decided_by_user_present CHECK (
    (decided_by = 'human') = (decided_by_user IS NOT NULL)
  ),
  -- deny 必须有机器可读的码，allow 不许有
  CONSTRAINT deny_code_matches_verdict CHECK (
    (verdict = 'deny') = (deny_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_authz_run    ON public.authorization_decisions (action_run_id);
CREATE INDEX IF NOT EXISTS idx_authz_client ON public.authorization_decisions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_verdict ON public.authorization_decisions (verdict, created_at DESC);

ALTER TABLE public.authorization_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.authorization_decisions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- append-only 强制。审计记录能被改写 = 没有审计。
CREATE OR REPLACE FUNCTION public.authorization_decisions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'authorization_decisions is append-only: rows cannot be deleted';
  END IF;

  -- 唯一允许的变更：把 consumed_at / consumed_by 从 NULL 写成一次值（兑换授权）
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'authorization decision % already consumed at %', OLD.id, OLD.consumed_at;
  END IF;

  IF ROW(NEW.id, NEW.action_run_id, NEW.client_id, NEW.action_key, NEW.action_version,
         NEW.verdict, NEW.deny_code, NEW.reason, NEW.policy_snapshot, NEW.policy_version,
         NEW.decided_by, NEW.decided_by_user, NEW.cost_cap_usd, NEW.cost_estimate_usd,
         NEW.idempotency_key, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.action_run_id, OLD.client_id, OLD.action_key, OLD.action_version,
         OLD.verdict, OLD.deny_code, OLD.reason, OLD.policy_snapshot, OLD.policy_version,
         OLD.decided_by, OLD.decided_by_user, OLD.cost_cap_usd, OLD.cost_estimate_usd,
         OLD.idempotency_key, OLD.expires_at, OLD.created_at)
  THEN
    RAISE EXCEPTION 'authorization_decisions is append-only: only consumed_at/consumed_by may be set';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS authorization_decisions_append_only_trigger ON public.authorization_decisions;
CREATE TRIGGER authorization_decisions_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.authorization_decisions
  FOR EACH ROW EXECUTE FUNCTION public.authorization_decisions_append_only();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. action_runs —— 域无关的执行实例
--
-- 状态机（8 态，逐条依据见 Issue #859 §2.3）：
--   queued → authorizing → { authorized | pending_approval | denied }
--            authorized  → running → { succeeded | failed → dead_letter }
--            pending_approval → (人点) → authorized | denied
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.action_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 🔴 goal_id 不是 NOT NULL。仓库已经因为「强制挂 Goal」造过一个假 Goal
  --    （strategy/goals.ts 的 "[Migration] Unassigned Backlog"，每个查询还要把它滤掉）。
  --    维护 / 合规 / 恢复 / 系统卫生这四类任务本来就不服务任何增长目标。
  purpose                   text NOT NULL CHECK (purpose IN
                              ('growth','compliance','maintenance','recovery','housekeeping')),
  goal_id                   uuid REFERENCES public.goals(id) ON DELETE SET NULL,

  -- 双向约束：growth 必须有 Goal；非 growth 挂了 Goal **也拒绝**。
  -- 让「给维护任务伪造 Goal」在数据库层不可能，而不是靠约定。
  CONSTRAINT goal_matches_purpose CHECK ((purpose = 'growth') = (goal_id IS NOT NULL)),

  -- 连回人看的看板（execution_items 继续是意图卡，不是执行引擎）
  execution_item_id         uuid REFERENCES public.execution_items(id) ON DELETE SET NULL,

  triggered_by              text NOT NULL CHECK (triggered_by IN
                              ('signal','schedule','human','agent','run')),
  triggered_by_ref          text,

  action_key                text NOT NULL,
  action_version            integer NOT NULL,
  input                     jsonb NOT NULL DEFAULT '{}',

  -- 为什么做这件事 + 证据。形状抄自 content_work_orders 的
  -- rationale_one_liner / angle_source，但换掉了内容域的词汇。
  rationale                 text,
  evidence                  jsonb NOT NULL DEFAULT '{}',

  idempotency_key           text NOT NULL,

  status                    text NOT NULL DEFAULT 'queued' CHECK (status IN
                              ('queued','authorizing','authorized','pending_approval',
                               'denied','running','succeeded','failed','dead_letter',
                               'superseded')),

  authorization_decision_id uuid REFERENCES public.authorization_decisions(id) ON DELETE SET NULL,

  -- 贯穿 lineage 的关联号：一次触发可以生出多个 run，它们共享 correlation_id
  correlation_id            uuid NOT NULL DEFAULT gen_random_uuid(),

  -- 🔴 cap 在 run（授权时从 policy 快照下来的信封），actual 在 step（钱是在具体调用上花掉的）
  cost_cap_usd              numeric,
  cost_estimate_usd         numeric,

  -- 未知动作 / 死信 / 需要人判断 —— 必须有人看见，不许死在日志里
  needs_human               boolean NOT NULL DEFAULT false,
  last_error                text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  started_at                timestamptz,
  finished_at               timestamptz
);

-- 幂等：同一个客户 + 同一把幂等键，永远只有一个 run。重放直接撞这个索引。
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_runs_idempotency
  ON public.action_runs (client_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_action_runs_queue  ON public.action_runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_action_runs_client ON public.action_runs (client_id, status);
CREATE INDEX IF NOT EXISTS idx_action_runs_goal   ON public.action_runs (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_action_runs_corr   ON public.action_runs (correlation_id);

ALTER TABLE public.action_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.action_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- decision 反向指回 run（建表顺序所致，此处补 FK）
DO $$ BEGIN
  ALTER TABLE public.authorization_decisions
    ADD CONSTRAINT fk_authz_action_run
    FOREIGN KEY (action_run_id) REFERENCES public.action_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. action_run_steps —— 多步 / 断点续跑 / 重试 / 死信 / 验证
--
-- 域阶段住在 step_key（produce / render / publish / verify …），
-- 通用状态住在 status。这样每接一个新域不用往 run 的枚举里加 3-4 个值。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.action_run_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  step_key         text NOT NULL,
  step_index       smallint NOT NULL,

  status           text NOT NULL DEFAULT 'pending' CHECK (status IN
                     ('pending','claimed','running','succeeded','failed','dead_letter','skipped')),

  -- 租约式认领（原样提取自 content_work_orders —— 全仓唯一并发正确的那套）
  claimed_by       text,
  claimed_at       timestamptz,
  heartbeat_at     timestamptz,

  -- 🔴 两个计数必须分开：「重试了 N 次」和「被回收了 N 次」是不同的故障信号
  attempt          smallint NOT NULL DEFAULT 0,
  reclaim_count    smallint NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz,

  output           jsonb NOT NULL DEFAULT '{}',
  -- 验证结果（method / passed / checks / 失败原因）—— 验证是一等公民，不是日志
  verification     jsonb,

  cost_actual_usd  numeric NOT NULL DEFAULT 0,
  last_error       text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,

  -- 一个 run 里同一个步骤只有一行 —— 断点续跑靠它，不靠「找最新那条」
  CONSTRAINT uq_run_step UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_ars_run    ON public.action_run_steps (run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_ars_claim  ON public.action_run_steps (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ars_stale  ON public.action_run_steps (heartbeat_at)
  WHERE status IN ('claimed','running');

ALTER TABLE public.action_run_steps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.action_run_steps
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. kernel_claim_run_step —— 原子认领
--
-- 形状原样提取自 factory_claim_work_order：SECURITY DEFINER + FOR UPDATE SKIP LOCKED，
-- 杜绝「先 SELECT 再 UPDATE」的竞态。p_client_ids 白名单本身就是一个授权维度。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_claim_run_step(
  p_worker_id  text,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ok         boolean,
  step_id    uuid,
  run_id     uuid,
  client_id  uuid,
  step_key   text,
  attempt    smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step RECORD;
BEGIN
  SELECT s.id, s.run_id, s.client_id, s.step_key, s.attempt
    INTO v_step
    FROM public.action_run_steps s
    JOIN public.action_runs r ON r.id = s.run_id
   WHERE s.status = 'pending'
     AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
     -- 🔴 只有已经拿到授权的 run 里的步骤才可被认领。
     --    这是「授权在数据库层也是执行的前置条件」，不只是应用层的一个 if。
     AND r.status IN ('authorized','running')
     AND r.authorization_decision_id IS NOT NULL
     AND (p_client_ids IS NULL OR s.client_id = ANY(p_client_ids))
   ORDER BY s.created_at ASC, s.step_index ASC
   FOR UPDATE OF s SKIP LOCKED
   LIMIT 1;

  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::smallint;
    RETURN;
  END IF;

  UPDATE public.action_run_steps
     SET status       = 'claimed',
         claimed_by   = p_worker_id,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempt      = attempt + 1,
         updated_at   = now()
   WHERE id = v_step.id;

  RETURN QUERY SELECT true, v_step.id, v_step.run_id, v_step.client_id,
                      v_step.step_key, (v_step.attempt + 1)::smallint;
END;
$$;

-- 🔴 SECURITY DEFINER 函数默认把 EXECUTE 授予 anon/authenticated，而 anon key
--    在浏览器 bundle 里 —— 不收口 = 任何人可经 PostgREST 认领执行步骤。
REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. flywheel_actions.action_run_id —— 补上 lineage 的最后一条边
--
-- 可空、无默认值、无触发器：对现有归因作业**零行为变化**。
-- 现有的 flywheel_actions.execution_item_id 保留不动。
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.flywheel_actions
  ADD COLUMN IF NOT EXISTS action_run_id uuid REFERENCES public.action_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flywheel_actions_run
  ON public.flywheel_actions (action_run_id) WHERE action_run_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. kernel_action_lineage —— 一条 SQL 走通
--    goal → action_run → authorization_decision → step → verification → outcome
--
-- 审计里记着：问「上周那篇文章现在到哪一步了」要人手拼 5 张表。这条视图是答案。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.kernel_action_lineage AS
SELECT
  r.id                       AS run_id,
  r.client_id,
  r.correlation_id,
  r.purpose,
  r.goal_id,
  g.title                    AS goal_title,
  r.execution_item_id,
  r.triggered_by,
  r.triggered_by_ref,
  r.action_key,
  r.action_version,
  r.status                   AS run_status,
  r.cost_cap_usd,
  d.id                       AS authorization_decision_id,
  d.verdict                  AS authorization_verdict,
  d.reason                   AS authorization_reason,
  d.decided_by,
  d.decided_by_user,
  d.policy_version,
  d.consumed_at              AS authorization_consumed_at,
  s.id                       AS step_id,
  s.step_key,
  s.step_index,
  s.status                   AS step_status,
  s.attempt                  AS step_attempt,
  s.cost_actual_usd          AS step_cost_actual_usd,
  s.verification             AS step_verification,
  s.output                   AS step_output,
  fa.id                      AS flywheel_action_id,
  fo.id                      AS outcome_id,
  fo.verdict                 AS outcome_verdict
FROM public.action_runs r
LEFT JOIN public.goals                    g  ON g.id  = r.goal_id
LEFT JOIN public.authorization_decisions  d  ON d.id  = r.authorization_decision_id
LEFT JOIN public.action_run_steps         s  ON s.run_id = r.id
LEFT JOIN public.flywheel_actions         fa ON fa.action_run_id = r.id
LEFT JOIN public.flywheel_outcomes        fo ON fo.action_id = fa.id;
