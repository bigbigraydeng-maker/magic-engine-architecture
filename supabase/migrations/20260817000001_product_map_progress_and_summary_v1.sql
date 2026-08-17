-- ME2 Product Map —— 每日进度快照 + issue/PR 人话摘要缓存(WP: ME2 Product Map v1,PR4)。
--
-- 背景:PM 反馈两点 —— (1) 看不到整体进度每天怎么涨的,(2) issue/PR 标题太技术看不懂。
-- 这次改动:
--   1. product_map_pr_facts / product_map_issue_facts 各加两列缓存人话摘要(大模型生成,
--      标题级短文本,只在每日 cron 里对缺摘要的行补一次,绝不重算已有摘要)。
--   2. 新表 product_map_progress_snapshots —— 每日 full 轮结束后写一行,复用页面同一套
--      buildPresentation 算出的 buckets/成熟度分布,不是另开一套统计口径。
--
-- 🔴 并发护栏(魏征复审):同一天可能有多次 full 轮(超时重试/手工重跑),快照按
--    snapshot_date 覆盖式 upsert,但只有「跑得更晚的那一轮」才能覆盖已有行 ——
--    用 run_started_at 做单调守卫,跟 pr_facts/issue_facts 的 observed_at 单调守卫同一个思路。
--
-- 🔴 RLS:两张改动表已有的 service-role 策略覆盖新列,不用重建;新表照抄仓库范式,
--    必须显式 TO service_role(2026-08-03 事故教训 —— 漏这半句 = 对匿名访客敞开)。

-- ---------------------------------------------------------------------------
-- 1. 摘要缓存列
-- ---------------------------------------------------------------------------

ALTER TABLE product_map_pr_facts
  ADD COLUMN IF NOT EXISTS human_summary text,
  ADD COLUMN IF NOT EXISTS human_summary_generated_at timestamptz;

ALTER TABLE product_map_issue_facts
  ADD COLUMN IF NOT EXISTS human_summary text,
  ADD COLUMN IF NOT EXISTS human_summary_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. 每日进度快照
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_map_progress_snapshots (
  snapshot_date        date PRIMARY KEY,
  total_components     integer NOT NULL,
  operating_count      integer NOT NULL,
  built_not_live_count integer NOT NULL,
  building_count       integer NOT NULL,
  -- { M0_REGISTERED: n, M1_CONTRACT_FROZEN: n, ... } —— 六个台阶各多少
  maturity_counts      jsonb NOT NULL,
  sync_run_id          uuid NOT NULL REFERENCES product_map_sync_runs (id),
  -- 单调守卫用:只有 run_started_at 更晚(或相等,允许同一轮的重放/幂等调用)的写入
  -- 才能覆盖已有行 —— 见下方 RPC。
  run_started_at       timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_map_progress_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY product_map_progress_snapshots_service ON product_map_progress_snapshots
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. 快照单调 upsert —— 原子的 INSERT ... ON CONFLICT ... WHERE 守卫
--    (不需要塞进 product_map_commit_sync_v1 那个大事务:快照是纯衍生的历史记录,
--    不是权威数据,子牙设计审已确认这条边界;但并发覆盖必须防,魏征设计审的必改项)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION product_map_upsert_progress_snapshot_v1(
  p_snapshot_date        date,
  p_total_components     integer,
  p_operating_count      integer,
  p_built_not_live_count integer,
  p_building_count       integer,
  p_maturity_counts      jsonb,
  p_sync_run_id          uuid,
  p_run_started_at       timestamptz
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_written boolean;
BEGIN
  INSERT INTO product_map_progress_snapshots (
    snapshot_date, total_components, operating_count, built_not_live_count,
    building_count, maturity_counts, sync_run_id, run_started_at
  ) VALUES (
    p_snapshot_date, p_total_components, p_operating_count, p_built_not_live_count,
    p_building_count, p_maturity_counts, p_sync_run_id, p_run_started_at
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    total_components     = excluded.total_components,
    operating_count       = excluded.operating_count,
    built_not_live_count  = excluded.built_not_live_count,
    building_count        = excluded.building_count,
    maturity_counts       = excluded.maturity_counts,
    sync_run_id            = excluded.sync_run_id,
    run_started_at         = excluded.run_started_at
  WHERE excluded.run_started_at >= product_map_progress_snapshots.run_started_at
  RETURNING true INTO v_written;

  -- WHERE 守卫拒绝时 RETURNING 不产出行,v_written 落 NULL —— 说明「今天已有更晚一轮
  -- 的快照,这次写入被让过」,是正常的并发结果,不是错误,调用方按此区分。
  RETURN COALESCE(v_written, false);
END;
$$;

GRANT EXECUTE ON FUNCTION product_map_upsert_progress_snapshot_v1(
  date, integer, integer, integer, integer, jsonb, uuid, timestamptz
) TO service_role;
