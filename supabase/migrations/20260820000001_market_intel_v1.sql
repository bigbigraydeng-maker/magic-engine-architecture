-- Magic Insight（内部代号 market-intel）—— PM 每日全球 AI / 数字营销资讯雷达。
-- 设计见 docs/specs/2026-08-20-market-intel-digest-design.md（v2，已过子牙+魏征设计审）。
--
-- 四张表，全部不挂 client_id —— 这是 ME 自身的内容资产，不属于任何客户。
-- 目前没有任何公开读路径（官网发布已撤出 Phase 1），所以权限设置直接套用最简单的
-- service-role-only 模板，不需要为"给谁读"做任何放宽 —— 2026-08-03/08-18/08-19 那几次
-- 漏写 `TO service_role` 导致对匿名访客敞开的事故，这次从建表第一天就按对写。

-- ---------------------------------------------------------------------------
-- 1. 信源配置
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_sources (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  feed_url               text NOT NULL UNIQUE,
  -- 只是"这个信源大概率相关哪些分类"的提示，用来跳过不必要的关键词匹配，
  -- 不是分类判定的权威来源——权威判定在 item 级关键词匹配（见 market_intel_items.matched_category）。
  categories             text[] NOT NULL DEFAULT '{}',
  enabled                boolean NOT NULL DEFAULT true,
  last_fetched_at        timestamptz,
  last_success_at        timestamptz,
  -- HTTP 请求本身失败/超时的连续计数（不是"0 条新条目"，那种情况可能只是没新闻，不算故障）。
  consecutive_fail_count integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_intel_sources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY market_intel_sources_service ON market_intel_sources
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. 抓取到的原始条目
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid NOT NULL REFERENCES market_intel_sources(id),
  title            text NOT NULL,
  url              text NOT NULL,
  published_at     timestamptz,
  raw_excerpt      text NOT NULL DEFAULT '',
  -- 单条最终归属的分类；不命中任何分类关键词白名单的条目不会被插入这张表。
  matched_category text NOT NULL,
  -- normalize(title) 的哈希（不含来源 domain——v1 设计把 domain 算进哈希导致
  -- 跨信源去重永远失效，v2 已修正，见设计文档 §六）。跨信源、跨天查重都靠它。
  dedupe_hash      text NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  -- 同一信源的同一条 URL 不重复入库（cron 每天重跑会重新抓到同一批旧条目）。
  UNIQUE (source_id, url)
);

CREATE INDEX IF NOT EXISTS market_intel_items_dedupe_hash_idx ON market_intel_items (dedupe_hash);
CREATE INDEX IF NOT EXISTS market_intel_items_category_fetched_idx
  ON market_intel_items (matched_category, fetched_at);

ALTER TABLE market_intel_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY market_intel_items_service ON market_intel_items
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. 每日成品（真正发进邮件的那些）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_digests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NZ 本地日历日期（从 cron 实际运行的 UTC 时间换算），不是原始 UTC 日期——
  -- 避免邮件里的"今天"跟 PM 体感的日期错一天。
  digest_date        date NOT NULL,
  category           text NOT NULL,
  headline_zh        text NOT NULL,
  summary_zh         text NOT NULL,
  source_item_id     uuid NOT NULL REFERENCES market_intel_items(id),
  -- 从对应 item 复制一份 dedupe_hash 过来：过去 7 天去重要查的是"真正发过的"
  -- digests，不是所有抓到过的 items——否则一条新闻只要被抓到过一次、哪怕
  -- 当天没入选，也会在未来 7 天里永久失去再次入选的资格。
  dedupe_hash        text NOT NULL,
  -- AI 摘要生成后的自动核对结果：摘要里的数字/专有名词是否都能在 raw_excerpt 里找到。
  -- 核对失败的条目不进邮件，但留在表里供人工翻查，不是静默丢弃。
  grounding_check     text NOT NULL DEFAULT 'passed'
    CHECK (grounding_check IN ('passed', 'failed')),
  email_sent_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 防止 cron 重试/重跑时插入重复行。
  UNIQUE (digest_date, category, source_item_id)
);

CREATE INDEX IF NOT EXISTS market_intel_digests_date_idx ON market_intel_digests (digest_date);
CREATE INDEX IF NOT EXISTS market_intel_digests_dedupe_hash_idx ON market_intel_digests (dedupe_hash);

ALTER TABLE market_intel_digests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY market_intel_digests_service ON market_intel_digests
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4. 每日编者按
-- ---------------------------------------------------------------------------
-- 单独一张小表：编者按评论的是"当天所有入选条目"，不对应单一 source_item_id，
-- 硬塞进 digests 表会破坏"每条资讯可追溯单一 URL"的约束。
CREATE TABLE IF NOT EXISTS market_intel_daily_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date date NOT NULL UNIQUE,
  note_zh     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_intel_daily_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY market_intel_daily_notes_service ON market_intel_daily_notes
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 5. 自检：四张表必须全部锁定到 service_role，一个 public/anon 策略都不许有
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'market_intel_sources', 'market_intel_items',
       'market_intel_digests', 'market_intel_daily_notes'
     )
     AND roles::text <> '{service_role}';

  IF leftover <> 0 THEN
    RAISE EXCEPTION 'market_intel_* 有 % 条策略没有锁定到 service_role，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ market_intel_* 四张表 RLS 已全部锁定到 service_role，零 anon 权限';
END $$;
