-- Publer polling 替代 webhook：分离 publer_job_id 和 publer_post_id
--
-- 历史背景：原 /api/publer/create-post 把 Publer 返回的 job_id 误存到
-- content_posts.publer_post_id 列。job_id 是异步调度任务的 ID，post_id
-- 才是真正帖子的 ID。要 polling Publer 拿状态，必须先用 job_id 查
-- /job_status 解析出真实的 post_id。
--
-- 这个 migration 加了 publer_job_id 列，新代码会把 job_id 存到这里，
-- 把真正的 post_id 留给 publer_post_id（保持 webhook handler 不变）。

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS publer_job_id text;

CREATE INDEX IF NOT EXISTS content_posts_publer_job_id_idx
  ON content_posts (publer_job_id)
  WHERE publer_job_id IS NOT NULL;

COMMENT ON COLUMN content_posts.publer_job_id IS
  'Publer schedule job ID（异步调度任务）。POST /posts/schedule 返回的 job_id 存这里。后续 polling /job_status/:job_id 解析出真正的 publer_post_id。';

COMMENT ON COLUMN content_posts.publer_post_id IS
  'Publer post ID（真实的帖子 ID）。从 job_status 解析得到。webhook（如有）或 polling /posts/:post_id 用它查最新状态。';

-- 数据迁移：旧数据里 publer_post_id 实际存的是 job_id，标记一下让 sync route 能处理
-- （sync route 已经做了向后兼容：检测到 publer_post_id 能被 getJobStatus 解析时，自动把它迁到 publer_job_id）
