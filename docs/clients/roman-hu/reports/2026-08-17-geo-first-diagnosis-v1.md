# Roman Hu · GEO 首次诊断报告 v1

- **客户**：Roman Hu（Ray White Mission Bay，奥克兰地产中介）
- **client_id**：`e7465ac7-4f3d-4d6a-afbe-d036ab419708`
- **诊断日期**：2026-08-17
- **引擎**：WP05 GEO Module v1（`geo-module/m1/v1` 冻结语义 · PR #1032）
- **证据源**：#883 Roman GEO 基线批次 `688bd8ae-2db6-4300-b761-b850f30c32c5`
- **台账**：`client_site_pages` 21 页（#930 canonical inventory 已激活）
- **报告形式**：只读推理产出，未修改任何 GEO 证据 / 台账 / 客户页面。

---

## 核心结论（12 问，AU/NZ 英语 · en-NZ · nz market）

| 维度 | 数值 | 说明 |
|---|---|---|
| 正文合格提及 query（M1 §3） | **2 / 12** | 需正文出现 + 语义参与 + 每 query 计一次 |
| 显式正向推荐 query（M1 §4 `explicit_positive`） | **0 / 12** | v1 推荐指标只认这一档 |
| 有条件推荐（`conditional`） | 0 / 12 | 单独报，不并入正向 |
| defer（证据不足 / 判不准） | **0 / 12** | 采集身份 + 解析身份齐全，无 M1 §6 defer 触发 |
| owned citation 出现（**引用**覆盖） | 2 / 12 | 见「关键澄清」 |

### 关键澄清（必读，M1 §7 硬约束）

> **`owned citation 2/12` 是「引用覆盖」（Roman 的域名 `romanhu.com` 出现在答案引用/来源里），
> 绝不得当作「正文合格提及」或「推荐」。M1 §7 第 5/6 条明令：**
> - 「12/12 带引用」不许被重述为提及 / 推荐覆盖；
> - `owned_domain_citation` 不是 mention / recommendation / rank 的代理。
>
> 本报告的 `2/12` 提及与 `0/12` 正向推荐是**答案正文里**的判定，与引用覆盖是两回事。
> 二者不可相加、不可换算、不可混说。

---

## 病根（首页第一屏内容缺口）

对 12 个发现型问句的答案样本抽样后，AI 在正文里**始终未能同时命中** Roman 的三个身份关键信号：

1. **地产从业者**（real estate agent / realtor / realty）
2. **奥克兰 / NZ 地域**（Auckland / New Zealand / Aotearoa）
3. **服务面向**（中文华语社区 / Mission Bay & Eastern Bays / Ray White）

追根到客户站首页第一屏：H1 `Elevated Real Estate for Modern Auckland Living` 语言抽象诗意，
subtitle 无「中介 + 奥克兰 + 中文」三信号连贯陈述，AI 抓取时命中率低。
10 个发现型问句样本里，AI 一次都没把 Roman 作为**候选人**在答案正文提出。

## 处方（Prescription）

- **支柱**：AI 可见度（`ai_visibility`）
- **严重度**：**high**（可解释覆盖为 0/12，`geo-module/m1/v1` `severityOf` 直接判 high）
- **动作候选**：`{ domain: 'geo', intent: 'optimize_page_answerability' }`
- **目标页**：首页（`romanhu.com/` 或对应 CMS 路径），改动范围**只限首页第一屏 subtitle**
- **验证**（`buildQualifiedMentionVerification`，M1 v1）：
  - `metricRef`: `geo-module/m1/v1:qualified_mention_coverage`
  - 窗口：28 天
  - baseline：本次 #883 批次的 query 级合格提及覆盖
  - **success**: 同查询集版本 / 同 locale / 引擎覆盖可比前提下，合格提及覆盖相对基线上升
  - **failure**: 合格提及覆盖相对基线明确下降
  - **indeterminate**: `not_comparable`（查询集 / 解析身份 / 引擎覆盖对不上，或 locale 混池），
    或复测样本证据不足 —— 一律 indeterminate，**永不 failure**（M1 §6.2）

### 处方明确「刻意不做」（v1 冻结）

- 不基于未判定证据推断任何别名 / 队名 / 姓氏单称 / 域名 / 雇主关联（M1 §1，`brand_aliases` 为空）
- 不把「答案带引用」重述成 Roman 被提及或被推荐（M1 §7）
- 不复测、不改动 #883 观测 / 证据 / 引用 / 解析身份（M1 §6）
- 不在本模块内映射候选身份到 ActionKey、不授权、不进执行队列（WP00 §5.4 / K-WP02）

## 当前状态（v1 诚实 defer）

WP05 引擎跑到 `ActionCandidate` 已产出，但下一步的 `PageOptimizationRequest`
**当前诚实 `defer=unattributable_proposed_value`**：v1 只推理，不生成页面文案，
`proposedValue` 必须上游 grounding 后传入。已在协调会话里给出人工 grounding 的
subtitle 版本（en/zh 各两行），拟由后续 PR 落到 `src/i18n/ui.ts` 后再触发 WP06/WP07。

## 下一步（依 WP 顺序）

1. **grounding 落地**（`src/i18n/ui.ts` 首页 subtitle 两行 en+zh）→ WP06 draft/diff
2. **WP07** 授权 apply（Kernel 授权 + `action_run`）—— **当前卡 `cms_connections = 0`**（Roman 站的 CMS 连接未建立）
3. **WP10** 归因回流，读复测批次判 success / failure / indeterminate
4. **follow-up**（不阻塞本次收官）
   - **#1023** WP05 待办
   - **#1030** WP05 待办
   - **#1040** 聚合分组键需按引擎/模型/查询集版本隔离（Codex #1032 第 4 轮 P1-c，未触发但结构上带洞）；已并入本轮两审的 severity 分母独立锁 + finding statement 表述错位两条 follow-up

## 引擎与合规状态

- **引擎**：`geo-module/m1/v1`（PR #1032）— 92 单测全绿、`npm run build` ✓、`growth/geo/page-optimization` 基线 222 无回归
- **A 级验证**：证据五段链单测 + 端到端 + 变异证据（M1 各判据、句子级绑定、聚合护栏、租户隔离）
- **三审**：子牙（架构）/ 魏征（挑刺）/ 狄仁杰（隔离）四轮复审闭合
- **数据边界**：只读 Roman 生产库（`geo_observations` / `geo_evidence` / `geo_queries` / `client_site_pages`），零写、未回写 #883、未 apply migration
