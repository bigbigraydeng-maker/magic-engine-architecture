# ME 平台候选清单（L1 / L2 Candidates）

> **载体地位**：本文件是 [me-platform-tier-gate](../../.claude/skills/me-platform-tier-gate/SKILL.md) 强制候选登记的**唯一权威载体**。skill 判定为"L1 / L2 候选但证据不足"时，必须登记进本表，不许"下发到日志里"。
>
> **为什么在 git 而不是数据库**：v1 起步阶段，跨 worktree 走 git 同步足够；管道存在性优先于最终形态。晋升到 Supabase 表见本文件末尾"演化路径"。

---

## 为什么存在

`me-platform-tier-gate` 的核心机制之一是**默认降级 + 硬证据晋升**：单客户提出的 **Capability / Playbook 语义**需求默认落 L4/L2 实现，同时登记为"L1 候选"—— 凑齐硬证据后自动触发晋升提案，走 2 审进 Build Gate。

> **本表只约束 Capability / Playbook 语义，不适用于 L3 Connector**：符合 L3 判据（provider-specific adapter 挂在既有 Capability 下、不同客户可用不同 Connector 组合）的单客户需求，本就是 L3 的常态用法，**不需要**先落 L4/L2 再登记候选，也不占用"L1 候选"名额——判定为 L3 就直接按 Connector 走，不进本表。详见 [SKILL.md](../../.claude/skills/me-platform-tier-gate/SKILL.md) 红线 3。

这套机制的前提是**候选清单必须真的存在**。没有实体载体 = 候选永远不会被复查 = 相同逻辑在多个客户 config 里各复制一份 = 平行系统蔓延（正是平台化原则禁止的）。

---

## 硬证据晋升判据（复述自 skill 红线 3）

- **L1 晋升**：≥2 个**已付费**客户分属**不同行业**提出同一需求，或某 L2/L4 实现已在 **≥3 客户处出现事实复制**
- **L2 晋升**：同一行业内 ≥2 个客户出现事实复制（跨行业不适用）
- 达标后自动触发晋升提案 → 强制走 2 审（子牙 + 魏征）→ 进五道 Build Gate

---

## 复查节奏

- **月度提醒已接入自动待办，不靠人记日期**：每条候选的"复查日"必须同时登记进 [`src/lib/pm-todo/platform-candidate-reviews.ts`](../../src/lib/pm-todo/platform-candidate-reviews.ts)。复查日一到，既有的 `pm-daily-todo` cron（render.yaml 已排班，NZ 工作日早晨自动跑）会把这条候选生成一条"需要你动手"待办发给 PM/FDE——**登记候选却漏写这个文件 = 复查永远不会被提醒**，跟只写日历一样会断头
- 复查当天由当值 FDE 主持跨客户配置相似度扫描，把新增证据填进表；复查完成后同步把该候选在 `platform-candidate-reviews.ts` 里的 `reviewDate` 推到下一次复查日，否则待办第二天会重复出现
- **季度**：PM 审阅本表，决定哪些候选可推进晋升、哪些应放弃
- **随时**：任何 agent / worktree 发现新证据，直接追加进对应候选的"硬证据进度"列（不需要等复查日）

---

## Schema（表头列定义）

| 列名 | 含义 |
|---|---|
| 候选名 | 一句话描述这个候选能力是什么 |
| 建议层级 | L1 Capability / L2 Playbook |
| 归属 | ME 6 支柱哪一柱 / 平台基础设施 / 待定 |
| 来源客户 | 首次提出的客户 |
| 来源行业 | 首次出现的行业 |
| 硬证据进度 | 已凑齐几个不同行业/客户的证据（如 `1/2 行业`、`1/3 客户复制`）|
| 当前状态 | `candidate` / `promotion_proposed` / `promoted` / `abandoned` |
| 首次登记日 | YYYY-MM-DD |
| 复查日 | YYYY-MM-DD（下次复查时间）|
| 登记人 | 哪个 worktree / agent / PM 登的 |
| 备注 | 关键上下文（PR 链接、事故链接、判据讨论链接）|

---

## 候选清单

<!--
表格保持 markdown 格式，方便 grep 与 diff。
第一行示例已注释。
-->

| 候选名 | 建议层级 | 归属 | 来源客户 | 来源行业 | 硬证据进度 | 当前状态 | 首次登记日 | 复查日 | 登记人 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| 借助 Claude Design 生成品牌 VI 视觉资产（logo · 品牌手册 · 视觉规范）| L1 Capability（候选 · 需硬证据）| 待定 · VI 不在 6 支柱 · **PM 拍板项** | HBay Water | 瓶装水 / FMCG | 1/2 行业（仅 HBay）| candidate | 2026-08-27 | 2026-09-27 | happy-cori-796b21 worktree | HBay Deploy 档扩展；PM 明确 ME 借助 Claude Design 做；未来 CTS / Roman / 其他客户若也用同类能力则可升 L1；Low bar 登记（skill v2 首例）|
| 品牌 VI 强制执行（brand tokens 中央注入所有客户交付物 · logo / 色 / 字体 / 风格）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Verification/Output 层 | CTS Tours NZ | 旅游 | 1/2 客户（HBay VI 生成完 但落地时也需同一执行层）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 事故驱动登记：2026-08-28 CTS catalogue 生成时 agent 忘了用客户 logo，暴露"每次客户交付物都要重新想起去查 master_briefs"是治理漏洞。跟"HBay VI 生成"候选互补：一个产 VI 包，另一个在下游渲染管道里强制读取并应用。Low bar |
| Lead 温度打分（多因子：邮件打开频次+最近打开衰减+注册新旧+备注文字里的时间意向 → Hot/Warm/Cold）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Attribution/Flywheel 类 · CRM 模块前置 | CTS Tours NZ | 旅游 | 1/2 客户（仅 CTS，先做 Excel 过渡版）| candidate | 2026-09-02 | 2026-09-09 | customer-zero-page-readiness-cb2afb worktree | PM 明确"今后做到 ME CRM 系统里"；@张良 判定：底层多因子衰减打分框架跨行业通用，但具体因子语义（旅游"出行时间" vs 地产"挂牌时间" vs 建材"开工时间"）行业绑定，属 L2 Playbook 范畴，禁止硬编码进 shared runtime（红线2）。今天先落 CTS Excel 手工版（AG/AH 列，一次性批跑不挂常驻cron），7天后(2026-09-09) check&tune 阈值。等第二个客户提出同类需求再走硬证据晋升。Low bar |
| 客户官网结构化素材抓取（sitemap → 产品页 → 图片 → 品牌片段）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Discovery/Read 层 | CTS Tours NZ | 旅游 | 1/2 行业（CTS 单例）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 2026-08-28 为 CTS 起 catalogue 时手动跑过一次：sitemap → 4 团页 + 5 城 guide + visa guide + blog + 5 张官方 supabase 图。跨行业本就通用（地产 / 电商 / 建材客户都要），只是每次现拼；Low bar 登记等 ≥2 行业事实复制 |
| HTML → PDF 多页排版渲染（A4/A3 print / 品牌一致的多章节 brochure）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Output 层 | CTS Tours NZ | 旅游 | 1/2 客户 | candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 2026-08-28 CTS catalogue v1 用手写 CSS 完成，可 @page A4 → Save as PDF。行业无关：地产楼盘手册 / 建材 spec sheet / 电商 lookbook 都需要。Low bar |
| ME 旅游版 Catalogue Chapter Playbook（旅游行业 catalogue 的 chapter 结构 / 素材抓取通道 / 版式规则）| L2 Playbook / Industry Version（候选）| ME 旅游版 · **PM 拍板 ME 旅游版是否立版** | CTS Tours NZ | 旅游 | 1/2 客户（仅 CTS）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | PM 2026-08-28 定性："这种 PDF 的定期生成是一个 ME 旅游版很好的技能"。前置：ME 旅游版是否正式进 `docs/registry/product-versions.md`（PM 拍板项）。旅游 catalogue 的默认 chapter：Cover / Trust / Why now (visa/season) / Cities / Tours / Comparison / Culture Tips / Booking / Back cover。Low bar |

<!--
示例（不作为真实条目）：
| 跨客户舆情监控引擎 | L1 Capability | AI 可见度 + 竞品 支柱 | CTS | 旅游 | 1/2 行业（仅 CTS） | candidate | 2026-08-27 | 2026-09-27 | happy-cori-796b21 worktree | 来自 HBay 诊断报告能力线 04 |
-->

*（第一条候选：HBay VI 视觉资产生成。Low bar 登记 · 待复查日 2026-09-27 由 L1 owner 评估晋升成熟度。）*

---

## 演化路径

**v1**（现在）：`docs/registry/platform-candidates.md` + `src/lib/pm-todo/platform-candidate-reviews.ts` 驱动的复查到期提醒
- 优点：起步成本零、跨 worktree 走 git 同步、可 grep、可 diff、复查节奏接了既有 pm-daily-todo cron 不靠人记
- 局限：无 schema 约束、无查询能力、**跨客户配置相似度扫描本身仍是人工**（自动化的只是"提醒该扫了"，不是扫描动作本身）

**v2**（未来触发条件：本表条目 ≥10 或跨客户相似度扫描本身自动化时）：Supabase 表 `platform_capability_candidates`
- 走 A 级 migration（治理层，冻结 head + service_role RLS）
- 自动扫描 job：跨客户 config 相似度检测 → 自动追加证据 → 达标自动开晋升 issue

演化时机由 PM 拍板，不由 skill 或 agent 自决。

---

## 历史

- 2026-08-27 · 建仓，为落地 [me-platform-tier-gate](../../.claude/skills/me-platform-tier-gate/SKILL.md) 的候选管道。子牙架构复审的必改问题 2。
- 2026-08-27 · 补两处：明确本表不约束 L3 Connector；月度复查接入 `pm-daily-todo` 自动待办（`src/lib/pm-todo/platform-candidate-reviews.ts`），不再只靠"当值 FDE 记日历"。Codex 复审必改。
