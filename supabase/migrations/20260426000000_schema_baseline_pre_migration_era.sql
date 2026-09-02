-- =============================================================================
-- 0 号 migration：migration 规范之前就存在的表
--
-- 为什么需要它
-- ------------
-- 生产库的早期 schema 先于 supabase/migrations 目录存在（建表发生在 migration
-- 规范之前）。所以从零重放这 224 个 migration 建不出完整结构 —— 一批基础表
-- 从头到尾没有任何 CREATE，后续所有 ALTER / CREATE INDEX / REFERENCES /
-- CREATE POLICY 全部连锁 `relation ... does not exist`。
-- Jundong 2026-09-02 在 Dev 库实测：224 个里 162 通过、62 失败，全是这个连锁。
--
-- 时间戳为什么是 20260426000000（不是排在最前面）
-- ---------------------------------------------
-- 卡在一个精确的窗口里，两边都是硬约束：
--   下限 —— 必须晚于 20260425000001_magic_engine_foundation.sql。
--     那个文件建 clients / content_posts，本文件的 visual_assets 外键要指向它们。
--     更关键：20260510000001_cascade_delete_semrush_visual_assets.sql 用的是
--     **裸 `DROP CONSTRAINT visual_assets_client_id_fkey`（没写 IF EXISTS）**，
--     跑到那一步时这个外键必须已经存在，否则整条挂掉。所以外键得在本文件里
--     就建出来，而不能推迟到收尾 migration。
--   上限 —— 必须早于 20260428000002_generation_queue_enhancements.sql，
--     那是第一个 ALTER visual_assets 的文件。
-- 其余 5 张表最早的外部引用都在 20260504 之后，这个位置一并覆盖。
--
-- 内容来源
-- --------
-- 生产库 (glbdnayojixmexgofbsd) 的真实结构，经 Supabase 管理接口读取列定义 /
-- 类型 / 可空性 / 默认值 / CHECK / 主键。**没有读取任何数据行**，本文件也不含
-- 任何数据 —— 纯结构。docs/01 的「严禁 dump」条款针对数据，Ray 2026-09-03
-- 确认 schema-only 走这个口径。
--
-- 缺口的准确范围（跟 Jundong 清单的出入）
-- --------------------------------------
-- Jundong 列了 11 个对象。逐个核对生产 migration 后，其中 7 个其实**有**建表
-- 语句，不需要补：
--   client_portal_users        -> 20260527000001_client_portal_users.sql
--   execution_items            -> 20260513000001_diagnostic_engine.sql
--   prescriptions              -> 20260513000001_diagnostic_engine.sql
--   diagnostic_findings        -> 20260513000001_diagnostic_engine.sql
--   reels_drafts               -> 20260502000002_create_reels_studio.sql
--   platform_oauth_connections -> 20260603000001_platform_oauth_connections.sql
--   flywheel_actions           -> 20260517000001_flywheel_data_skeleton.sql
--   函数 update_updated_at_column() -> 20260501000002_blog_posts.sql 等 3 处
-- 它们当时失败，是被更早的缺失表连锁带倒的，不是自己缺。
--
-- 另外 conversations 也是误判：它由 20260726000001 建成 messenger_conversations，
-- 再由 20260726000004_unified_contacts.sql `RENAME TO conversations`。
--
-- 真正缺的是下面 4 个（生产里存在、migration 里从没建过），加 2 个历史残留引用。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 一、生产在用、但 migration 里没有建表语句的 4 张表
--     （4 张在生产里当前都是 0 行；应用代码仍在读写：
--      visual_assets 23 个源文件 / execution_logs 12 / industry_benchmarks 4 /
--      luban_messages 2）
--
--     这里建的是**当前**列集（生产实况）。已核对：所有后续 migration 对这 4 张
--     表的 ADD COLUMN 都带 IF NOT EXISTS，对 CONSTRAINT 都是 DROP ... IF EXISTS
--     再 ADD，所以先建全列不会跟后面撞车。
--     CHECK 一律内联不具名 —— Postgres 会按 <表>_<列>_check 自动命名，跟生产
--     一致，后续 `DROP CONSTRAINT IF EXISTS visual_assets_provider_check` 找得到。
--
--     外键分两处：clients / content_posts 在本文件时已存在（20260425000001
--     建的），直接内联 —— 而且必须内联，见上面时间戳那段说的裸 DROP CONSTRAINT。
--     production_items（20260520000002）和 execution_items（20260513000001）
--     还没建，那两个外键推迟到 20260901000000_schema_baseline_finalise.sql。
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visual_assets (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id              uuid,
  client_id            uuid NOT NULL,
  asset_type           text NOT NULL
                         CHECK (asset_type = ANY (ARRAY['image'::text, 'video'::text, 'avatar_video'::text])),
  provider             text NOT NULL
                         CHECK (provider = ANY (ARRAY['wavespeed'::text, 'seedance'::text, 'heygen'::text, 'upload'::text, 'openai'::text, 'client_library'::text])),
  prompt_used          text,
  variant              smallint DEFAULT 1
                         CHECK (variant = ANY (ARRAY[1, 2])),
  generation_status    text NOT NULL DEFAULT 'pending'::text
                         CHECK (generation_status = ANY (ARRAY['pending'::text, 'generating'::text, 'ready'::text, 'failed'::text])),
  provider_job_id      text,
  error_message        text,
  retry_count          smallint DEFAULT 0,
  storage_url          text,
  provider_url         text,
  file_size_kb         integer,
  duration_seconds     numeric,
  resolution           text,
  is_selected          boolean DEFAULT false,
  cost_usd             numeric,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  next_retry_at        timestamptz,
  queued_at            timestamptz,
  last_error_code      varchar,
  reels_draft_id       uuid,
  current_version_num  integer NOT NULL DEFAULT 1,
  is_final             boolean NOT NULL DEFAULT false,
  external_edit_status text
                         CHECK (external_edit_status = ANY (ARRAY['needs_external_edit'::text, 'in_external_edit'::text, 'final'::text])),
  production_item_id   uuid,
  PRIMARY KEY (id),

  -- 不带 ON DELETE：忠实还原「当时就是漏了 CASCADE」的状态。
  -- 20260510000001_cascade_delete_semrush_visual_assets.sql 正是来修这一条的
  -- （它 DROP 掉这个约束再带 CASCADE 重建）。这里要是先写成 CASCADE，
  -- 那个 migration 虽然还能跑过，但等于把它要修的问题提前抹掉了，
  -- 重放出来的历史就不是真实历史。
  CONSTRAINT visual_assets_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id),

  -- ⚠️ ON DELETE 行为是**推断**的，不是从生产读出来的：Supabase 管理接口
  -- 只给外键的列映射，不给 ON DELETE。这里按本 schema 里 content_posts 子表
  -- 的通行做法取 CASCADE（删帖子连带删它的图/视频）。若 Jundong 重放后发现
  -- 与生产行为不符，改这一行即可。
  CONSTRAINT visual_assets_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.content_posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.industry_benchmarks (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  industry_category          text NOT NULL,
  business_size              text NOT NULL
                               CHECK (business_size = ANY (ARRAY['small'::text, 'medium'::text, 'large'::text])),
  market                     text NOT NULL
                               CHECK (market = ANY (ARRAY['AU'::text, 'NZ'::text, 'AU_NZ'::text])),
  dimension                  text NOT NULL
                               CHECK (dimension = ANY (ARRAY['seo'::text, 'social'::text, 'reputation'::text, 'ai_visibility'::text])),
  score_p50                  integer CHECK (score_p50 >= 0 AND score_p50 <= 100),
  score_p75                  integer CHECK (score_p75 >= 0 AND score_p75 <= 100),
  score_p90                  integer CHECK (score_p90 >= 0 AND score_p90 <= 100),
  realistic_3mo_growth_pct   integer,
  realistic_6mo_growth_pct   integer,
  typical_monthly_budget_aud integer,
  source                     text,
  source_url                 text,
  confidence                 numeric DEFAULT 0.5
                               CHECK (confidence >= 0::numeric AND confidence <= 1::numeric),
  sample_size                integer,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMENT ON TABLE  public.industry_benchmarks             IS '华佗 Agent 行业基准库（P8.10.S3 护城河）';
COMMENT ON COLUMN public.industry_benchmarks.confidence  IS '数据置信度 0–1，公开权威报告 0.8+，估算 0.4-';
COMMENT ON COLUMN public.industry_benchmarks.sample_size IS '聚合样本量（来自实际客户数据时填）';

CREATE TABLE IF NOT EXISTS public.execution_logs (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_item_id uuid NOT NULL,
  client_id         uuid NOT NULL,
  author            text NOT NULL DEFAULT 'fde'::text
                      CHECK (author = ANY (ARRAY['fde'::text, 'luban'::text, 'system'::text])),
  kind              text NOT NULL
                      CHECK (kind = ANY (ARRAY['note'::text, 'status_change'::text, 'ai_assist'::text, 'blocker'::text, 'adjustment'::text])),
  content           text NOT NULL,
  meta              jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMENT ON TABLE public.execution_logs IS '鲁班执行代理 — FDE 工作日志 + AI 协助记录（P8.10.S4）';

CREATE TABLE IF NOT EXISTS public.luban_messages (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_item_id uuid NOT NULL,
  client_id         uuid NOT NULL,
  role              text NOT NULL
                      CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  content           text NOT NULL,
  meta              jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMENT ON TABLE public.luban_messages IS '鲁班对话代理 — FDE 与鲁班的自然语言对话线程（P8.10.S4.2）';


-- -----------------------------------------------------------------------------
-- 一之二、"建了，但建得太晚"的三个对象
--
--   这三个在 224 个 migration 里确实有 CREATE，但 CREATE 的位置**晚于第一次被
--   引用的位置**，所以从零重放照样挂。本机重放实测（2026-09-03，PostgreSQL
--   17.11 沙盘）确认：
--
--   update_updated_at_column()
--     建于 20260501000002_blog_posts.sql，但 20260501000001_geo_directives.sql
--     的触发器先用了它 —— 差一个文件。
--   client_portal_users
--     建于 20260527000001，但 20260522000001_client_portal_users_multi_client.sql
--     和 20260522000002_client_users_access_type.sql 先 ALTER 它 —— 差 5 天。
--     后面还连锁挂掉 20260602000001 / 20260616000001 / 20260626000002
--     （都报 access_type 列不存在）。
--   platform_oauth_connections
--     建于 20260603000001，但 20260530000004_rls_security_hardening.sql 先给它
--     开 RLS —— 差 4 天。
--
--   注：20260603000001 原本写的是裸 CREATE TABLE（没有 IF NOT EXISTS），
--   本文件先建出来会让它撞车，所以同一次提交里给那一行补了 IF NOT EXISTS。
--   这是让文件幂等，不改变它在空库上的行为 —— 仓库里其余 migration 本来就
--   全是 IF NOT EXISTS 写法。
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.client_portal_users (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  client_id        uuid NOT NULL,
  display_name     text NOT NULL DEFAULT ''::text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  access_type      text NOT NULL DEFAULT 'portal'::text
                     CHECK (access_type = ANY (ARRAY['portal'::text, 'dashboard'::text, 'fde'::text, 'both'::text, 'self_serve'::text, 'client'::text])),
  created_by_email text,
  scoped_admin     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT client_portal_users_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 同上，20260527000001 的真实定义里有 UNIQUE(email)，同样会被 no-op 吞掉。
  CONSTRAINT client_portal_users_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.platform_oauth_connections (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL,
  provider          text NOT NULL
                      CHECK (provider = ANY (ARRAY['google_gbp'::text, 'google_gsc'::text, 'meta'::text, 'tiktok'::text, 'google_ads'::text, 'microsoft_mail'::text, 'google_ga4'::text, 'google_gtm'::text])),
  access_token_enc  text NOT NULL,
  refresh_token_enc text NOT NULL,
  token_expiry      timestamptz NOT NULL,
  account_id        text NOT NULL,
  location_name     text,
  display_name      text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}'::text[],
  status            text NOT NULL DEFAULT 'active'::text
                      CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text, 'expired'::text, 'error'::text])),
  last_synced_at    timestamptz,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT platform_oauth_connections_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 🔴 这一条是复审（2026-09-03 三方 A 级复审）抓出来的 blocker，别删。
  -- 20260603000001 的真实定义里有它。本文件预建了同名表 + 那个文件改成
  -- IF NOT EXISTS 之后，那条 CREATE TABLE 变成 no-op，唯一约束就被静默吞掉。
  -- 后果不是重放报错（重放照样全绿），而是重建后的库上每一次 OAuth 授权
  -- upsert 都直接抛 42P10（ON CONFLICT 找不到匹配的唯一约束）——
  -- GBP / GSC / Meta / TikTok / Google Ads 全部连不上。
  -- 典型的「改了让重放变绿，不是改了让系统变对」。
  CONSTRAINT platform_oauth_connections_client_id_provider_account_id_key
    UNIQUE (client_id, provider, account_id)
);

COMMENT ON TABLE public.platform_oauth_connections IS
  'OAuth 2.0 platform connections (GBP / GSC / Meta / TikTok / Google Ads). Tokens are AES-256-GCM encrypted. Phase 24.';

-- client_decision_history 建于 20260610000001_phase23_memory_tables.sql，
-- 但 20260530000004_rls_security_hardening.sql 先给它开 RLS —— 差 11 天。
-- zhuge_sessions 外键要等 20260528000002 才建得出来，放到收尾 migration。
CREATE TABLE IF NOT EXISTS public.client_decision_history (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL,
  zhuge_session_id      uuid,
  decision_context      text NOT NULL,
  chosen_action         text NOT NULL,
  alternatives_rejected jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning             text NOT NULL,
  outcome_verdict       text
                          CHECK (outcome_verdict = ANY (ARRAY['success'::text, 'failure'::text, 'inconclusive'::text])),
  outcome_notes         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT client_decision_history_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE
);

-- memory 系统另外三张客户级表，同样建于 20260610000001_phase23_memory_tables.sql，
-- 同样被 20260530000004_rls_security_hardening.sql 提前 11 天引用。
CREATE TABLE IF NOT EXISTS public.client_learned_preferences (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  preference_type      text NOT NULL
                         CHECK (preference_type = ANY (ARRAY['style'::text, 'topic'::text, 'format'::text, 'tone'::text, 'audience'::text, 'other'::text])),
  content              text NOT NULL,
  source               text NOT NULL DEFAULT 'fde_annotation'::text
                         CHECK (source = ANY (ARRAY['fde_annotation'::text, 'client_feedback'::text, 'auto_extracted'::text])),
  extracted_from_table text,
  extracted_from_id    uuid,
  -- numeric(3,2) 不是裸 numeric —— 20260610000001 的真实定义带精度，
  -- 抄漏精度同样是静默漂移（复审 2026-09-03 抓出）。
  confidence_score     numeric(3,2) NOT NULL DEFAULT 1.0
                         CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  flywheel             text
                         CHECK (flywheel = ANY (ARRAY['seo'::text, 'geo'::text, 'ads'::text, 'social'::text])),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_proven_patterns (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pattern_type             text NOT NULL
                             CHECK (pattern_type = ANY (ARRAY['hook'::text, 'cta'::text, 'angle'::text, 'format'::text, 'headline'::text, 'structure'::text])),
  pattern_content          text NOT NULL,
  performance_metric       text,
  measurement_period_start date,
  measurement_period_end   date,
  flywheel                 text
                             CHECK (flywheel = ANY (ARRAY['seo'::text, 'geo'::text, 'ads'::text, 'social'::text])),
  source_table             text,
  source_id                uuid,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  source_action_id         uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_failed_experiments (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  experiment_description text NOT NULL,
  failure_reason         text NOT NULL,
  dimension              text
                           CHECK (dimension = ANY (ARRAY['seo'::text, 'ai_visibility'::text, 'ads'::text, 'social'::text, 'reputation'::text, 'competitor'::text])),
  tried_at               timestamptz,
  source_table           text,
  source_id              uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  is_active              boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  source_action_id       uuid,
  PRIMARY KEY (id)
);

-- 两张归档快照表：生产里确实存在（0 行，注释写着 2026-08-30 后可删），
-- 但它们是当时手工建的，migration 目录里没有 CREATE。
-- 20260530000004_rls_security_hardening.sql 会给它们开 RLS，所以要先在。
CREATE TABLE IF NOT EXISTS public."_archived_keywords_2026_05_30" (
  id                    uuid,
  client_id             uuid,
  keyword               text,
  volume                integer,
  kd                    smallint,
  cpc                   numeric,
  intent                text,
  trend                 jsonb,
  source                text,
  competitor_source     text,
  semrush_db            text,
  opportunity_score     numeric,
  recommended_page_type text,
  status                text,
  status_updated_at     timestamptz,
  status_updated_by     text,
  created_at            timestamptz,
  updated_at            timestamptz,
  campaign_id           uuid
);

CREATE TABLE IF NOT EXISTS public."_archived_semrush_usage_logs_2026_05_30" (
  id             uuid,
  client_id      uuid,
  endpoint       text,
  units_consumed integer,
  keywords_count integer,
  called_at      timestamptz
);


-- -----------------------------------------------------------------------------
-- 二、RLS —— 按 CLAUDE.md 铁律的 service-role 模板
--     必须写 TO service_role；漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露过
--     118 条策略）。禁止 workspace_id / client_team / auth.uid()。
-- -----------------------------------------------------------------------------

-- 全部开 RLS。开了但暂时没策略 = fail-closed（匿名/登录用户一律读不到；
-- service_role 本来就绕过 RLS，服务端不受影响），这是安全的中间态。
ALTER TABLE public.visual_assets                              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_benchmarks                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs                             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.luban_messages                             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_users                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_oauth_connections                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_decision_history                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_learned_preferences                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_proven_patterns                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_failed_experiments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_archived_keywords_2026_05_30"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_archived_semrush_usage_logs_2026_05_30"  ENABLE ROW LEVEL SECURITY;

-- ⚠️ 这里**只给 visual_assets 和 client_portal_users 建策略**，其余一概不建。
-- 原因：20260530000004_rls_security_hardening.sql 会给
--   industry_benchmarks / execution_logs / luban_messages /
--   client_decision_history / client_learned_preferences /
--   client_proven_patterns / client_failed_experiments /
--   platform_oauth_connections / 两张 _archived_*
-- 建同名的 service_role_full 策略，而且**它没有 duplicate_object 保护**
-- （本机重放实测：这里先建就会让那个文件报 policy already exists）。
-- 上面这批的策略交给它建；本文件只补它管不到的两张。
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.visual_assets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_portal_users
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 三、历史残留引用的两张壳表
--
--     这两张表**生产库里现在不存在**，但早期 migration 引用了它们。不建的话
--     那些 migration 重放必挂。建成空壳让它们跑过去，最后由
--     20260901000000_schema_baseline_finalise.sql 删掉 —— 终态与生产一致。
--
--     client_team —— 被 10 个早期 migration 的 RLS 策略引用
--       (`auth.uid() in (select user_id from client_team where ...)`)。
--       这正是 CLAUDE.md 明令废弃的旧 RLS 模式。20260803020000_rls_lock_
--       policies_to_service_role.sql 已把这些策略全部换成 service-role 版。
--
--     site_audit_pages —— 只被 20260505000002_gin_index_site_audit_pages.sql
--       引用，那个 migration 写错了表名，两天后由 20260507000002_fix_gin_index_
--       client_site_pages.sql 修正到真实表 client_site_pages。
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_team (
  user_id   uuid NOT NULL,
  client_id uuid NOT NULL,
  PRIMARY KEY (user_id, client_id)
);

COMMENT ON TABLE public.client_team IS
  '历史壳表：仅为让早期 RLS 策略重放通过而存在，生产库已无此表。由 20260901000000 删除。';

-- clients.workspace_id —— 同一批废弃 RLS 模式的另一半。
-- 20260501000008_monthly_report_aggregation.sql 的策略里写了
-- `SELECT id FROM clients WHERE workspace_id = auth.jwt() ->> 'workspace_id'`，
-- 但生产 clients 表根本没有这一列（已确认）。同样建成壳列让它跑过去，
-- 由 20260901000000 删掉。CLAUDE.md 明令禁止 workspace_id 用于 RLS。
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS workspace_id text;

COMMENT ON COLUMN public.clients.workspace_id IS
  '历史壳列：仅为让 20260501000008 的废弃 RLS 策略重放通过，生产库无此列。由 20260901000000 删除。';

-- 列照 20260505000002 实际会用到的来：它建 5 个索引、一个 tsvector 触发器，
-- 还 UPDATE 一遍。壳表少一列就挂在那一行，所以按它引用的字段建全。
CREATE TABLE IF NOT EXISTS public.site_audit_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid,
  url              text,
  title            text,
  primary_keyword  text,
  markdown_content text,
  page_type        text,
  has_geo_block    boolean,
  topics           text[],
  search_vector    tsvector,
  updated_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE public.site_audit_pages IS
  '历史壳表：20260505000002 写错的表名（真实表是 client_site_pages），两天后由 20260507000002 修正。由 20260901000000 删除。';
