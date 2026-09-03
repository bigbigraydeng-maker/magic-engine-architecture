-- outbound_prospects: add discovery_report + discovery_report_status (P35.14)
--
-- Full 张骞 Discovery scan (~$0.57/prospect, DiscoveryReport shape) for a small
-- reviewed pilot batch of prospects already in the outreach queue — most rows
-- keep only the existing cheap `ai_report` (ProspectAnalysis, ~$0.15) and these
-- two new columns stay null.
--
-- discovery_report_status exists SEPARATELY from discovery_report being null
-- because null alone can't distinguish "never triggered" from "triggered but
-- failed/truncated" (子牙 P35.14 design review) — the report-page/report.ts
-- consumer only trusts a row when status = 'completed' AND
-- discovery_report.meta.truncated is false; a truncated or failed run is
-- discarded as a whole (no field-level salvage), never surfaced to a prospect.
--
-- No RLS change needed: this table's existing service-role policy is
-- `FOR ALL TO service_role USING (true)` at the table level, which already
-- covers new columns.

alter table outbound_prospects add column if not exists discovery_report jsonb;
alter table outbound_prospects add column if not exists discovery_report_status text
  check (discovery_report_status in ('not_run', 'running', 'completed', 'truncated', 'failed'));

comment on column outbound_prospects.discovery_report is
  '张骞完整版 Discovery 报告(DiscoveryReport,含 schema_version)。仅小范围试点填充,
   大多数行为 null — 见 docs/specs/2026-08-24-report-page-discovery-upgrade-design.md';
comment on column outbound_prospects.discovery_report_status is
  '区分"从没跑过"(null)和"跑了但失败/半成品"(failed/truncated)——不能只看
   discovery_report 是否为 null。只有 completed 且 meta.truncated=false 才可信。';
