-- 把 118 条「名字叫 service_role、实际授权给所有人」的 RLS 策略收回给 service_role。
--
-- ── 事故 ────────────────────────────────────────────────────────────────────
-- CLAUDE.md 长期强制的建表模板漏了 `TO service_role`：
--
--   CREATE POLICY "service_role_full" ON <t> FOR ALL USING (true);   -- ← 缺 TO
--
-- Postgres 里 CREATE POLICY 不写 TO 子句 = `TO PUBLIC` = 对**所有角色**生效，
-- 包含 anon。而 Supabase 默认给 anon/authenticated GRANT 了 public schema 下
-- 所有表的增删改查，平时全靠 RLS 兜着 —— 这个模板等于把兜底拆了。
--
-- 2026-08-03 用生产环境的公开 anon key 实测确认（anon key 随浏览器 bundle
-- 公开分发，任何访问过站点的人都能拿到）：
--
--   outbound_prospects       2,678 行  可读
--   conversation_messages    2,135 行  可读
--   contact_identities       1,260 行  可读
--   PATCH outbound_prospects  HTTP 204  可写（探针 WHERE 匹配 0 行，未改动数据）
--
-- 本迁移不匹配、因而不受影响的表分两类 —— **这两类的安全性完全不同，别混为一谈**：
--
--   (a) 策略写法本来就正确（有 TO 子句或有真实条件）：
--       platform_oauth_connections（第三方令牌）、client_portal_users、clients、
--       master_briefs、client_assets。这一类是安全的。
--
--   (b) 🔴 **根本没开 RLS、也没有任何策略** —— 这一类是**完全敞开**，不是安全：
--       mtc_purchases / mtc_ledger（充值与消费）、stripe_events_log、
--       discovery_leads、public_scan_jobs、industry_brand_canonical、
--       industry_ai_visibility_questions / _runs / _snapshots，共 9 张。
--       RLS 关闭 + 无策略 + Supabase 默认给 anon GRANT = anon 可读可改可删。
--       本迁移只 ALTER 已存在的策略，结构上碰不到这 9 张表，
--       所以它们在跑之前跑之后一样敞着 —— 是本迁移**跑完后唯一还全裸**的表。
--
--   2026-09-03 A 级复审更正：本行原文把 (b) 写成「未受影响（…或无策略）」，
--   等于把「无策略」当成安全，方向是反的。一个专门教「正确 RLS 模板」的文件
--   不能同时教错这一点 —— 下一个人照抄就会再造一次 2026-08-03。
--   (b) 那 9 张表另有独立 A 级 ticket 处理，不在本文件范围内。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 用 ALTER POLICY 只改角色，不动条件：
--   * 不 DROP 再 CREATE —— 中间没有「表裸奔」的时间窗
--   * 条件原样保留，行为除角色外零变化
--   * 回退就是把 service_role 换回 public（见文件末尾）
--
-- ── 为什么安全（改前已逐条核实）────────────────────────────────────────────
-- 1. 全仓只有 2 个文件用匿名客户端碰业务表（facebook-publisher.ts /
--    xiaohongshu-publisher.ts），二者**无任何调用方**，只有自己的测试文件引用，
--    是死代码。
-- 2. 所有对外路径（/api/discover/register、/api/public-scan/status/[jobId]、
--    /auth/callback）读写这些表用的都是 supabaseAdmin(service_role)。
-- 3. 遗留多租户表簇（projects / social_sources / content_topics / collected_posts
--    / feedback_data / generation_logs / generation_params / trending_reports）
--    另有 owner 维度的 {authenticated} 策略，本迁移不匹配、不触碰。
-- 4. local_cities_read_all 刻意保留公开只读 —— 城市名参考数据，非客户信息。
--
-- 2026-08-03 生产快照：118 条（105 ALL + 10 INSERT + 2 UPDATE + 1 SELECT）。
-- ⚠️ 这个数字只作对账参考，**不是断言**。它描述的是那一刻那一个库的状态，
--    对任何其他库（全新建的 Dev / CI）都没有意义 —— 空库上是 102 条。
--    2026-09-03 前它曾是硬闸门，见下方块 1 末尾的说明。

DO $$
DECLARE
  r         RECORD;
  n_changed INT := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND roles::text = '{public}'
       -- 只收「无条件放行」的策略。带真实条件的（owner 维度、
       -- auth.role()='service_role' 之类）不在此列，保持原样。
       AND COALESCE(qual, 'true')       = 'true'
       AND COALESCE(with_check, 'true') = 'true'
       -- 刻意公开的参考数据（城市名），保留。
       -- 2026-09-03 复审：按 (表名, 策略名) 匹配，不按策略名全局豁免 ——
       -- 原写法下任何别的表上出现同名策略都会被静默放过。
       AND NOT (tablename = 'local_cities' AND policyname = 'local_cities_read_all')
     ORDER BY tablename, policyname
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I TO service_role',
      r.policyname, r.tablename
    );
    n_changed := n_changed + 1;
    RAISE NOTICE '收紧 %.% (%)', r.tablename, r.policyname, r.cmd;
  END LOOP;

  RAISE NOTICE '共收紧 % 条策略', n_changed;

  -- ── 2026-09-03 A 级复审后改动：这里原本是 RAISE EXCEPTION（数量对不上就整体回滚）──
  --
  -- 为什么改：这个闸门的**方向是反的**。它一失败就回滚，而回滚的方向永远是
  -- 「把已经收紧的策略重新放开」。实测：全新建库上只匹配到 102 条（≠118）→
  -- 抛异常 → 整体回滚 → 101 条对匿名访客无条件放行的策略一条都没收紧。
  -- 攻击验证组用真实 GRANT 复现确认：那个状态下，任何拿到 anon key 的人
  -- （key 随浏览器 bundle 公开分发）可读客户线索/对话原文、可改可删线索，
  -- 甚至能给自己签发一把 scopes={*} 的跨客户管理员钥匙。
  -- 一个安全补救动作，不该因为「记账数字对不上」而被自己否决掉。
  --
  -- 118 断的是「这一次改了多少条」（增量），而本文件要保的不变量是
  -- 「末态不存在无条件公开策略」（末态）。增量断言放在闸门位置属职责错配。
  --
  -- ⚠️ 诚实说明：改完之后本文件里**没有任何真实闸门**。
  -- 下面那个 leftover 检查与本循环的 WHERE 谓词逐字相同，块 1 跑完它必然为 0，
  -- 是恒真重读，只在本循环自身报错时才会触发 —— 它不是「更强的等价保证」，
  -- 主 agent 最初的这个论断已被三方独立取证否定。真正的持续护栏必须放在
  -- 事务之外（CI 探针），已另开 A 级 ticket，不在本文件范围内。
  IF n_changed <> 118 THEN
    RAISE NOTICE
      '⚠️ 本次收紧 % 条，与 2026-08-03 生产快照的 118 条不符。全新建库属正常现象；'
      '若这是生产库，请人工核对是否有人手工改动过策略。',
      n_changed;
  END IF;
END $$;

-- ── 收尾自检 ────────────────────────────────────────────────────────────────
-- ⚠️ 诚实标注（2026-09-03 复审）：这一段**不是独立的闸门**。
-- 它的 WHERE 与上面循环的 WHERE 逐字相同，所以上面跑完这里必然为 0 —— 是恒真重读。
-- 它唯一还有用的场景：上面的循环自身中途报错（例如某条 ALTER 失败），
-- 此时在 autocommit 模式下它能兜住并报警。
-- 它**不覆盖** roles={anon} / {authenticated} 的无条件放行策略（那些另有 ticket），
-- 所以下面的成功提示措辞已按实际判据收窄，不再号称「对所有角色」。
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles::text = '{public}'
     AND COALESCE(qual, 'true')       = 'true'
     AND COALESCE(with_check, 'true') = 'true'
     AND NOT (tablename = 'local_cities' AND policyname = 'local_cities_read_all');

  IF leftover <> 0 THEN
    RAISE EXCEPTION '仍有 % 条 roles={public} 的无条件放行策略未收紧，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ 已无 roles={public} 的无条件放行策略（local_cities_read_all 除外）。'
               '注意：本检查不覆盖 {anon} / {authenticated} 上的无条件策略。';
END $$;

-- ── 回退 ────────────────────────────────────────────────────────────────────
-- 如需恢复原状（不建议，会重新打开对外读写）：
--
--   DO $$
--   DECLARE r RECORD;
--   BEGIN
--     FOR r IN
--       SELECT tablename, policyname FROM pg_policies
--        WHERE schemaname='public' AND roles::text='{service_role}'
--          AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
--     LOOP
--       EXECUTE format('ALTER POLICY %I ON public.%I TO public', r.policyname, r.tablename);
--     END LOOP;
--   END $$;
--
-- 注意：回退脚本会把本来就正确的那批 service_role 策略一并放开
--（2026-08-03 生产快照当时是 41 条；这个数字同样只是快照，别当判据）。
-- 真要回退请先用 pg_policies 快照精确指定策略名。
