# CTS Tours NZ — ai-tracker (系统 B) 退役前归档

- **日期**：2026-08-19
- **客户**：CTS Tours NZ（client_id `c0000000-0000-0000-0000-000000000000`）
- **背景**：ai-tracker（系统 B）判死刑退役，三张表 `ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots` 将在 PO `go apply` 后 DROP。本目录是 DROP 前的只读留档，**归档是 DROP 的硬前置**（见 `docs/specs/2026-08-19-ai-tracker-decommission-v1.md` §9.3）。
- **导出方式**：只读脚本 `scripts/archive/export-ai-tracker-cts.mjs`（PostgREST SELECT，从不写库）。可重跑。

## 文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `ai_visibility_queries.json` | 102 | 司马徽/张骞发现的高信号跟踪问题。**可直接当 M1 living query set（P31.X.4）的种子**。 |
| `ai_visibility_runs.json.gz` | 3011 | **各引擎逐条原始回答 `raw_response`（不可再生的历史对照语料）**——真正无法重建的部分在这里，不在 snapshots。gzip 压缩（10MB→2.5MB），`gunzip -k ai_visibility_runs.json.gz` 还原。 |
| `ai_visibility_snapshots.json` | 8 | 8 周周度聚合（avg_rank / mentions_count / ranking_table），**不含** raw_response。 |
| `manifest.json` | — | 导出时间 / 行数 / 字节数清单。 |

> 注：spec §9.3 原文写「snapshots 含 raw_response」，实测 `raw_response` 在 `ai_visibility_runs`，snapshots 只是周度聚合。三张表全导，无遗漏。
