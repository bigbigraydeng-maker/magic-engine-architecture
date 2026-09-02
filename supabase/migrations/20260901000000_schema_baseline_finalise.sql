-- =============================================================================
-- baseline 收尾：补外键 + 拆掉历史壳表
--
-- 时间戳排在全部现有 migration 之后（最晚的是 20260830090000）。
-- 跟 20260101000000_schema_baseline_pre_migration_era.sql 配对：
-- 那一个先把表建出来让 224 个 migration 能跑完，这一个在跑完之后把
-- 结构补齐到与生产一致。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 一、补 baseline 当时加不了的外键
--     20260426000000 建表时，production_items（20260520000002）和
--     execution_items（20260513000001）还没建出来，所以这三个外键推迟到这里。
--     （visual_assets 指向 clients / content_posts 的两个外键已在 baseline 里
--      内联，不在这里重复。）
--     ON DELETE 行为是推断的，不是从生产读出来的 —— Supabase 管理接口只给列
--     映射不给 ON DELETE。日志/消息挂在 execution_item 上，父记录删掉时应当
--     连带删；production_item_id 是弱引用，不级联。
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.visual_assets
    ADD CONSTRAINT visual_assets_production_item_id_fkey
    FOREIGN KEY (production_item_id) REFERENCES public.production_items(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.execution_logs
    ADD CONSTRAINT execution_logs_execution_item_id_fkey
    FOREIGN KEY (execution_item_id) REFERENCES public.execution_items(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.luban_messages
    ADD CONSTRAINT luban_messages_execution_item_id_fkey
    FOREIGN KEY (execution_item_id) REFERENCES public.execution_items(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 二、拆掉两张历史壳表
--     生产库没有它们；建出来只是为了让引用它们的早期 migration 重放通过。
--     跑到这里那些 migration 都过去了，删掉，终态与生产一致。
--
--     🔴 CASCADE 的实际影响（2026-09-03 A 级复审实测更正，原注释是错的）：
--
--     原注释声称「20260803020000 已经把这些表的策略换成 service-role 版，
--     CASCADE 只删残留」——**不成立**。20260803020000 的 WHERE 要求
--     qual='true'（无条件放行），而这批策略的 qual 是
--     `auth.uid() IN (SELECT user_id FROM client_team ...)`，带真实条件，
--     根本不被它匹配，因此从未被换掉。
--
--     实测：这两行 CASCADE 会删掉 **21 条仍然生效的策略**，
--     加上下面 workspace_id 那行再删 1 条，共 22 条。
--     其中这 5 张表在删完后将**一条策略都不剩**：
--       client_site_pages / content_strategy_items /
--       diagnostic_findings / diagnostic_runs / prescriptions
--
--     这是可接受的终态，但要明白它为什么可接受：
--     这些表 RLS 仍然开着，零策略 = fail-closed（匿名/登录用户一律读不到），
--     而 ME 服务端一律用 service_role，service_role 绕过 RLS，功能不受影响。
--     换句话说删掉的是**本来就该废弃的旧多租户模式**（CLAUDE.md 明令禁止
--     workspace_id / client_team / auth.uid() 用于 RLS），不是在打开什么。
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.client_team      CASCADE;
DROP TABLE IF EXISTS public.site_audit_pages CASCADE;

-- 同一批废弃 RLS 模式留下的壳列。生产 clients 表没有这一列。
ALTER TABLE public.clients DROP COLUMN IF EXISTS workspace_id CASCADE;


-- -----------------------------------------------------------------------------
-- 三、baseline 建表时还指不到的最后一个外键
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.client_decision_history
    ADD CONSTRAINT client_decision_history_zhuge_session_id_fkey
    FOREIGN KEY (zhuge_session_id) REFERENCES public.zhuge_sessions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
