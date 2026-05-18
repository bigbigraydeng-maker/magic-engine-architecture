-- 内容飞轮闭环 — 执行项 ↔ 内容帖子双向关联
--
-- 让 FDE 在执行看板的某个执行项（社媒/SEO 内容类）能直接看到关联的
-- content_post + visual_assets，并且帖子 published 后自动回写执行项
-- status = completed。

-- 1) execution_items 加 content_post_id 外键
ALTER TABLE execution_items
  ADD COLUMN IF NOT EXISTS content_post_id uuid
    REFERENCES content_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS execution_items_content_post_id_idx
  ON execution_items (content_post_id)
  WHERE content_post_id IS NOT NULL;

COMMENT ON COLUMN execution_items.content_post_id IS
  '关联的内容帖子。社媒/SEO 内容类执行项的产出物。post published 后由 trigger 自动 mark 执行项 completed。';

-- 2) content_posts 反向加 execution_item_id（一对一关系：一个帖子最多关联一个执行项）
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS execution_item_id uuid
    REFERENCES execution_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_posts_execution_item_id_idx
  ON content_posts (execution_item_id)
  WHERE execution_item_id IS NOT NULL;

COMMENT ON COLUMN content_posts.execution_item_id IS
  '反向链接：这篇内容是为哪个处方执行项生成的。published 时自动通过 trigger 回写执行项状态。';

-- 3) Trigger: content_post.status = 'published' 时自动 mark 关联的 execution_item completed
CREATE OR REPLACE FUNCTION sync_execution_item_on_post_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 只在 status 真的变成 published 时触发
  IF NEW.status = 'published' AND COALESCE(OLD.status, '') <> 'published' THEN
    -- 如果有关联的 execution_item 且当前不是 completed，则 mark completed
    IF NEW.execution_item_id IS NOT NULL THEN
      UPDATE execution_items
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
      WHERE id = NEW.execution_item_id
        AND status <> 'completed';

      -- 同时记一条 execution_log（如果表存在）
      INSERT INTO execution_logs (execution_item_id, author, kind, content)
      SELECT NEW.execution_item_id, 'system', 'status_change',
             '内容已发布 (post=' || NEW.id || ' → ' || COALESCE(NEW.title, '无标题') || ')，自动 mark completed'
      WHERE EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'execution_logs'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_execution_item_on_post_published ON content_posts;
CREATE TRIGGER trg_sync_execution_item_on_post_published
  AFTER UPDATE OF status ON content_posts
  FOR EACH ROW
  EXECUTE FUNCTION sync_execution_item_on_post_published();

COMMENT ON FUNCTION sync_execution_item_on_post_published IS
  '内容飞轮闭环：content_post.status 变为 published 时，自动 mark 关联 execution_item 为 completed，并写入 system 日志。';
