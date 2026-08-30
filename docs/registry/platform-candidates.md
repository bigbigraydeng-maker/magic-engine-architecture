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
| Current-Sponsored Competitor Discovery（当前活跃广告主实时发现 + diff 竞品清单）| L1 Capability | 竞品 支柱（主）+ 广告 支柱（次·只发现不投放）· IMPACT Inspect 段 | CTS Tours NZ | Outbound Tourism (China 线) | **3/3 客户复制已达标** —— P30 seed 已在 CTS + 22 家 tourism domains 事实复制；PM 列出 9 客户跨 6 行业需要（旅游 / 地产 / 电商 / 地板 / 留学 / 瓶装水）| candidate | 2026-08-28 | 2026-09-28 | 主 session（CTS 竞品扫描） | PM 2026-08-28 quote "但是我觉得这个也是一个 capability"；张良 v2.1 Full Report 判定 L1；配套 L3 新增 Google Ads Transparency Center Adapter；相关 issue: `me2.0-punch-list`（待建）；DataForSEO SERP L3 已存在（`src/lib/dataforseo/serp.ts`）；跨 AU / NZ 市场语义一致；hardcoded 客户名 / 行业 = ✗（走 `clients.primary_keywords` + `industry`）|
| 创作者专属 collection + 独立 UTM（每个合作创作者一个可归因落地页） | L2 Playbook | 社媒 支柱（主）+ 归因（次·复用既有 attribution 能力，不新增能力线） | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 Aelfric Eden 外部观察，未在任何 ME 客户落地） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自 `docs/strategy/2026-08-30-aelfric-eden-ecommerce-teardown.md` §7.1；Jing's Pick 落地前须先跑带基线/成本/Outcome 判据的小范围实验（见该文档 §8），不得直接批量执行 |
| 内容排产输入从"想主题"改成"读客户 products.json 上新 feed" | L2 Playbook | 社媒 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 Aelfric Eden 外部观察） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.2；候选方向：ME 已有内容工厂加一个上新监听 |
| 促销走购物车层折扣叠加、不批量改 `compare_at_price` | L2 Playbook | 广告 支柱（主）+ 口碑 支柱（次） | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（因果机制本身未验证，见文档 §5） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.3；需先在本店核实促销实现机制，再在其他店验证 |
| 电商 SEO 检测方向：aggregateRating 空评分 / hreflang 适用性判断 / sitemap 内部垃圾过滤 | L2 Playbook | SEO 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 7/969 商品页抽样，见文档 §6.1/§6.2 订正） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.4；开 issue 落地前须先扩大抽样、按订正范围收窄适用条件 |
| AI agent 能否直接购买（Shopify UCP / agents.md 是否平台默认开放）作为 AI 可见度测量口径候选维度 | L2 Playbook | AI 可见度 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅本店观察，未核实是否为 Shopify 2026 平台默认能力） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.5；需查 Shopify 官方文档或再扫多家兼容店铺才能定论 |
| 跨源交叉验证与对照实验设计（用独立数据源互证结论 · 用对照组排除替代解释） | L1 Capability | 平台基础设施：Verification 机制（不属 6 支柱任一柱） | ME 自主研究（**非客户提出**，无付费客户需求背书） | 跨行业（旅游 to C + 会奖 to B 两次） | **0/2 付费客户提出**；ME 自用 2/2 次复制（澳洲赴华市场扫描 · MICE 入华市场扫描，均 2026-08-30） | candidate | 2026-08-30 | 2026-09-30 | docs/register-crossval-candidate | 登记前已做现状盘点。**判据库范式不需新建**：`src/lib/geo-measurement/` 已把「未知三分法」（`GeoUnknownReason`：not_recorded_by_source / not_applicable / source_ambiguous）、可比性判定与 5 个 validator 冻结成机器判定；`market-intel/grounding.ts` 已实现摘要事实核对（抽实体+数字回原文比对）。**真正缺的只有两件**：① 跨源交叉验证（本次用搜索量排序 × 广交会官方国别排序互证）② 对照实验设计（本次 A/B/C 三组，排除「查错词」与「中国特别差」两种替代解释）。⚠️ 本次探针阶段用临时脚本重复调了 DataForSEO 与 AI 可见度，而 `src/lib/dataforseo/search-volume.ts`、`src/lib/geo-baseline/provider.ts`、`src/lib/industry-ai-visibility/collector.ts` 均已存在——产品化时必须复用，不得另起 |
| AI 单页站生成器（事实采集 → AI 文案 → 模板渲染 → 静态发布） | L1 Capability（候选 · 需硬证据）| 平台基础设施：Provisioning & Activation（不属 6 支柱任一柱 · IMPACT 前置地基）| ME 自主产品线（**非客户提出**，来自 2026-08-31 会员制度 v1.1 定价决策） | 跨行业（AU/NZ 中小生意通用）| **0/2 付费客户提出**；0/3 客户事实复制（尚未实现） | candidate | 2026-08-31 | 2026-09-30 | musing-mendeleev-e892ba worktree | 来自 ME 会员制度 v1.1：免费档 = 永久免费二级域名站，$39 档 = 换自有域名+可被搜到+公司邮箱+去角标。Issue #1273（生成器 · B 级）· #1274（免费档 · A 级）· #1275（$39 订阅 · A 级）· #1276（扫街预建站 · A 级），四张均为 SPEC DRAFT 未授权实施。**Build vs Buy 已评估**：per-site 计费的白牌建站平台（Duda $17 USD/站/月 · Lindo ~$9 USD/站/月）在 $39 NZD 档毛利勉强，但在扫街预建站场景（为尚未付费的商家批量预建数百站）成本直接爆炸，故渲染/发布/托管判定 Build；**视觉模板判定 Buy**（买 premium HTML 模板授权，不手拼视觉排版，与 Shopify 主题教训一致）；域名+邮箱 Buy（#1269 OpenSRS）。⚠️ 实现前必须复用既有封装：Site Analyzer / `src/lib/dataforseo/` / `src/lib/gbp/` / `src/lib/ai/` / `src/lib/mtc/budget-guard.ts`，不得另起直调 |

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
- 2026-08-30 · 登记「跨源交叉验证与对照实验设计」候选。**登记前先做了现状盘点**：ME 已有判据库范式（geo-measurement 契约）、事实核对（market-intel/grounding.ts）与全部数据抓取封装（dataforseo / geo-baseline / industry-ai-visibility），候选范围据此从最初设想的「市场情报报告能力」收窄为仅缺的分析两件事。证据为 ME 自用复制，**非付费客户提出**，晋升判据尚未起算。
- 2026-08-31 · 登记「AI 单页站生成器」候选。来自 ME 会员制度 v1.1（免费 / 39 / 199 / 499 / 定制）的第一块砖。**登记前先做了现状盘点**：`src/lib/website-publish/` 只是 blog 推送状态机、`src/lib/site-audit/` 是反爬检测，仓库内确无站点生成器。证据为 ME 自主产品线需要，**非付费客户提出**，晋升判据尚未起算。
