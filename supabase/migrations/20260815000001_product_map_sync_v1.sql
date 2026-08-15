-- ME2 Product Map — GitHub 只读同步持久化 v1(WP: ME2 Product Map v1,PR 2/3)
--
-- ⚠️ 本文件随 PR 合并进 main ≠ 已 apply。apply 是独立的 PO 授权动作;
--    apply 后必须跑一次 admin refresh 当 canary(验证 RPC 真存在)。
--
-- 表:
--   product_map_sync_runs           同步运行台账(ok|partial|error,失败不许静默)
--   product_map_pr_facts            PR 事实快照(行级 last-known-good,checks 按 head sha 键控)
--   product_map_issue_facts         Issue 事实快照
--   product_map_unclassified_work   未分类 Git 工作队列(只展示,零 GitHub 写回)
--   product_map_webhook_deliveries  webhook 投递幂等台账(claim-first;failed 可重试)
-- RPC:
--   product_map_commit_sync_v1      单事务落 run+facts+unclassified;
--                                   逐行单调守卫(observed_at 旧的不覆盖新行);
--                                   unclassified 收编只在 full 模式。
--
-- RLS:service-role 模板(必须带 TO service_role —— 漏掉 = 对匿名访客敞开读写)。

CREATE TABLE IF NOT EXISTS product_map_sync_runs (
  id            uuid PRIMARY KEY,
  trigger       text NOT NULL CHECK (trigger IN ('webhook', 'cron', 'manual')),
  mode          text NOT NULL CHECK (mode IN ('full', 'targeted')),
  status        text NOT NULL CHECK (status IN ('ok', 'partial', 'error')),
  main_head_sha text,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_map_sync_runs_started
  ON product_map_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_map_sync_runs_status
  ON product_map_sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS product_map_pr_facts (
  pr_number               integer PRIMARY KEY,
  state                   text NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
  is_draft                boolean NOT NULL,
  base_ref                text NOT NULL,
  head_sha                text NOT NULL,
  merged_commit_sha       text,
  mergeable_state         text NOT NULL DEFAULT 'unknown',
  unresolved_threads      integer,
  checks                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { sha, checks: [...] } 按 head sha 键控
  changed_files           jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_files_truncated boolean NOT NULL DEFAULT false,
  title                   text NOT NULL DEFAULT '',
  observed_at             timestamptz NOT NULL,
  sync_run_id             uuid NOT NULL REFERENCES product_map_sync_runs (id),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_map_issue_facts (
  issue_number integer PRIMARY KEY,
  state        text NOT NULL CHECK (state IN ('open', 'closed')),
  title        text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL,
  observed_at  timestamptz NOT NULL,
  sync_run_id  uuid NOT NULL REFERENCES product_map_sync_runs (id)
);

CREATE TABLE IF NOT EXISTS product_map_unclassified_work (
  kind          text NOT NULL CHECK (kind IN ('pr', 'issue')),
  number        integer NOT NULL,
  title         text NOT NULL DEFAULT '',
  url           text NOT NULL DEFAULT '',
  opened_at     timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  PRIMARY KEY (kind, number)
);

CREATE TABLE IF NOT EXISTS product_map_webhook_deliveries (
  delivery_id   text PRIMARY KEY,   -- GitHub X-GitHub-Delivery GUID(Redeliver 复用同一 GUID)
  event         text NOT NULL,
  action        text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('processed', 'skipped_duplicate', 'failed')),
  error_message text
);

-- RLS —— service-role 模板(2026-08-03 实测:漏 TO service_role = 118 条策略对匿名敞开)
ALTER TABLE product_map_sync_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_map_pr_facts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_map_issue_facts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_map_unclassified_work  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_map_webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY 没有 IF NOT EXISTS —— 按仓库范式包 duplicate_object,
-- SQL Editor 手工 apply 半途重跑是常态,不许在这里卡死
DO $$ BEGIN
  CREATE POLICY product_map_sync_runs_service          ON product_map_sync_runs          FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY product_map_pr_facts_service           ON product_map_pr_facts           FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY product_map_issue_facts_service        ON product_map_issue_facts        FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY product_map_unclassified_work_service  ON product_map_unclassified_work  FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY product_map_webhook_deliveries_service ON product_map_webhook_deliveries FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 原子落库 RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION product_map_commit_sync_v1(
  p_run          jsonb,
  p_pr_facts     jsonb,
  p_issue_facts  jsonb,
  p_unclassified jsonb,
  p_mode         text,
  p_resolve      jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id        uuid := (p_run->>'id')::uuid;
  v_skipped_stale integer := 0;
  v_fact          jsonb;
  v_existing_obs  timestamptz;
  v_now           timestamptz := now();
BEGIN
  IF p_mode NOT IN ('full', 'targeted') THEN
    RAISE EXCEPTION 'product_map_commit_sync_v1: 非法 mode %', p_mode;
  END IF;

  INSERT INTO product_map_sync_runs (id, trigger, mode, status, main_head_sha, started_at, finished_at, stats, error_message)
  VALUES (
    v_run_id,
    p_run->>'trigger',
    p_run->>'mode',
    p_run->>'status',
    p_run->>'main_head_sha',
    (p_run->>'started_at')::timestamptz,
    (p_run->>'finished_at')::timestamptz,
    COALESCE(p_run->'stats', '{}'::jsonb),
    p_run->>'error_message'
  );

  -- PR facts:逐行单调守卫 —— fetch 完成顺序 ≠ 事件顺序,
  -- observed_at 早于(或等于)现有行的写入一律跳过并记数,防旧数据打回新状态。
  FOR v_fact IN SELECT * FROM jsonb_array_elements(COALESCE(p_pr_facts, '[]'::jsonb)) LOOP
    SELECT observed_at INTO v_existing_obs
      FROM product_map_pr_facts WHERE pr_number = (v_fact->>'pr_number')::integer;
    IF v_existing_obs IS NOT NULL AND v_existing_obs >= (v_fact->>'observed_at')::timestamptz THEN
      v_skipped_stale := v_skipped_stale + 1;
      CONTINUE;
    END IF;
    INSERT INTO product_map_pr_facts (
      pr_number, state, is_draft, base_ref, head_sha, merged_commit_sha,
      mergeable_state, unresolved_threads, checks, changed_files,
      changed_files_truncated, title, observed_at, sync_run_id, updated_at
    ) VALUES (
      (v_fact->>'pr_number')::integer,
      v_fact->>'state',
      (v_fact->>'is_draft')::boolean,
      v_fact->>'base_ref',
      v_fact->>'head_sha',
      v_fact->>'merged_commit_sha',
      COALESCE(v_fact->>'mergeable_state', 'unknown'),
      (v_fact->>'unresolved_threads')::integer,
      COALESCE(v_fact->'checks', '{}'::jsonb),
      COALESCE(v_fact->'changed_files', '[]'::jsonb),
      COALESCE((v_fact->>'changed_files_truncated')::boolean, false),
      COALESCE(v_fact->>'title', ''),
      (v_fact->>'observed_at')::timestamptz,
      v_run_id,
      v_now
    )
    ON CONFLICT (pr_number) DO UPDATE SET
      state = EXCLUDED.state,
      is_draft = EXCLUDED.is_draft,
      base_ref = EXCLUDED.base_ref,
      head_sha = EXCLUDED.head_sha,
      merged_commit_sha = EXCLUDED.merged_commit_sha,
      -- mergeable 'unknown' 不覆盖已知值(GitHub 异步计算,首查常 unknown)
      mergeable_state = CASE WHEN EXCLUDED.mergeable_state = 'unknown'
                             THEN product_map_pr_facts.mergeable_state
                             ELSE EXCLUDED.mergeable_state END,
      -- threads 抓取失败(null)留旧值
      unresolved_threads = COALESCE(EXCLUDED.unresolved_threads, product_map_pr_facts.unresolved_threads),
      checks = EXCLUDED.checks,
      changed_files = EXCLUDED.changed_files,
      changed_files_truncated = EXCLUDED.changed_files_truncated,
      title = EXCLUDED.title,
      observed_at = EXCLUDED.observed_at,
      sync_run_id = EXCLUDED.sync_run_id,
      updated_at = v_now;
  END LOOP;

  FOR v_fact IN SELECT * FROM jsonb_array_elements(COALESCE(p_issue_facts, '[]'::jsonb)) LOOP
    SELECT observed_at INTO v_existing_obs
      FROM product_map_issue_facts WHERE issue_number = (v_fact->>'issue_number')::integer;
    IF v_existing_obs IS NOT NULL AND v_existing_obs >= (v_fact->>'observed_at')::timestamptz THEN
      v_skipped_stale := v_skipped_stale + 1;
      CONTINUE;
    END IF;
    INSERT INTO product_map_issue_facts (issue_number, state, title, updated_at, observed_at, sync_run_id)
    VALUES (
      (v_fact->>'issue_number')::integer,
      v_fact->>'state',
      COALESCE(v_fact->>'title', ''),
      (v_fact->>'updated_at')::timestamptz,
      (v_fact->>'observed_at')::timestamptz,
      v_run_id
    )
    ON CONFLICT (issue_number) DO UPDATE SET
      state = EXCLUDED.state,
      title = EXCLUDED.title,
      updated_at = EXCLUDED.updated_at,
      observed_at = EXCLUDED.observed_at,
      sync_run_id = EXCLUDED.sync_run_id;
  END LOOP;

  FOR v_fact IN SELECT * FROM jsonb_array_elements(COALESCE(p_unclassified, '[]'::jsonb)) LOOP
    INSERT INTO product_map_unclassified_work (kind, number, title, url, opened_at, first_seen_at, last_seen_at, resolved_at)
    VALUES (
      v_fact->>'kind',
      (v_fact->>'number')::integer,
      COALESCE(v_fact->>'title', ''),
      COALESCE(v_fact->>'url', ''),
      (v_fact->>'opened_at')::timestamptz,
      v_now, v_now, NULL
    )
    ON CONFLICT (kind, number) DO UPDATE SET
      title = EXCLUDED.title,
      last_seen_at = v_now,
      resolved_at = NULL;
  END LOOP;

  -- 收编只按显式确认名单(p_resolve),且只在 full 轮。
  -- 🔴 不做「本轮集合里没出现 = 已收编」的反推:30 天没动静的 open item 会掉出
  --    扫描窗口,被那种反推误标已收编 —— 发现死在台账里(铁律 3)。
  --    runner 会对存量未分类行逐个复核状态,确认「已关闭或已分类」才进 p_resolve。
  IF p_mode = 'full' THEN
    UPDATE product_map_unclassified_work u
       SET resolved_at = v_now
      FROM jsonb_array_elements(COALESCE(p_resolve, '[]'::jsonb)) r
     WHERE u.resolved_at IS NULL
       AND r->>'kind' = u.kind
       AND (r->>'number')::integer = u.number;
  END IF;

  -- skippedStale 回写 run 行 —— 不回写的话生产台账里它恒 0,只有返回值是真的
  UPDATE product_map_sync_runs
     SET stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{skippedStale}', to_jsonb(v_skipped_stale))
   WHERE id = v_run_id;

  RETURN jsonb_build_object('skipped_stale', v_skipped_stale);
END;
$$;

REVOKE ALL ON FUNCTION product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb) TO service_role;
