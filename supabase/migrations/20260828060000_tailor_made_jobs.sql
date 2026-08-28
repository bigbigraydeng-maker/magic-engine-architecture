-- tailor_made_jobs — 异步任务表，配 CTS 27 天 China Panorama 报障后续修复。
--
-- 起因：/tailor-made/import 和 /tailor-made/extract 原来是同步等 AI 写完再回
-- 一整个 HTTP 响应；ME 后台正式域名走 Cloudflare 代理，CF 对被代理的请求有
-- 约 100 秒的等待上限，27 天团光生成就要 100-180 秒，AI 还没写完连接就被
-- CF 掐断，浏览器收到 HTML 错误页，JSON.parse 报 "Unexpected token '<'"。
-- 见 fix(tailor-made): stop silently truncating long itineraries [CTS-2027-China-Panorama]（#1212）。
--
-- 修法复用仓库里已有的「建任务 → 后台跑 → 前端轮询」套路（public_scan_jobs 同款），
-- 不新造一套：POST 只做校验 + 建任务行就立刻回，真正跑 AI 放进 fire-and-forget
-- 的后台函数（本项目部署是 next start 常驻进程，不是 serverless，响应发出去
-- 之后代码继续跑没问题），前端改成轮询这张表拿结果。
--
-- input 只存排查用的轻量元信息（文件名/来源类型等），不落原始文件内容或长文本——
-- 建任务和跑任务是同一个 Node 进程里的闭包传值，不需要另一个 worker 从表里
-- 重新捞输入，没必要把整份 base64/长文本搬进数据库占地方。

CREATE TABLE IF NOT EXISTS tailor_made_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  itinerary_id  uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('import_file', 'extract_text')),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  -- 同一份行程+同一种任务下，区分"这是不是同一次提交"——不能只按
  -- (client_id, itinerary_id, kind) 复用：两个人（或两个标签页）几乎同时对
  -- 同一份行程提交了不同的文件/文字，如果不分内容一律复用第一个任务，第二个
  -- 请求的输入会被无声丢弃，还会把第一份请求的结果错当成第二份的结果应用
  -- 到编辑器上（Codex 复审点出来的真实场景）。指纹只用来判断"是不是同一次
  -- 点击/同一份内容"，不追求密码学强度。
  input_fingerprint text NOT NULL,
  -- 排查用的轻量元信息（文件名/来源类型/消息长度等），不落原始文件内容或长文本
  input         jsonb NOT NULL,
  -- 完成后写入：{ payload, review, reply, heroName?, sourceKind?, detectedAs? }
  result        jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tailor_made_jobs_itinerary ON tailor_made_jobs (itinerary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tailor_made_jobs_client ON tailor_made_jobs (client_id);

-- 同一份行程、同一种任务、同一份输入内容，同一时间只允许一条活跃
-- （queued/running）任务——应用层的「先查后插」在两个请求几乎同时到达时
-- 挡不住竞态（子牙+魏征复审都点出来了），真正的防线在数据库这道部分唯一
-- 索引上：并发插入第二条会被这里拒掉，代码侧捕获冲突后退化为复用先建成
-- 的那条。带上 input_fingerprint 是因为「同一份行程+同一种任务」不等于
-- 「同一次提交」——两次内容不同的提交必须各自拿到自己的任务行，不能被
-- 复用逻辑悄悄合并（Codex 复审点出来的真实场景）。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tailor_made_jobs_active
  ON tailor_made_jobs (client_id, itinerary_id, kind, input_fingerprint)
  WHERE status IN ('queued', 'running');

-- ME 数据访问模型 = service-role + Bearer-token API，从不走 end-user RLS。
-- 必须带 TO service_role —— 漏掉这四个字等于对匿名访客敞开读写
-- （2026-08-03 那次 118 条策略泄露就是这个原因，见 CLAUDE.md 第7条）。
ALTER TABLE tailor_made_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON tailor_made_jobs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
