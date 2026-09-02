-- =============================================================================
-- baseline 第二段：顺序修正
--
-- 20260426000000_schema_baseline_pre_migration_era.sql 只能补它那个时间点之前
-- 就该存在的东西。这一个补的是**表建出来之后、但列加得比第一次引用晚**的情况 ——
-- 那种情况 baseline 提前不了，只能夹在中间。
--
-- 本机重放实测发现（2026-09-03，PostgreSQL 17.11 沙盘）：
--
--   client_site_pages.status_code
--     建于 20260507000001_client_site_pages_extended_columns.sql，
--     但 20260506000002_get_page_stats_rpc.sql 的 get_page_stats() 函数体里
--     先用了它 —— 差一天。Postgres 默认 check_function_bodies=on，创建函数
--     时就会校验列引用，所以那个 migration 直接挂。
--     （该列在生产 client_site_pages 上确实存在，这里只是把它提前一格。）
--
-- 时间戳窗口：必须晚于 20260504000001_client_site_pages.sql（表在那里建），
-- 早于 20260506000002_get_page_stats_rpc.sql（第一次引用）。
--
-- 用 ADD COLUMN IF NOT EXISTS，所以 20260507000001 跑到时是无操作，
-- 两个文件都能正常跑完。
-- =============================================================================

ALTER TABLE public.client_site_pages
  ADD COLUMN IF NOT EXISTS status_code integer;
