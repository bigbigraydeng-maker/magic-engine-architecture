-- ============================================================================
-- 客户知识库 v1 — 存表层（客户知识库设计 §9.14 E.2）
--
-- 背景：docs/DECISIONS.md 2026-09-13「客户知识库作为 Governed Lead-Reply Agent
-- 的事实层」；设计稿 ~/.claude/plans/client-knowledge-base-capability.md。
--
-- 本迁移只**建表**，不接任何调用方、不产生任何客户外部副作用：
--   1. client_knowledge_facts           — 逐条治理的事实（价格/时效/承诺/政策/一般）
--   2. client_knowledge_rollout_events  — append-only 开关/阶段事件（当前状态=最新一条）
--   3. client_knowledge_confirmers      — 客户侧确认人登记（谁能代表客户点头）
--
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. client_knowledge_facts
--
-- 逐条治理：谁批的、依据什么证据、什么时候过期、是否需要客户本人点头。
-- `sensitivity` 必填无默认值（设计 §9.5）——缺失/未知值由应用层
-- `resolveFactSensitivity()`（src/lib/knowledge/sensitivity.ts）强制归为
-- 'price'，数据库不提供任何默认，防止「忘了标」跟「明确标了 general」在库里
-- 长得一样。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_facts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 稳定标识：同客户 + 同范围唯一，重复萃取走更新不走新增（唯一索引见下）
  fact_key                  text NOT NULL,
  scope                     jsonb NOT NULL DEFAULT '{}',

  statement                 text NOT NULL,
  structured_value          jsonb,

  status                    text NOT NULL CHECK (status IN
                              ('candidate','approved','rejected','retired','superseded')),
  visibility                text NOT NULL CHECK (visibility IN
                              ('customer_ok','internal_only','forbidden')),
  sensitivity               text NOT NULL CHECK (sensitivity IN
                              ('price','timeline','commitment','policy','general')),

  -- price/timeline/commitment/policy 四类必须有 valid_until（设计 §9.6）；
  -- general 允许为空。
  --
  -- 🔴 魏征复审纠偏：这条约束只认 valid_until，不认 last_verified_at 顶替——
  -- 本表目前没有单独的"复核周期"列（比如 review_cycle_days），所以没有第二条
  -- 路可以走。last_verified_at 纯粹是"上次人工复核是什么时候"的审计时间戳，
  -- 从不参与这条 CHECK 的判定；设计 §9.6 提到的"价格默认 90 天复核周期"是写入
  -- 时（萃取/FDE 批准）由应用层据此计算出一个具体 valid_until 再落库，不是数据库
  -- 层面的另一种满足方式。
  valid_from                timestamptz NOT NULL DEFAULT now(),
  valid_until               timestamptz,
  last_verified_at          timestamptz,
  CONSTRAINT sensitive_facts_need_expiry CHECK (
    sensitivity = 'general' OR valid_until IS NOT NULL
  ),
  CONSTRAINT valid_window_sane CHECK (valid_until IS NULL OR valid_until > valid_from),

  source_kind               text NOT NULL CHECK (source_kind IN
                              ('conversation_mining','document','website','manual')),
  -- 只存引用（对话 id / 消息 id / 出现次数 / 最近日期），不复制客户对话原文
  evidence                  jsonb NOT NULL DEFAULT '{}',

  conflict_group_id         uuid,

  approved_by_email         text,
  approved_at               timestamptz,

  -- 客户确认（设计 §7.2/§9.4/§9.14-A）：非 general 事实必须两者都非空才对
  -- customer_reply 生效；确认绑定的是下面的内容指纹，指纹一变自动失效。
  client_confirmed_by_email text,
  client_confirmed_at       timestamptz,
  client_confirmation_fingerprint text,
  client_rejection_note     text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- 批准人和客户确认人不许是同一个人（设计 §9.4「确认人 ≠ 批草稿的人」）。
  -- 只挡"完全同一个邮箱"这个最直接的绕开方式；更完整的身份校验（登记人/
  -- 全局管理员/公司域名排除）在应用层 src/lib/knowledge/identity.ts。
  -- 🔴 魏征复审纠偏：这条约束防的是"绕开应用层直接写 SQL"，不能假设写入者
  -- 会经过 identity.ts 的 normaliseEmail()（它做了 trim）——所以这里的
  -- lower() 也必须配 trim()，否则一个尾随空格就能绕开。
  CONSTRAINT approver_and_confirmer_differ CHECK (
    approved_by_email IS NULL OR client_confirmed_by_email IS NULL
    OR lower(trim(approved_by_email)) <> lower(trim(client_confirmed_by_email))
  )
);

-- 同客户 + 同 fact_key + 同 scope 值唯一：重复萃取走更新不走新增。
-- 用表达式索引而非唯一约束，因为 scope 是 jsonb（无法直接进 UNIQUE 约束）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_facts_identity
  ON public.client_knowledge_facts (client_id, fact_key, (scope::text));

CREATE INDEX IF NOT EXISTS idx_knowledge_facts_client_status
  ON public.client_knowledge_facts (client_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_conflict_group
  ON public.client_knowledge_facts (conflict_group_id) WHERE conflict_group_id IS NOT NULL;

ALTER TABLE public.client_knowledge_facts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.client_knowledge_facts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. client_knowledge_rollout_events —— append-only，当前状态取最新一条
--
-- 开关（on/off）与共测阶段切换共用同一张表（设计 §9.14 B「开关/停止/阶段合一」）。
-- v1 只用得到 enabled/disabled 两种事件；stage_advanced 留给设计 §7.3 的三段
-- 共测上线（后续步骤实现，字段先留好，不需要再来一轮 migration）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_rollout_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  event_type     text NOT NULL CHECK (event_type IN
                   ('enabled','disabled','stage_advanced')),

  -- enabled/disabled 用；stage_advanced 用 from_stage/to_stage
  stage          text CHECK (stage IN ('internal_review','client_cotest','live')),
  from_stage     text CHECK (from_stage IN ('internal_review','client_cotest','live')),
  to_stage       text CHECK (to_stage IN ('internal_review','client_cotest','live')),

  actor_email    text NOT NULL,
  reason         text,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_rollout_events_client
  ON public.client_knowledge_rollout_events (client_id, created_at DESC);

ALTER TABLE public.client_knowledge_rollout_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_rollout_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- append-only：完全不许改、不许删（照抄 authorization_decisions 的形状，
-- 但按设计 §9.14 B 的要求删掉了"允许改一列"的例外——这张表连"消费一次"的
-- 语义都不需要，当前状态永远是"最新一条"，历史行没有任何字段需要事后改动）。
CREATE OR REPLACE FUNCTION public.client_knowledge_rollout_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'client_knowledge_rollout_events is append-only: rows cannot be deleted';
  END IF;
  RAISE EXCEPTION 'client_knowledge_rollout_events is append-only: rows cannot be updated';
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_rollout_events_append_only_trigger
  ON public.client_knowledge_rollout_events;
CREATE TRIGGER client_knowledge_rollout_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.client_knowledge_rollout_events
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_rollout_events_append_only();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. client_knowledge_confirmers —— 客户侧确认人登记
--
-- 只有全局管理员能登记（应用层 src/lib/knowledge/identity.ts 的
-- isGlobalKnowledgeAdmin 判定，DB 不认识 env 配置，不在这里重复实现身份策略）。
-- 登记后可撤销（revoked_at 从 NULL 写一次），不可删除、不可反悔撤销。
-- 一次性签名确认链接、邮箱身份校验等留给设计 §9.14 A「确认链接」步骤实现。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_confirmers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email              text NOT NULL,

  registered_by_email text NOT NULL,
  registered_at        timestamptz NOT NULL DEFAULT now(),

  revoked_by_email   text,
  revoked_at         timestamptz,
  CONSTRAINT revoked_pair CHECK ((revoked_at IS NULL) = (revoked_by_email IS NULL)),

  -- 🔴 魏征复审纠偏：同上，配 trim() 防尾随空格绕过直接 SQL 写入。
  CONSTRAINT registrant_not_confirmer CHECK (lower(trim(email)) <> lower(trim(registered_by_email)))
);

-- 同客户 + 同邮箱，最多一条"仍然有效"（未撤销）的登记
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_confirmers_active
  ON public.client_knowledge_confirmers (client_id, lower(trim(email)))
  WHERE revoked_at IS NULL;

ALTER TABLE public.client_knowledge_confirmers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_confirmers
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 撤销之后不许再改回来、其余列一律不可原地改（换人要新插一行，不是改旧行）。
CREATE OR REPLACE FUNCTION public.client_knowledge_confirmers_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'client_knowledge_confirmers rows cannot be deleted (revoke instead)';
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'client_knowledge_confirmers: registration % already revoked at %', OLD.id, OLD.revoked_at;
  END IF;

  IF NEW.client_id           IS DISTINCT FROM OLD.client_id
     OR NEW.email             IS DISTINCT FROM OLD.email
     OR NEW.registered_by_email IS DISTINCT FROM OLD.registered_by_email
     OR NEW.registered_at     IS DISTINCT FROM OLD.registered_at
  THEN
    RAISE EXCEPTION 'client_knowledge_confirmers: only revoked_at/revoked_by_email may be set';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_confirmers_guard_trigger
  ON public.client_knowledge_confirmers;
CREATE TRIGGER client_knowledge_confirmers_guard_trigger
  BEFORE UPDATE OR DELETE ON public.client_knowledge_confirmers
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_confirmers_guard();
