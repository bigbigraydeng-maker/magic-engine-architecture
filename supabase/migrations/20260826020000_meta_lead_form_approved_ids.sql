-- Meta Lead → Mailchimp「form-level disclosure = consent」不能对整条 Page 生效。
--
-- ── 背景（Codex review, PR #1191 round 2）──────────────────────────────────
-- src/lib/crm/meta-lead.ts 之前无条件把 `consent_basis: 'form_disclosure_attested'`
-- 写给该客户 Facebook Page 下**任意**表单来的 lead。但
-- src/lib/meta/lead-forms.ts 的 fetchPageLeadForms 明确会拉回该 Page 下**全部**
-- 表单（含已停用的），src/lib/meta/leads-sync.ts 又逐个接入 —— 只要 CTS 存在一个
-- 旧表单 / 未展示营销 disclosure 的表单，其提交者也会被当作已同意直接进
-- Mailchimp Welcome journey。这是把 CTS 单个「已批准展示 disclosure 的表单」
-- 这一客户事实，硬编码成了平台规则。
--
-- 本迁移把「哪些表单在 Submit 前展示了营销 disclosure」下沉成按客户配置的
-- approved evidence（而不是代码里默认信任整个 Page），修复方式见
-- src/lib/crm/meta-lead.ts 的 formApproved 门禁。
--
-- ── 边界 ────────────────────────────────────────────────────────────────────
-- • 默认空数组 = fail-closed：没配置就没有任何表单能拿到
--   consent_basis='form_disclosure_attested'，Mailchimp 出口对该客户全体 Meta
--   lead 都会 skipped: form_not_approved（宁可漏发，不能凭空认定同意）。
-- • 本迁移**不**为 CTS 种子任何表单 id —— 目前没有 PM/FDE 提供的、已核实的
--   「这个 formId 确实在 submit 前展示了营销 disclosure」证据，硬编一个会重复
--   这次要修的错误。哪个表单能进白名单需要 PM/FDE 在核实后另行配置。
--
-- ── 应用状态 ────────────────────────────────────────────────────────────────
-- 本文件提交但不由本任务应用到生产，按 docs/sops/ 的 apply-migration 流程
-- 授权后单独跑。

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS meta_lead_form_approved_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN clients.meta_lead_form_approved_ids IS
  'Allowlist of this client''s Meta (Facebook/Instagram) Lead Ads form ids that '
  'have been verified to show a marketing-email disclosure immediately before '
  'Submit. Only leads whose form_id is in this list may be written with '
  'contact_touchpoints.metadata.consent_basis = ''form_disclosure_attested'' and '
  'reach the Mailchimp outlet on that basis (src/lib/crm/meta-lead.ts). Empty '
  '(default) = fail-closed: no form on this client''s Page is trusted until a '
  'human explicitly adds its id here.';
