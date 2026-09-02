-- =============================================================================
-- #1327 · seo_analyses 收回跨客户全量读写
--
-- 来源：2026-09-03 对 20260803020000 的 A 级复审，攻击验证环节实测发现。
--
-- ── 问题 ────────────────────────────────────────────────────────────────────
-- 策略 seo_analyses_admin_all：
--     roles      = {authenticated}
--     cmd        = ALL
--     USING      = true
--     WITH CHECK = true
--
-- 20260803020000 的判据只匹配 roles = {public}，所以这条策略在它跑之前跑之后
-- **完全一样**，那个补丁结构上碰不到。
--
-- ── 关键问题：authenticated 身份到底能不能被外人拿到？──────────────────────
-- 这决定这条是「真能打穿」还是「理论上的」。已实测核实，答案是：**真能拿到**。
--
-- ME 用的是 Supabase Auth，不是纯自建身份：
--   src/app/api/auth/self-register/route.ts:40  走 signInWithOtp 自助注册
--   src/app/api/auth/magic-link/route.ts:54     magic link
--   src/app/api/discover/register/route.ts:349  discover 注册同样发 OTP
-- 也就是说：**任何人用自己的邮箱走一遍自助注册，就拿到 authenticated 身份**。
-- 再配上随浏览器 bundle 公开分发的 anon key，即可直连 PostgREST
-- **跨所有客户**读写 seo_analyses（关键词缺口分析、竞品数据、报告链接）。
--
-- ── 为什么收紧是安全的 ──────────────────────────────────────────────────────
-- seo_analyses 的调用点全部走 supabaseAdmin(service_role)，例如：
--   src/app/api/clients/[id]/seo-gap/route.ts:15 import { supabaseAdmin }
--     :71 / :126 / :208 / :248 均为 supabaseAdmin
--   src/app/api/clients/[id]/blog/keyword-suggestions/route.ts:53
-- service_role 绕过 RLS，收紧对服务端零影响。
--
-- ── 范围严格限定为这一条，不扩大 ────────────────────────────────────────────
-- 沙盘实测：roles={authenticated} 的策略共 13 条，其中
--   · **无条件放行（qual 与 with_check 均为 true）：只有这 1 条**
--   · 带真实条件（owner 维度等）：12 条 —— **一律不动**
-- 复审明确否决了「把 20260803020000 的判据加宽到覆盖 {authenticated}」的方案，
-- 理由之一就是会误伤这 12 条。所以这里用 ALTER POLICY 精确点名，不做模式匹配。
--
-- ── 用 ALTER 不用 DROP+CREATE ───────────────────────────────────────────────
-- 照 20260803020000 的做法：只改角色，不动条件，中间没有「表裸奔」的时间窗。
-- =============================================================================

DO $$
BEGIN
  ALTER POLICY "seo_analyses_admin_all" ON public.seo_analyses TO service_role;
  RAISE NOTICE '已把 seo_analyses_admin_all 收回给 service_role';
EXCEPTION
  WHEN undefined_object THEN
    -- 策略不存在（例如更早的库状态或已被别处改名）。不建新的：
    -- 本文件的职责是「收紧一条已知的过宽策略」，不是「确保某策略存在」。
    -- 下面的自检仍会拦住任何无条件 {authenticated} 策略。
    RAISE NOTICE 'seo_analyses_admin_all 不存在，跳过（末态自检仍会把关）';
END $$;

-- ── 收尾自检 ────────────────────────────────────────────────────────────────
-- 真闸门：断言末态属性「不存在无条件放行的 {authenticated} 策略」。
-- 与本次改了哪一条、与哪个库都无关；带真实条件的 12 条不受影响。
DO $$
DECLARE
  leftover text;
  n INT;
BEGIN
  SELECT count(*), string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO n, leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles::text = '{authenticated}'
     AND COALESCE(qual, 'true')       = 'true'
     AND COALESCE(with_check, 'true') = 'true';

  IF n <> 0 THEN
    RAISE EXCEPTION '仍有 % 条 {authenticated} 无条件放行策略：%', n, leftover;
  END IF;

  RAISE NOTICE '✅ 已无 {authenticated} 的无条件放行策略（带真实条件的 12 条未触碰）';
END $$;
