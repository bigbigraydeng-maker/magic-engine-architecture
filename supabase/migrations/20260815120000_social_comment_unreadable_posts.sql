-- 评论自动回复 —— 记住「读不了的帖子」，别每半小时再问一次 Meta。
--
-- 背景（2026-08-15 生产日志）：CTS 每轮扫 149 个帖子，其中一批固定回 400
-- （#10 缺评论读取权限 / #100 帖子不存在 / #12 老式 status 端点已下线），
-- 而 cron 仍记成成功。每小时两轮，同样的失败刷了一整天。
--
-- 存量数据一条不动：纯加列，带默认值，旧代码读不到它也照常跑。
-- 形状（jsonb 数组，每个元素）：
--   { post_id, reason, code, message, first_seen, last_seen, retry_after }
--   reason: 'permission_denied' | 'object_gone' | 'deprecated_object'
--   retry_after 之前不再调用 Meta；缺权限压 1 天（人补上后自己恢复），
--   帖子没了 / 端点下线压 365 天。
--
-- 不建新表：这批数据只服务这一个功能，一个客户一行，随配置一起读写。

ALTER TABLE public.social_comment_config
  ADD COLUMN IF NOT EXISTS unreadable_post_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.social_comment_config.unreadable_post_ids IS
  '评论读不了的帖子名单（含原因与重试时间），由 social-comment-autoreply cron 维护。';
