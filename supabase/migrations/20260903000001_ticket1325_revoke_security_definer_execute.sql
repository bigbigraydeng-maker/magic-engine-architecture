-- =============================================================================
-- #1325 · 4 个 SECURITY DEFINER 函数收回 anon / authenticated 的 EXECUTE
--
-- 来源：2026-09-03 对 20260803020000 的 A 级复审，攻击验证环节实测发现。
--
-- ── 问题 ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER 函数以**定义者身份**执行，**完全绕过 RLS**。
-- 也就是说：把表上的策略收紧到 service_role 也挡不住这条路 ——
-- 攻击验证实测中，anon 用其中一个函数改掉了一张「已被正确锁到 service_role」的表。
--
-- Postgres 新建函数时**默认给 PUBLIC EXECUTE**，必须显式 REVOKE 才关得掉。
-- 仓库里已有这个惯例（6 个 migration 共 19 条 REVOKE），这 4 个是漏网。
--
-- ── 范围核实（沙盘实测，非清单照抄）────────────────────────────────────────
-- 查 pg_proc 全量扫 public schema 下 prosecdef = true 的函数，共 18 个。
-- 其中 14 个（factory_* / kernel_* / product_map_*）的 proacl 里已无裸 `=X/`
-- 条目，即 PUBLIC 已被 REVOKE，写法正确，本文件不动它们。
--
-- 需要收紧的是 5 个：
--   activate_geo_directive(uuid, uuid)
--       proacl 含 `=X/`（PUBLIC 默认）**和** `authenticated=X/`（显式授予）
--   mtc_deduct_atomic(uuid, text, integer, text, text, text)     proacl 含 `=X/`
--   zhangqian_rate_limit_consume(text, text, timestamptz, integer) proacl 含 `=X/`
--   sync_execution_item_on_post_published()                       proacl 为 NULL = 默认 PUBLIC 可执行
--   product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)   ← 见下方 Q3
--
-- ── Q3：第 5 个是本文件末尾那道自检闸门自己抓出来的 ────────────────────────
-- 起初我只列了 4 个 —— 因为在**裸 Postgres** 沙盘上看，product_map_commit_sync_v1
-- 的 proacl 是 `raydeng=X ; service_role=X`，没有 PUBLIC，看着是干净的。
--
-- 但那个沙盘不忠实。真实 Supabase 项目建库时就配了默认权限
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
-- 之后每个新建函数**自动**带上 anon=X / authenticated=X —— 这是独立授权，
-- **不经过 PUBLIC**。
--
-- 而 20260815000001_product_map_sync_v1.sql 第 262 行写的是：
--     REVOKE ALL ON FUNCTION product_map_commit_sync_v1(...) FROM PUBLIC;
-- 只收 PUBLIC，收不掉 anon/authenticated 那两条独立授权。
-- 对比写法正确的（20260711000002 / 20260808000003）：
--     REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;
--
-- 全仓审计：只有 20260815000001 这一处用了不完整的 `FROM PUBLIC;` 写法。
-- 忠实沙盘实测确认 18 个 SECURITY DEFINER 函数里 13 个已锁好、5 个可被 anon 调用。
--
-- 教训记在这里：**`REVOKE ... FROM PUBLIC` 在 Supabase 上不等于收干净了。**
--
-- ── 两个必须先回答的问题，都已实测 ─────────────────────────────────────────
--
-- Q1：activate_geo_directive 的 authenticated 权限是 20260623000001_geo_activate_rpc.sql
--     第 96 行**显式授予**的，不是疏忽。收回会不会弄坏 GEO 激活？
--   → 不会。唯一调用点
--     src/app/api/clients/[id]/geo/[directiveId]/activate/route.ts:39-40
--     用的是 supabaseAdmin(service_role)，且该路由第 18 行 import 的就是
--     supabaseAdmin。那条 authenticated 授权目前**没有任何调用方**。
--     本文件一并收回；若将来真需要浏览器直调，请单独开 PR 说明理由再授予。
--
-- Q2：sync_execution_item_on_post_published() 无参数，看形态是触发器函数。
--     REVOKE EXECUTE 会不会让触发器失效？
--   → 不会。2026-09-03 在本机 PostgreSQL 17.11 上做了最小复现：
--     建 SECURITY DEFINER 触发器函数 + 触发器，REVOKE 后
--       · anon 直接 PERFORM f()  → permission denied for function f  ✅ 关上了
--       · anon INSERT 触发触发器 → 触发器正常触发，日志表新增一行     ✅ 没弄坏
--     Postgres 触发触发器时不检查调用者对函数的 EXECUTE 权限。
--
-- ── 签名必须写全 ────────────────────────────────────────────────────────────
-- REVOKE EXECUTE ON FUNCTION 必须带**精确参数类型**，签名写错 = 静默无效
-- （不报错，权限也没收回）。下面的签名取自沙盘
-- pg_get_function_identity_arguments()，非手写。
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.activate_geo_directive(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activate_geo_directive(uuid, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.mtc_deduct_atomic(uuid, text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mtc_deduct_atomic(uuid, text, integer, text, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.zhangqian_rate_limit_consume(text, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.zhangqian_rate_limit_consume(text, text, timestamptz, integer)
  TO service_role;

-- 触发器函数：REVOKE 只关直接调用，触发器照常（见上面 Q2 实测）。
REVOKE EXECUTE ON FUNCTION public.sync_execution_item_on_post_published()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_execution_item_on_post_published()
  TO service_role;

-- 第 5 个（见上方 Q3）：20260815000001:262 只写了 FROM PUBLIC，
-- 收不掉 Supabase 默认权限给 anon/authenticated 的那两条独立授权。这里补齐。
REVOKE EXECUTE ON FUNCTION public.product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)
  TO service_role;

-- ── 收尾自检 ────────────────────────────────────────────────────────────────
-- 真闸门：断言末态属性「不存在 anon/authenticated/PUBLIC 可执行的
-- SECURITY DEFINER 函数」。与本次改了几个、与哪个库都无关。
-- 将来谁再加一个漏 REVOKE 的 SECURITY DEFINER 函数，这里会拦下。
DO $$
DECLARE
  leaked text;
  n INT;
BEGIN
  SELECT count(*), string_agg(sig, ', ' ORDER BY sig) INTO n, leaked
  FROM (
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosecdef
       AND (
             p.proacl IS NULL                                    -- NULL = 默认 PUBLIC 可执行
             OR EXISTS (
                  SELECT 1 FROM aclexplode(p.proacl) a
                   WHERE a.privilege_type = 'EXECUTE'
                     AND (
                          a.grantee = 0                          -- 0 = PUBLIC
                          OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')
                          OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
                     )
                )
           )
  ) s;

  IF n <> 0 THEN
    RAISE EXCEPTION '仍有 % 个 SECURITY DEFINER 函数对 anon/authenticated/PUBLIC 可执行：%', n, leaked;
  END IF;

  RAISE NOTICE '✅ 已无对 anon/authenticated/PUBLIC 可执行的 SECURITY DEFINER 函数';
END $$;
