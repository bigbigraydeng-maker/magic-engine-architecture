-- =============================================================================
-- #1324 · 给 9 张 RLS 从未开启的表补上 RLS + service_role 策略
--
-- 来源：2026-09-03 对 20260803020000 的 A 级复审，攻击验证环节实测发现。
--
-- ── 问题 ────────────────────────────────────────────────────────────────────
-- 这 9 张表 **RLS 从未开启、也没有任何策略**。
-- RLS 关闭 + 无策略 + Supabase 默认给 anon/authenticated 的表级 GRANT
--   = anon 可读可改可删。
--
-- 20260803020000 只 ALTER 已存在的策略，结构上碰不到这 9 张，
-- 所以它跑完之后这 9 张是**唯一还全裸**的表。
--
-- ⚠️ 特别注意 mtc_purchases / mtc_ledger 是 MTC 充值与消费账本。
--
-- 顺带更正一个认知错误：20260803020000 原注释把这批表归入
-- 「未受影响（策略写法正确**或无策略**）」—— 把「无策略」当成安全，方向是反的。
-- 该注释已在同一批改动里改正。
--
-- ── 为什么收紧是安全的（改前逐表核实，非引用注释）────────────────────────
-- 对这 9 张表在生产仓 src/ 下逐表追调用面，结论：
--   **全部 9 张表的每一个非测试调用点都用 supabaseAdmin(service_role)。**
--   service_role 绕过 RLS，所以开 RLS 对服务端零影响。
--
-- 逐表调用点文件数（2026-09-03 实测）：
--   discovery_leads                    3   全 supabaseAdmin
--   public_scan_jobs                  12   全 supabaseAdmin ※
--   stripe_events_log                  1   全 supabaseAdmin
--   mtc_purchases                      6   全 supabaseAdmin
--   mtc_ledger                         6   全 supabaseAdmin
--   industry_brand_canonical           1   全 supabaseAdmin
--   industry_ai_visibility_questions   3   全 supabaseAdmin
--   industry_ai_visibility_runs        3   全 supabaseAdmin
--   industry_ai_visibility_snapshots   3   全 supabaseAdmin
--
--   ※ 曾疑似例外并逐行核实过的两个文件：
--     src/app/api/prospect/report/route.ts 与 .../report/docx/route.ts
--     确实 import 了 createServerSupabaseClient（cookie 客户端），
--     但那只用于**鉴权判断**；读 public_scan_jobs 的那两行（:39 / :48）
--     用的仍是 supabaseAdmin。故不受影响。
--
--   名字带 public / discovery 的两张（public_scan_jobs / discovery_leads）
--   是重点怀疑对象 —— 已确认对外写入同样经服务端 API 路由 + service_role，
--   浏览器不直连这两张表。
--
-- ── 策略模板 ────────────────────────────────────────────────────────────────
-- 按 CLAUDE.md 铁律：FOR ALL TO service_role USING (true) WITH CHECK (true)。
-- **必须写 TO service_role** —— 漏掉就是 TO PUBLIC，正是 2026-08-03 那次
-- 泄露 118 条策略的成因。
-- =============================================================================

-- ENABLE ROW LEVEL SECURITY 本身幂等，重跑安全。
ALTER TABLE public.discovery_leads                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_scan_jobs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtc_purchases                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtc_ledger                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_brand_canonical          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_ai_visibility_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_ai_visibility_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_ai_visibility_snapshots  ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY 不幂等，逐条包 duplicate_object 保护。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'discovery_leads',
    'public_scan_jobs',
    'stripe_events_log',
    'mtc_purchases',
    'mtc_ledger',
    'industry_brand_canonical',
    'industry_ai_visibility_questions',
    'industry_ai_visibility_runs',
    'industry_ai_visibility_snapshots'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "service_role_full" ON public.%I '
        'FOR ALL TO service_role USING (true) WITH CHECK (true)', t
      );
      RAISE NOTICE '已建策略 service_role_full ON %', t;
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE '策略 service_role_full ON % 已存在，跳过', t;
    END;
  END LOOP;
END $$;

-- ── 收尾自检 ────────────────────────────────────────────────────────────────
-- 这一段是**真闸门**（与上面的动作不同谓词，不是恒真重读）：
-- 它断言的是末态属性「public schema 下不存在 RLS 未开启的表」，
-- 与本次改了几张、与是哪个库都无关。
DO $$
DECLARE
  open_tables text;
  n INT;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO n, open_tables
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relkind  = 'r'
     AND c.relrowsecurity = false;

  IF n <> 0 THEN
    RAISE EXCEPTION 'public schema 下仍有 % 张表未开启 RLS：%', n, open_tables;
  END IF;

  RAISE NOTICE '✅ public schema 下已无 RLS 未开启的表';
END $$;
