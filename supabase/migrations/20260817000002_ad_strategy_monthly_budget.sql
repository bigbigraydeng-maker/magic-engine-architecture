-- ============================================================================
-- 客户的「月广告预算」—— SOP《Meta 广告角度测试与预算分配》第 2 节的唯一输入
--
-- 为什么要加这个字段：
--   SOP 的公式是「本月探索池 = 客户真实月预算 × 20%」，而**全库没有任何地方
--   记着客户的月广告预算**（`clients.monthly_quota` / `monthly_mtc_cap` 是 MTC
--   额度，不是广告钱；`goals.budget_amount` 是单个目标的预算，口径不同）。
--   没有它，SOP 第一步就算不出来，后面的臂数、判据、轮次全部无从谈起。
--
-- 🔴 **不能拿「已经花掉的钱」倒推预算。** 那是花了多少，不是准备花多少 ——
--    审计里 Oztop 54 天花 AUD 3,608 折算月额 ≈ 2,005，但那只是他实际投放的
--    速度，不代表他这个月打算给多少。SOP v1 初稿正是拿观察期总额当月预算，
--    算出「35% 能开 3 条臂」，实际折算后只有 1.25 条 —— 差了一倍多。
--
-- 配套（同一个 PR 内，铁律 8：要人填的字段必须连界面一起做完）：
--   · 读写：src/lib/ads-strategy/config.ts
--   · 接口：src/app/api/clients/[id]/ad-strategy-config/route.ts
--   · 界面：src/app/dashboard/clients/[id]/settings/_components/AdStrategyPanel.tsx
--   · 待办：src/lib/pm-todo/ads-angle-test-items.ts（没填 → 进今日待办）
--
-- 🔴 **需要 Product Owner 重新说一次 `go apply budget` 才能 apply。**
--    2026-08-17 授权过一次，但当时那一版没有 `monthly_ad_budget_month` 这一列
--    （子牙 2026-08-18 复审后加的），**内容已经变了，旧的那次授权不算数**。
-- ============================================================================

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS monthly_ad_budget            numeric,
  -- 🔴 币种必须跟金额一起存。`ad_daily_insights` 至今没有币种列（`AD-CUR-1`），
  --    而 CTS / Roman 是 NZD、Oztop 是 AUD —— 只存数字的话，这个字段一样会变成
  --    下一个「混币种加总」的源头。目标市场是 AU/NZ，所以只收这两个；
  --    将来真有别的币种，加一个值是一行 migration 的事，不必现在放宽。
  ADD COLUMN IF NOT EXISTS monthly_ad_budget_currency   text,
  -- 谁什么时候填的 —— 预算是会变的业务事实，没有这两列就说不清「这个数还新不新」
  ADD COLUMN IF NOT EXISTS monthly_ad_budget_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS monthly_ad_budget_updated_by text,
  -- 🔴 **这笔预算算哪个月的，要存下来，不要事后拿时间戳推**（子牙/魏征 2026-08-18 复审）。
  --    「填的时刻」和「算哪个月」是两件事：推的时候用哪个时区就决定了结论，
  --    而客户散在 AU/NZ 两个时区 —— 悉尼 9/30 22:30 保存的 9 月预算，按 NZ 推
  --    会得到 10 月，于是整个 10 月不再复核（原 C1）。存下来则是**当时按客户
  --    自己所在国的时区算好的事实**，以后升级成月度历史表时
  --    `(client_id, monthly_ad_budget_month)` 天然就是主键，回填是精确的。
  ADD COLUMN IF NOT EXISTS monthly_ad_budget_month      text;

DO $$ BEGIN
  ALTER TABLE public.ad_strategy_configs
    ADD CONSTRAINT ad_strategy_monthly_budget_currency_valid
    CHECK (monthly_ad_budget_currency IS NULL
           OR monthly_ad_budget_currency IN ('AUD', 'NZD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 🔴 金额必须是个真实金额。判据跟 `client_automation_policies.spend_cap_*`
  --    逐条一致（生产 PG 17.6 实测过）：
  --      · `'NaN'::numeric >= 0`      → true  —— 只写 `> 0` 拦不住 NaN
  --      · `'NaN'::numeric <> 'NaN'`  → false —— 所以 `<> 'NaN'` 能拦住它
  --      · `'Infinity'::numeric >= 0` → true  —— 要 `< 'Infinity'` 才拦得住
  --    这里比花费上限更严一点用 `> 0`：月预算填 0 没有任何业务含义，
  --    「这个客户这个月不投广告」的表达方式是**不填**（NULL），不是填 0 ——
  --    填 0 会让探索池算出 0、臂数算出 0，看起来像「算过了，结论是别测」，
  --    而实际上是有人填错了。两者必须分得开。
  ALTER TABLE public.ad_strategy_configs
    ADD CONSTRAINT ad_strategy_monthly_budget_is_a_real_amount
    CHECK (monthly_ad_budget IS NULL
           OR (monthly_ad_budget > 0
               AND monthly_ad_budget <> 'NaN'::numeric
               AND monthly_ad_budget <  'Infinity'::numeric));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 金额和币种必须成对出现 —— 只有数字没有币种，就是 `AD-CUR-1` 那个洞的新入口。
  ALTER TABLE public.ad_strategy_configs
    ADD CONSTRAINT ad_strategy_monthly_budget_paired
    CHECK ((monthly_ad_budget IS NULL) = (monthly_ad_budget_currency IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- `YYYY-MM`，别的一律拒绝。读侧是字符串直接比对，形状歪了就永远比不上，
  -- 那会变成「看起来填了、待办天天催」，所以在库这一层就卡死。
  ALTER TABLE public.ad_strategy_configs
    ADD CONSTRAINT ad_strategy_monthly_budget_month_shape
    CHECK (monthly_ad_budget_month IS NULL
           OR monthly_ad_budget_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 月份与时间戳同生同灭 —— 两者都是「有人在这个月动过预算」这一个事实的两面。
  -- 只有其中一个，四态判定（填了 / 上月的 / 确认不投 / 没问过）就会有一档说不清。
  ALTER TABLE public.ad_strategy_configs
    ADD CONSTRAINT ad_strategy_monthly_budget_month_paired_with_ts
    CHECK ((monthly_ad_budget_month IS NULL) = (monthly_ad_budget_updated_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.ad_strategy_configs.monthly_ad_budget IS
  '客户这个月准备投的广告预算（不是已花金额）。SOP：本月探索池 = 本值 × 20%。NULL = 还没问到。';
COMMENT ON COLUMN public.ad_strategy_configs.monthly_ad_budget_currency IS
  '预算币种（AUD / NZD）。必须与金额成对出现 —— ad_daily_insights 没有币种列，见 AD-CUR-1。';
COMMENT ON COLUMN public.ad_strategy_configs.monthly_ad_budget_month IS
  '这笔预算/这次「本月不投」的决定算哪个业务月（YYYY-MM），按客户所在国的时区在写入时算好。读侧只做字符串比对，不再从 updated_at 推。';
