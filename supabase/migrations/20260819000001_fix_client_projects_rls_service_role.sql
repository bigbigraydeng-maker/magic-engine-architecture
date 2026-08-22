-- 修复 client_projects 的 RLS 策略缺 `TO service_role`。
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- 20260803140000_client_projects.sql 建表时用了旧模板：
--
--   create policy "Service role full access" on public.client_projects
--     for all using (true) with check (true);   -- 缺 TO
--
-- Postgres 里 CREATE POLICY 不写 TO 子句 = TO PUBLIC = 对所有角色生效（含 anon）。
-- client_projects 存的是中介名下楼盘/项目的隔离信息（开发商发票联系人、楼盘
-- brief、factory_config），不该被匿名访客读写。
--
-- 这次是由 Codex 在 PR #1087（本仓库记录 client_connectors 那次修复的完成日志）
-- 复审时抓出来的：`client_projects` 的建表时间戳（08-03 14:00）排在
-- 2026-08-03 那次批量收紧扫描 `20260803020000`（08-03 02:00）之后，按文件
-- 时间戳看不会被那次扫描覆盖，仓库里也没有任何后续文件补过这张表的策略。
--
-- ── 现状核实 ─────────────────────────────────────────────────────────────────
-- PM 已用只读查询在 Supabase SQL Editor 核实：
--
--   select tablename, policyname, roles from pg_policies
--    where schemaname='public' and tablename='client_projects';
--
-- 结果为 roles={service_role}——生产现状已经正确，不是活的漏洞。具体怎么
-- 变成正确状态的（人工在 08-03 之后手动改过，还是实际 apply 顺序跟文件时间戳
-- 不一致——账本会在 apply 时重编号，见 docs/STATE.md:86）不确定，但结果已核实。
-- 本迁移是幂等的，跟 client_connectors 那次（20260818000001）同一手法：
-- 让**源码**（未来任何人从零重建这张表时会读到的模板）恢复正确。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 用 ALTER POLICY 只改角色、不动条件 —— 不 DROP 再 CREATE，中间没有「表裸奔」
-- 的时间窗。策略名要跟建表迁移里的原名对上：「Service role full access」。
--
-- 不需要任何 app 代码改动：所有读写 client_projects 的路径都用
-- SUPABASE_SERVICE_ROLE_KEY 初始化 client（该 key 在 PostgREST 里天然映射到
-- service_role 角色），本来就符合收紧后的策略。

DO $$
BEGIN
  ALTER POLICY "Service role full access" ON public.client_projects TO service_role;
END $$;

-- ── 验证（迁移内自检，不通过即整体回滚）──────────────────────────────────
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'client_projects'
     AND roles::text = '{public}';

  IF leftover <> 0 THEN
    RAISE EXCEPTION 'client_projects 仍有 % 条对 public 开放的策略，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ client_projects."Service role full access" 已收紧到 TO service_role';
END $$;
