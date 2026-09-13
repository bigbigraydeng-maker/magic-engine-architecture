-- CTS Meta Lead → Mailchimp 欢迎邮件断链修复 —— 配置 + 观测最小两列。
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- Meta lead 表单填过来的人已经进了 contacts + contact_touchpoints（管道见
-- src/app/api/cron/meta-leads-sync）。缺的是：这个人有没有被同步进 Mailchimp
-- 的 audience —— 因为「订阅 audience」这个动作是 Mailchimp Welcome Journey 的
-- 触发条件，之前一直手动做，2026-07 之后中断。
--
-- 本迁移不建新表、不建新日志、不加索引，只补两处最小契约字段：
--   1. clients.mailchimp_audience_id ── 每客户配置一个 audience（CTS = dda97b7e61）
--   2. contacts.mailchimp_synced_at   ── 观测：「这个人是不是已经进了 audience」
--
-- ── 边界（别让下一个来的人误解）────────────────────────────────────────────
-- • mailchimp_synced_at 语义 = 「audience 会员同步成功」或「Mailchimp 明确回
--   Member Exists、我们已安全确认存在」；**不是** Welcome 邮件已经发出去的证据。
--   Welcome 是否投递必须在 Mailchimp 后台激活 journey + Ray 用一个从未订阅过的
--   测试邮箱亲测确认，本列不承担这个语义。
-- • 本迁移只加两列 + 种子 CTS 一行；意图上：Consent 语句是否覆盖 marketing
--   email 属于 Ray 外部闸门（见 Issue #1188 Ray external gates），代码层的
--   consent 判定读 Meta lead 表单里的「同意」字段，不依赖新增数据库列。
--
-- ── 应用状态 ────────────────────────────────────────────────────────────────
-- 本文件提交但**不由本任务应用到生产**（Issue #1188 STOP 收据要求
-- migration_applied = false）。合并/授权后按 docs/sops/ 里的 apply-migration
-- 流程在 Supabase 上单独跑。

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS mailchimp_audience_id text;

COMMENT ON COLUMN clients.mailchimp_audience_id IS
  'Mailchimp audience (list) id used by the Meta lead → Mailchimp outlet. '
  'NULL disables the outlet for this client (zero provider calls). Datacenter '
  'is derived from MAILCHIMP_API_KEY suffix; no separate region column.';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS mailchimp_synced_at timestamptz;

COMMENT ON COLUMN contacts.mailchimp_synced_at IS
  'Wall-clock time we last confirmed this contact exists inside the client''s '
  'Mailchimp audience (POST subscribed = 200/201, or Mailchimp returned the '
  'exact Member Exists response). NOT proof the Welcome email was delivered — '
  'delivery is validated separately in the Mailchimp UI + Ray inbox test.';

-- CTS Tours NZ 种子。Audience id 由 Ray 供给（Issue #1188 live facts）。
-- Idempotent：本任务重跑不覆盖非 NULL 的既有值（防止 Ray 事后改配置被回退）。
UPDATE clients
   SET mailchimp_audience_id = 'dda97b7e61'
 WHERE id = 'c0000000-0000-0000-0000-000000000000'
   AND (mailchimp_audience_id IS NULL OR mailchimp_audience_id = '');
