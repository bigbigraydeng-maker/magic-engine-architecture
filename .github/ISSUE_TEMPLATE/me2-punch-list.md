---
name: ME 2.0 Punch List Item
about: 平台层级候选项 — 由张良（me-platform-tier-gate skill）判定后自动/半自动生成
title: '[me2.0-punch-list] '
labels: me2.0-punch-list, platform-candidate
assignees: bigbigraydeng-maker
---

<!--
本 template 由 me-platform-tier-gate skill v2.2 附带 · GitHub Issue 自动生成规则详见:
.claude/skills/me-platform-tier-gate/SKILL.md

用途:
- 张良（平台层级门 skill）Full Report 判定为 L1 / L2 候选时, agent 会填好这份 template
- PM 一句 "开 issue" 后 agent 用 `gh issue create` 创建
- 之后按 label / milestone 组织 ME 2.0 打磨 sprint
- issue 关闭时同步更新 docs/registry/platform-candidates.md 状态

label 说明:
- me2.0-punch-list  = 属于 ME 2.0 打磨清单 (基础必贴)
- platform-candidate = 是"平台候选"性质而非普通任务 (基础必贴)
- l1-candidate | l2-candidate = 建议层级
- skill-form | agent-form | hybrid-form = 建议实现形态 (v2.2 新增维度)
- 归属支柱: seo | geo | social | paid-ads | word-of-mouth | competitor | infrastructure
-->

## 候选信息

- **建议层级**: <!-- L1 Capability / L2 Playbook -->
- **建议实现形态**: <!-- Skill / Agent / Hybrid -->
- **归属**: <!-- 6 支柱哪一柱 or 平台基础设施 (kernel/measurement/attribution/memory/verification) -->
- **来源客户**: <!-- HBay / CTS / Roman / ... -->
- **来源行业**: <!-- 瓶装水/FMCG · 旅游 · 地产 · 电商 · ... -->
- **首次登记日**: <!-- YYYY-MM-DD -->
- **首次复查日**: <!-- +30 天 -->

## 判定过程

<!-- 从张良 Full Report 摘要过来的关键判据 · 3-8 行 -->

## 硬证据进度

<!-- L1 晋升条件: >=2 已付费客户跨行业提出同一需求, 或 >=3 客户处出现事实复制 -->
<!-- L2 晋升条件: 同行业 >=2 客户出现事实复制 -->

- [ ] 客户 1（____ 行业）: 已提出 / 尚未
- [ ] 客户 2（____ 行业）: 已提出 / 尚未
- [ ] 客户 3（____ 行业）: 已提出 / 尚未
- [ ] 或跨客户事实复制观察到的次数: __/3

## 换客户 & 换行业测试

- **换客户测试** (语义级 · 不接受"clientId 是参数"): <!-- ✓/✗ + 具体推演 -->
- **换行业测试** (语义级): <!-- ✓/✗ + 具体推演 -->

## 红线检查（复述张良判定）

- [ ] 红线 1 · 禁包装升级
- [ ] 红线 2 · 禁客户/行业事实进 shared runtime
- [ ] 红线 3 · 禁直建 L1 · 已按候选路径登记
- [ ] 红线 4 · 换客户测试语义级
- [ ] 红线 5 · 换行业测试语义级
- [ ] 红线 6 · 若晋升 L1 将走五道 Build Gate
- [ ] 红线 7 · L2 只装行业级 / 版本级

## PM 拍板项（如涉及）

<!-- 商业模式 · 新增支柱 · 新版本 · 定价 · 这些 skill 不决策, 抛 PM -->

## 关联

- 登记表: [docs/registry/platform-candidates.md](https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md)
- 张良 skill: [.claude/skills/me-platform-tier-gate/SKILL.md](https://github.com/bigbigraydeng-maker/magic-engine/blob/main/.claude/skills/me-platform-tier-gate/SKILL.md)
- 触发本判定的会话 / PR: <!-- 链接或摘要 -->
- 相关 PR (实现落地): <!-- 关闭 issue 前必填 -->

## 关闭 / 晋升 checklist

关闭 issue 时必做:

- [ ] 更新 `docs/registry/platform-candidates.md` 该行的"当前状态" (candidate → promoted / abandoned)
- [ ] 更新 `src/lib/pm-todo/platform-candidate-reviews.ts` 的 reviewDate (推到下次复查) 或删除该条 (若已 promoted / abandoned)
- [ ] 若 promoted → 记录 promoted 到哪个能力 / playbook / skill / agent
- [ ] 若 abandoned → 记录原因
