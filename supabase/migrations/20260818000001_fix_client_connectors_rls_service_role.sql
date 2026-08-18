-- 修复 client_connectors 的 RLS 策略缺 `TO service_role`。
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- 20260519000001_client_connectors.sql 建表时用了旧模板：
--
--   CREATE POLICY "service_role_full" ON client_connectors FOR ALL USING (true);   -- 缺 TO
--
-- Postgres 里 CREATE POLICY 不写 TO 子句 = TO PUBLIC = 对所有角色生效（含 anon）。
-- client_connectors 存的是每客户的连接器授权状态（property ID / GBP location ID /
-- 连接状态 / 错误详情），这张表不该被匿名访客读写。
--
-- ── 现状核实 ─────────────────────────────────────────────────────────────────
-- 2026-08-03 的 20260803020000_rls_lock_policies_to_service_role.sql 已经用
-- 动态查询把 public schema 下**所有**匹配「roles={public} 且条件恒真」的策略
-- 收紧到 service_role（118 条，含建表早于 08-03 的表）。client_connectors 建于
-- 05-19，早于那次扫描，理论上已被一并收紧。
--
-- 本次改动的会话里没有可用的 Supabase 读权限验证这一点 —— 没有 Supabase MCP、
-- .env.local 里只有 service role key（无数据库连接串 / 无 PAT），Chrome 里的
-- Supabase 登录已过期，且遵守「禁止代用户输入密码 / 登录」不去重新登录。
-- 合并前请用下面这条只读查询在 Supabase SQL Editor 核实一次：
--
--   select tablename, policyname from pg_policies
--    where schemaname='public' and tablename='client_connectors';
--
-- 同一根因、同样「源码是旧模板但生产已被 08-03 扫过」的先例见
-- docs/specs/2026-08-16-commerce-candidate-storage-v1.md:52-54（flywheel_data_skeleton.sql）。
-- 无论现状如何，本迁移都是幂等的（ALTER POLICY 改到目标状态即为 no-op），
-- 且这是让**源码**（未来任何人从零重建这张表时会读到的模板）恢复正确的唯一办法。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 跟 20260803020000 一样用 ALTER POLICY 只改角色、不动条件 —— 不 DROP 再
-- CREATE，中间没有「表裸奔」的时间窗。
--
-- 不需要任何 app 代码改动：所有读写 client_connectors 的路径都用
-- SUPABASE_SERVICE_ROLE_KEY 初始化 client（该 key 在 PostgREST 里天然映射到
-- service_role 角色），本来就符合收紧后的策略。

DO $$
BEGIN
  ALTER POLICY "service_role_full" ON public.client_connectors TO service_role;
END $$;

-- ── 验证（迁移内自检，不通过即整体回滚）──────────────────────────────────
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'client_connectors'
     AND roles::text = '{public}';

  IF leftover <> 0 THEN
    RAISE EXCEPTION 'client_connectors 仍有 % 条对 public 开放的策略，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ client_connectors.service_role_full 已收紧到 TO service_role';
END $$;
