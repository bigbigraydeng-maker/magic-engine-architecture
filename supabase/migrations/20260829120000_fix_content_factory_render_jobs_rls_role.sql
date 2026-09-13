-- 修复 content_factory_render_jobs 的 RLS 策略缺 `TO service_role`。
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- 20260731081328_content_factory_render_jobs.sql 建表时用了旧模板：
--
--   CREATE POLICY "service_role_full" ON content_factory_render_jobs FOR ALL USING (true);   -- 缺 TO
--
-- Postgres 里 CREATE POLICY 不写 TO 子句 = TO PUBLIC = 对所有角色生效（含 anon）。
--
-- ── 现状核实 ─────────────────────────────────────────────────────────────────
-- 已直接查生产 Supabase（project glbdnayojixmexgofbsd / CrazyContent / main）的
-- pg_policies 核实：
--
--   select tablename, policyname, roles from pg_policies
--    where schemaname='public' and tablename='content_factory_render_jobs';
--
-- 结果为 roles={service_role}——生产现状已经正确，不是活的漏洞。建表时间
-- （07-31）早于 20260803020000_rls_lock_policies_to_service_role.sql 那次批量
-- 收紧扫描（08-03 02:00），已被那次扫描顺带收紧。
--
-- 建表到批量扫描之间（2026-07-31 08:45 ~ 2026-08-03 02:00）曾有 25 行数据写入，
-- 全部属于同一个 client_id（Magic Lab Class，内部自有 IP 品牌，非付费客户），
-- output_url / clip_urls 抽查未见签名 URL；无法倒查历史访问日志确认是否真被
-- 匿名读取过。
--
-- 本迁移是幂等的（ALTER POLICY 改到目标状态即为 no-op），跟 client_connectors
-- （20260818000001）、client_projects（20260819000001）同一手法：让**源码**
-- （未来任何人从零重建这张表时会读到的模板）恢复正确，不依赖 20260803020000
-- 里按精确数量做整体回滚校验的扫描去兜底。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 用 ALTER POLICY 只改角色、不动条件 —— 不 DROP 再 CREATE，中间没有「表裸奔」
-- 的时间窗。
--
-- 不需要任何 app 代码改动：所有读写 content_factory_render_jobs 的路径都用
-- SUPABASE_SERVICE_ROLE_KEY 初始化 client（该 key 在 PostgREST 里天然映射到
-- service_role 角色），本来就符合收紧后的策略。

DO $$
BEGIN
  ALTER POLICY "service_role_full" ON public.content_factory_render_jobs TO service_role;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'content_factory_render_jobs."service_role_full" 策略不存在，跳过（可能已被改名或表结构已变）';
END $$;

-- ── 验证（迁移内自检，不通过即整体回滚）──────────────────────────────────
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'content_factory_render_jobs'
     AND roles::text = '{public}';

  IF leftover <> 0 THEN
    RAISE EXCEPTION 'content_factory_render_jobs 仍有 % 条对 public 开放的策略，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ content_factory_render_jobs."service_role_full" 已收紧到 TO service_role';
END $$;
