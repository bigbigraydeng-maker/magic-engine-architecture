# ai-tracker 退役拆除清单 v1（规划稿，零删除）

- **日期**：2026-08-19
- **状态**：规划稿。**本文档不删任何代码、不 DROP 任何表、不改任何 cron、不动生产。** 真正的删除是复审干净 + PO 最后 `go` 之后的独立 PR。
- **授权**：PO 2026-08-19 拍板做减法（删老功能）。ME 尚未对外推广、无付费存量在被动消费这条线，故**无需为存量保护而保留**——但仍要走「先断消费 → 再删代码 → 最后 DROP 表」的安全顺序，禁止一刀切。
- **风险级别**：**A 级**（触碰已上线功能 + 客户可见交付物 + 不可逆 DROP 表）。禁止打包一次性授权，**每一步单独要 PO `go`**。
- **配套文档**：判决见 `docs/DECISIONS.md` 2026-08-19 条目（PR #1072）；执行跟踪见 issue #1073。

---

## 1. 判决回顾（PO 已定，本文档只落成计划）

1. **M1（`src/lib/geo-module` + `src/lib/geo-baseline`）是客户 AI 可见度唯一真相源**，神圣不可碰，只能往它靠。
2. **ai-tracker（系统 B）判死刑，删除**：`src/lib/ai-tracker/` + `src/app/api/ai-tracker/*` + `src/app/dashboard/ai-visibility/*` + `ai-tracker-weekly` cron + 三张表 `ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots`。
3. **老诊断打分（`src/lib/diagnostic`）的 AI 可见度维度：重做，取自 M1**（ROADMAP P31.X.4）。本轮不重做打分，只标清依赖 + 断了怎么办。
4. **industry-ai-visibility（系统 C）不删**，但**切断它冒充客户级分数**（Goals 的 `ai_visibility_score` 现在错读它）。

> **对判决 2 的一处重要修正**（见 §7）：`src/lib/ai-tracker/` **不能整目录 `rm`**。目录里有 4 个文件是**被系统 C（要保留）和诊断/拓客（活的）共用的基础设施**，照字面删会打断要保留的东西。

---

## 2. 三系统对照 + 术语消歧（审计的头号陷阱）

| | 系统 A（M1，真相源） | 系统 B（ai-tracker，删） | 系统 C（industry，留） |
|---|---|---|---|
| 代码 | `src/lib/geo-baseline/` + `src/lib/geo-module/` | `src/lib/ai-tracker/` | `src/lib/industry-ai-visibility/` |
| 表 | `geo_query_sets` / `geo_queries` / `geo_batches` / `geo_observations` / `geo_evidence` | `ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots` | `industry_ai_visibility_questions` / `industry_ai_visibility_runs` / `industry_ai_visibility_snapshots` |
| 服务对象 | 客户级，正式治理 | 客户级（要退役） | 行业级基准（不分客户） |
| 生产数据 | 只有 Roman（batch `688bd8ae`，STATE.md） | CTS 有 102 条 queries + 8 周 snapshots | 按行业跑，日更 |
| cron | 无独立 cron | `ai-tracker-weekly`（周一 01:00 UTC，`render.yaml:204`） | `industry-ai-visibility-daily`（日 02:30 UTC，route 名历史遗留为 `/api/cron/ai-visibility-weekly`） |

**消歧铁律**：`ai_visibility_snapshots`（系统 B）是 `industry_ai_visibility_snapshots`（系统 C）的**子串**。审计任何一个匹配都必须看全 token——否则会把系统 C 的东西误当系统 B 删掉。本清单每条都已核实全 token，并标注 `[B]` / `[C]`。审计中 4 个文件正是这样被误报为「B 依赖」、实际是系统 C（见 §5 组 J 假阳清单）。

---

## 3. 拆除清单总览（按定性分组）

三种定性：
- **DELETE**：纯 ai-tracker 附属，随系统 B 一起删。
- **REWIRE→M1**：功能保留、数据源改到 M1。**注意 M1 目前只有 Roman 有数据**，重接后其他客户会空——每条给出优雅降级方案。
- **LEAVE / SEVER**：留着，但断开错误依赖 / 停止写向将被删的表。

| # | 目标 | 定性 | 工时 |
|---|---|---|---|
| A | ai-tracker 自有 lib（orchestrator/question-generator/engine-display-names/runners{gemini,perplexity}） | DELETE | S |
| B | **共享基础设施**（parser.ts / runners{openai,claude,types}） | **RELOCATE→中立目录 后 DELETE**（或 LEAVE） | M |
| C | ai-tracker API 路由（7 个 route.ts + 3 个 test） | DELETE | S |
| D | dashboard/ai-visibility 页面（6 文件）+ **3 处外部入口链接** | DELETE | S |
| E | `ai-tracker-weekly` cron（render.yaml + healthchecks） | DELETE | XS |
| F | 诊断 AI 可见度采集链（collector + live-probe） | REWIRE→M1（归 P31.X.4） | L |
| G | 死调试路由（`/api/diagnose` + `/api/diagnostic/*` 共 8 个） | DELETE | S |
| H | 博客选题链（topic-selector / page-seo-intelligence） | REWIRE→M1 | M |
| I | 客户月报链（两套聚合器，**C 端交付物**） | REWIRE→M1 | M |
| J | 张骞发现写入（sync-ai-visibility 写 `ai_visibility_queries`） | REWIRE→M1（能力缺口，见 §7） | M |
| K | flywheel GEO 指标（GeoComposerAdapter / writeTrackerMetrics） | REWIRE→M1 或 随 B 删 | S |
| L | GEO Composer 弱项富集（`src/lib/geo/composer.ts`，非 M1） | REWIRE→M1 或 LEAVE（已 guard 成空） | S |
| M | strategy/analyzer 读 queries+runs | REWIRE→M1（删 PR 内核实下游） | S |
| N | 主看板 `dashboard/page.tsx:166` 读 `ai_visibility_runs` | REWIRE→M1 或 移除该读 | XS |
| O | demo 种子数据写 `ai_visibility_snapshots` | DELETE 种子行 | XS |
| P | admin 维护路由（clear-runs / apply-migration） | DELETE | XS |
| Q | **三张表 DROP** | 不可逆，需 PO `go apply` | XS |
| R | 系统 C 冒充客户分数（`auto-fetch.ts:65-66`） | **SEVER**（独立小 PR，与 B 无关） | S |
| — | 假阳清单（实为系统 C / 无依赖，**不动**） | LEAVE | — |

---

## 4. 逐条明细

### 组 A — ai-tracker 自有 lib（DELETE，仅被删除集内部引用）

| 文件 | 读/写 | 断了会怎样 | 定性 |
|---|---|---|---|
| `src/lib/ai-tracker/orchestrator.ts` | 读 `ai_visibility_queries[B]`:179；插/改/读 `ai_visibility_runs[B]`:266/342/375；upsert `ai_visibility_snapshots[B]`:411 | 每周采集 + Run Now 全停 | DELETE |
| `src/lib/ai-tracker/question-generator.ts` | 读 `clients`/`master_briefs`（**不写** queries，插入在路由层） | `queries/generate` 路由失效 | DELETE（但见 §7 能力缺口） |
| `src/lib/ai-tracker/engine-display-names.ts` | 无表 | 3 个看板子组件引擎名失效 | DELETE |
| `src/lib/ai-tracker/runners/gemini.ts` | 无表 | orchestrator 的 google 引擎失效（随 orchestrator 一起没） | DELETE |
| `src/lib/ai-tracker/runners/perplexity.ts` | 无表 | 同上 | DELETE |

外部消费方核实：以上 export 只被 `src/app/api/ai-tracker/*` 与 `cron/ai-tracker-weekly` 引用（都在删除集），**无删除集之外的消费方**。安全。

### 组 B — 共享基础设施（**关键：不能随手删**）

| 文件 | 谁在删除集之外用它 | 定性 |
|---|---|---|
| `src/lib/ai-tracker/parser.ts`（`parseRanking`） | `src/lib/diagnostic/ai-visibility-live-probe.ts:17`（活）+ **`src/lib/industry-ai-visibility/collector.ts:17`（系统 C，要保留！）** | **RELOCATE 后 DELETE / 或 LEAVE** |
| `src/lib/ai-tracker/runners/openai.ts`（`runOpenAI`） | `src/app/api/diagnose/route.ts:3`、`diagnostic/ai-visibility-live-probe.ts:16`、**`src/lib/prospecting/analyze.ts:21`（拓客，活）** | RELOCATE 后 DELETE / 或 LEAVE |
| `src/lib/ai-tracker/runners/claude.ts`（`runClaude`） | `src/app/api/diagnose/route.ts:4`（死调试，见组 G） | 随组 G 死路由删后可 DELETE，否则 RELOCATE |
| `src/lib/ai-tracker/runners/types.ts` | 被 openai/claude 引用 | 只要 openai/claude 存活就必须存活 |

**这是判决 2「删 9 文件」照字面执行会踩的坑**：`industry-ai-visibility/collector.ts`（系统 C，判决明确要保留）复用了 `ai-tracker/parser.ts` 的 `parseRanking`。整目录 `rm` 会打断系统 C 的采集判断。
**推荐**：删除 PR 里先把 `parser.ts` / `runners/{openai,claude,types}.ts` **平移到中立目录**（如 `src/lib/ai-probe/`）、repoint 4 个存活消费方（diagnostic probe、industry collector、prospecting、diagnose 如未删），**再删** `src/lib/ai-tracker/` 其余部分。若不想平移，则这 4 个文件标 LEAVE、只删组 A。工时 M（平移 + repoint + 回归）。

### 组 C — ai-tracker API 路由（DELETE）

`src/app/api/ai-tracker/` 下 7 个 `route.ts`：`queries/route.ts`（读:40/插:128 `ai_visibility_queries[B]`）、`queries/generate/route.ts`（插:74，import question-generator）、`queries/[id]/route.ts`（读:53/改:75）、`run/route.ts`（import orchestrator，CRON_SECRET）、`run-dashboard/route.ts`（import orchestrator，被 `[clientId]/page.tsx:152` 调）、`runs/route.ts`（读:35 `ai_visibility_runs[B]`）、`snapshots/route.ts`（读:35 `ai_visibility_snapshots[B]`）。附带 2 个测试：`run-dashboard/__tests__/route.test.ts`、`queries/[id]/__tests__/route.test.ts`。全部随系统 B 删。无删除集外部引用。

### 组 D — dashboard/ai-visibility 页面（6 文件，DELETE）+ 外部入口

6 文件：`page.tsx`、`[clientId]/page.tsx`、`_components/{RankingsTable,ModelStats,EngineComparison,QueriesManager}.tsx`（前 3 个 import `engine-display-names`；无一被本文件夹外引用）。
**判决遗漏的 3 处入口链接**（删页面后会 404，必须同 PR 移除或改指向）：
- `src/app/dashboard/clients/[id]/page.tsx:653` — `ToolCard href=/dashboard/ai-visibility/${clientId}`
- `src/app/dashboard/clients/[id]/blog/page.tsx:503` — `Link href=/dashboard/ai-visibility/${clientId}`
- `src/app/dashboard/clients/[id]/_components/ZhugeGlobalFab.tsx:59` — `href: /dashboard/ai-visibility/${clientId}`

**前端遗留漏洞（供 P31.X.4 参考）**：`_components/RankingsTable.tsx:18-22` 前端自己实现了一份 `isClientBrand`（`a.includes(b) || b.includes(a)` 双向子串），与 `parser.ts` 同一漏洞模式、跑在浏览器端。随页面删除一并消失，M1 不重蹈。

### 组 E — `ai-tracker-weekly` cron（DELETE）

`render.yaml:204-215`（`schedule: "0 1 * * 1"`）+ 注释里的 healthchecks.io ping `c4f101fe-...`。删除 render 条目 + 到 healthchecks.io 停用该 check（人工任务，进管道）。**不要碰** `industry-ai-visibility-daily`（`render.yaml:224`，系统 C）。

### 组 F — 诊断 AI 可见度采集链（REWIRE→M1，归 P31.X.4，**本轮不动**）

- `src/lib/diagnostic/collectors/ai-visibility-collector.ts`：读 `ai_visibility_snapshots[B]`:46；算出 0–100 分（:165 `mentionRate*70 + rankScore*30`）。
- `src/lib/diagnostic/ai-visibility-live-probe.ts`：读 `ai_visibility_queries[B]`:127 取问题；import `runOpenAI`(:16)+`parseRanking`(:17)（组 B 共享件）；**诊断时发真 OpenAI 调用**。
- **这条是活的、且客户可见**：`runner.ts:220` 装配 → 分数进 `diagnostic_runs.dimension_scores.ai_visibility` → 汇入 `overall_score` → 下游 `prescription-generator` / `auto-prescribe` / `report-generator` / `zhuge/assembler` / **客户 portal 诊断报告页**。触发：cron `diagnostic-weekly`（`render.yaml:429`）+ onboarding 完成 + 手动 `/api/clients/[id]/diagnostic/run`。
- **断了会怎样**：若先删 `runners/openai`/`parser` → live-probe 编译失败、全仓 build 挂；若只 DROP 表 → collector 读空，AI 可见度维度打 0，客户报告该维度归零、处方受影响。
- **定性 REWIRE→M1**：这正是判决 3「打分重做取自 M1」的对象，属 **P31.X.4**。**硬约束：三张表 DROP（组 Q）必须等 P31.X.4 把这条改到 M1 之后**，否则客户诊断分数静默归零。降级方案：P31.X.4 落地前，probe 的 query 源与 snapshot 源改读 geo_*；非 Roman 客户无数据 → 该维度返回「未测量」而非 0（避免把「没测」误报成「差」）。

### 组 G — 死调试路由（DELETE）

`/api/diagnose/route.ts`（import runOpenAI/runClaude，硬编码 BRAND `'CTS Tours NZ'`）+ `/api/diagnostic/{details,questions,response,results,parser-errors,verify-brands}/route.ts`（各自直读 `ai_visibility_runs[B]`/`ai_visibility_queries[B]`，硬编码 CTS clientId `c0000000-...`）。**全仓零代码调用方、不在 cron/UI**，是早期手测端点，**非生产打分器**（生产打分在 `/api/clients/[id]/diagnostic/*`）。随系统 B 删。删掉 `/api/diagnose` 后 `runClaude` 即无外部消费方（利于组 B）。

### 组 H — 博客选题链（REWIRE→M1）

- `src/lib/blog/topic-selector.ts`：读 `ai_visibility_queries[B]`:70 + `ai_visibility_runs[B]`:86（`client_brand_rank` 定选题）。活：`weekly-blog.ts:201` + `blog/opportunities` 端点，跑在 cron **`blog-weekly`**（`render.yaml:719`，周二 03:00）。
- `src/lib/blog/page-seo-intelligence.ts`：读 `ai_visibility_snapshots[B]`:115 + `ai_visibility_runs[B]`:126 join `ai_visibility_queries`:127。按需：`pages/[pageId]/upgrade` 调，`.catch(()=>undefined)` 包裹。
- **断了会怎样（静默）**：两处都 `if (err) return []` 吞错 → 选题返回空 → weekly-blog 走 `skipped_no_topic` → **每个客户的自动博客静默停产，cron 仍绿**（PO 铁律「发现不许死在日志里」正中此类）。
- **REWIRE→M1**：弱项信号从 `geo_observations`/`geo_evidence` 取（品牌未提及/低排名）。降级：非 Roman 客户 geo_* 空 → 仍返回 `[]` → `skipped_no_topic`，**与现状行为一致**（Roman 拿 GEO 选题，其余落回跳过直到被测量）。可接受。

### 组 I — 客户月报链（REWIRE→M1，**C 端交付物，改前必单独评估**）

两套独立月报，都被系统 B 喂：
1. `src/lib/monthly-report/collectors/ai-tracker.ts`：读 `ai_visibility_runs[B]`:19 join `ai_visibility_queries`:27。注册在 `aggregator.ts:14`，经 `GET /api/clients/[id]/reports/monthly`（`requirePaidClientAccess`，**付费 C 端门**）。空时**当前 `throw`** → `Promise.allSettled` 捕获 → HTTP 206 且缺 AI 可见度段。
2. `src/lib/reports/monthly-aggregator.ts`：读全部三张 `[B]` 表（:174/:203/:233/:249）。经 `GET /api/reports/[clientId]/monthly`，被**内部 FDE 看板** `dashboard/reports/[clientId]/monthly/page.tsx` 消费。空时不 throw、返回 null → **报告半张空白**（GEO/SERP 还在，AI 可见度整块归零）。
- **谁在看**：render.yaml **无月报 cron**，两套都是拉取式、无定时/邮件推送 → **没有客户在被动收**。今天只有人打开 FDE 看板（第 2 套）或直连付费端点（第 1 套，且未发现 portal 调用方）才会看到该段。
- **REWIRE→M1**：`collect()`/聚合读 `geo_observations` 出月度均排名/提及；非 Roman 无 geo_* → **collector 空时应返回 `null` 而非 throw**（`execute()` 已能「无数据则不写该段」），聚合器 UI 面板在 `queries_tracked===0` 时显示「未测量」而非空零。

### 组 J — 张骞发现写入（REWIRE→M1 writer，**能力缺口**）

- `src/lib/zhangqian/sync-ai-visibility.ts`：读 `ai_visibility_queries[B]`:45（去重）+ **写/插入** :73-78（司马徽/张骞发现的高信号问题，`source:'auto_generated'`）。活：`PATCH /api/clients/[id]/zhangqian/confirm:98`，非致命包裹。
- **断了会怎样**：插入删表 → throw → confirm 路由 try/catch 吞掉，`ai_visibility_queries_added:0`。发现流仍成功，但**新确认客户的 AI 可见度模块开箱即空**，「高信号问题开箱即用」承诺失效。
- **REWIRE→M1**：改写为插入 M1 的 `geo_queries`(+`geo_query_sets`)。**能力缺口**：M1 目前只有冻结的 `roman-baseline-v1` query set，**没有按客户动态建 query-set 的路径**。这条 + 组 A 的 `question-generator.ts` 合起来是「按客户自动生成/沉淀跟踪问题」的**唯一现存机制**，删掉即失能（见 §7 异议 2）。
- 其余 `src/lib/zhangqian/*` 命中的是内存报告字段 `ai_visibility`/`ai_visibility_results`（`docx-generator`/`html-generator`/`types`/`score-guardrails`/`prompts`/`validators`），**非 DB 表，不动**。

### 组 K/L/M/N/O/P — 其余真依赖

- **K** `src/lib/flywheel/adapters/GeoComposerAdapter.ts:84` 读 `ai_visibility_snapshots[B]`（`pullMetrics`，metrics-cron 调）；`src/lib/flywheel/metrics/writeTrackerMetrics.ts` 写 `flywheel_metrics`（`source:'ai_tracker'`，注释 :87 提 B 表）。→ REWIRE→M1（GEO 指标改从 geo_* 取）或随 B 删。
- **L** `src/lib/geo/composer.ts:139` 读 `ai_visibility_snapshots[B]` 做弱项富集，`req.use_tracker!==false` gate、`if(snap)` 已 guard 成空。**注意这是 GEO Composer 工具（`src/lib/geo`），不是 M1（`geo-module`/`geo-baseline`）**。→ REWIRE→M1 或 LEAVE（保留 guard 走空）。
- **M** `src/lib/strategy/analyzer.ts` 读 `ai_visibility_queries[B]`:37 + `ai_visibility_runs[B]`:68。→ REWIRE→M1；删 PR 内需核实其下游消费再定保留/删。
- **N** `src/app/dashboard/page.tsx:166` 读 `ai_visibility_runs[B]`（主看板 AI 可见度 donut，另叠 `flywheel_metrics`）。**无到 ai-visibility 的导航链（不 404）**，但该读必须打补丁或移除，否则 DROP 表后主看板查询报错。→ REWIRE→M1 或移除该读。
- **O** `src/lib/demo/refresh.ts:76/95` 删+插 `ai_visibility_snapshots[B]`（demo 客户种子）。→ DELETE 这些种子行。
- **P** `src/app/api/admin/clear-runs/route.ts`（对 `ai_visibility_runs[B]` 发 REST 行 DELETE，**非 DROP/TRUNCATE**）；`src/app/api/admin/apply-migration/route.ts`（对 `ai_visibility_runs[B]` 一次性 `ALTER ADD COLUMN`）。目标表即将 DROP，两个端点变死代码。→ DELETE。

### 组 R — 系统 C 冒充客户分数（SEVER，**独立于 ai-tracker，独立小 PR**）

- 现状：Goals 的 `ai_visibility_score` 经 `src/lib/strategy/auto-fetch.ts:65-66`（`case 'ai_visibility_score' → fetchAiVisibilityScore`）读 **`industry_ai_visibility_snapshots[C]`**（:496/:522-524，仅按客户 `industry_code` 匹配行业行），**无任何单客户测量**。cron `goal-current-value-refresh:104` 走同一函数。
- **这就是「冒充」**：行业均值被当成客户级分数写进 Goals。**注意：Goals 从来没读过系统 B**——判决 4 与本条跟 ai-tracker 删除无表级依赖，是**独立**问题，建议独立小 PR 先落。
- **SEVER**：摘掉 `auto-fetch.ts:65-66` 的 `case` 分支（不碰系统 C 自己的表/cron/看板）。同时把 `src/lib/strategy/baseline-audit.ts` 的 `AUTO_METRICS` 里 `ai_visibility_score` 移除，否则会显示「auto 但拉不到」。
- **断了会怎样（要如实告诉 PO）**：切完 Goals 的 `ai_visibility_score` **失去自动来源、留空**，直到 M1 按客户接上（属 P31.X.4 的产品决定：客户级分数该源自 M1 客户实测，而非行业基准）。这是「摘掉一个错数字、留一个诚实的空」，不是无损 no-op。

---

## 5. 假阳清单（**不动**——审计中因子串误报，实为系统 C / 无依赖）

| 文件 | 真相 |
|---|---|
| `src/lib/strategy/auto-fetch.ts` | 读 `industry_ai_visibility_snapshots[C]`；`ai_visibility_score` 是指标键名不是 B 表。仅组 R 摘 case，不删文件。 |
| `src/app/api/baselines/ai-snapshots/route.ts` | 读 `industry_ai_visibility_snapshots[C]`（Industry Baselines 看板）。留。 |
| `src/app/api/baselines/ai-collect/route.ts` | 用 `industry_ai_visibility_runs[C]`。留。 |
| `src/app/api/clients/[id]/primary-keywords/route.ts` | 仅注释提「ai-tracker」，无表依赖。留（可选清注释）。 |
| M1 全线 `geo-baseline`/`geo-module`/`geo-measurement` | 对 ai-tracker **零运行时依赖**：`provider.ts:6/44`、`types.ts:103`、`geo-measurement/{legacy-mapper.ts:42,types.ts:295/326}` 全是注释/字符串 tag；`geo-baseline/__tests__/architecture.test.ts:188` 与 `geo-measurement/__tests__/architecture.test.ts:179` 反而把 `@/lib/ai-tracker` 列入**禁止导入**断言（一旦有人 import 就 fail）。**M1 一个字不动。** |
| 系统 C 合法独立消费方 | Industry Baselines 看板/API（`baselines/ai-*`、`dashboard/industry-baselines/*`）+ 生产者 `industry-ai-visibility/orchestrator.ts` + cron `ai-visibility-weekly`。**保留。**（注：Yellowbook 只在 `industry-ai-visibility/types.ts:6` 注释里出现，尚无代码，不是现役消费方——修正原判决「喂 Yellowbook」的措辞。） |

---

## 6. 删除执行顺序（先断消费 → 再删代码 → 最后 DROP 表）

> 每一步一个 PR、单独要 PO `go`。DROP 表在最后且不可逆。

- **步骤 0（独立，可先做）**：组 R SEVER（`auto-fetch.ts:65-66` + `baseline-audit.ts` AUTO_METRICS）。与 ai-tracker 无依赖，先落清账。
- **步骤 1（只读，不改码）**：全仓消费方冻结核实（本清单即产出物）+ 3 个在跑 runner（openai/gemini/perplexity）的 `raw_response` 格式核查，为组 F/H/I 的 M1 重接与组 B 平移打底。
- **步骤 2（断消费，不碰表）**：
  - 删组 G 死调试路由（顺带释放 `runClaude`）。
  - 删组 D 页面 + 3 处入口链接（组 D）。
  - 删组 C API 路由、组 E cron、组 P admin 路由、组 O demo 种子行、组 K flywheel 采集。
  - 打补丁：组 N 主看板读、组 L geo-composer（走 LEAVE guard）、组 M analyzer（核实下游后处理）。
  - 组 B：平移 `parser.ts`/`runners/{openai,claude,types}.ts` 到中立目录并 repoint 存活消费方（diagnostic probe、industry collector、prospecting）。
- **步骤 3（REWIRE，较大）**：组 F 诊断打分、组 H 博客选题、组 I 月报、组 J 张骞写入 改到 M1（组 F 归 P31.X.4）。每条按「非 Roman 客户显示未测量、不显示 0」降级。
- **步骤 4（删码）**：删组 A ai-tracker 自有 lib 其余部分（此时 `src/lib/ai-tracker/` 应已空或只剩已平移空壳）。
- **步骤 5（DROP 表，不可逆，需 PO `go apply`）**：见 §6.1。**前置**：步骤 2–4 全部合并且所有对三张表的读/写消失（用 grep 全 token 复核 + 生产库 `pg_stat` 确认零访问）。

### 6.1 DROP 表清单（不可逆 · 需 PO 显式 `go apply`）

```sql
-- 前置：全仓已无对以下三表的任何读/写（grep 全 token + 生产零访问复核）
-- CTS 现有 102 条 queries + 8 周 snapshots：判决认为无需保留为 M1 级真值；
-- 但 DROP 前是否归档（见 §8 魏征待议）由 PO 定。
DROP TABLE IF EXISTS ai_visibility_snapshots;
DROP TABLE IF EXISTS ai_visibility_runs;
DROP TABLE IF EXISTS ai_visibility_queries;
```

顺序按外键依赖从叶到根（snapshots/runs 引用 queries）。**不要** DROP `industry_ai_visibility_*`。

---

## 7. 我的异议：有没有哪条 PO 定的删除其实不该照字面删

1. **`src/lib/ai-tracker/` 不能整目录删（强异议，已并入组 B）**：`parser.ts` 被系统 C 的 `industry-ai-visibility/collector.ts:17` 复用，`runners/openai.ts` 被 `prospecting/analyze.ts` 与诊断 probe 复用。照字面「删 9 文件」会打断**判决明确要保留的系统 C** 和活的拓客/诊断。必须先平移这 4 个文件再删，或把它们标 LEAVE。
2. **「按客户自动生成/沉淀跟踪问题」是要删掉的净能力（中异议）**：`question-generator.ts`（从 brief 生成候选问题）+ `zhangqian/sync-ai-visibility.ts`（发现流写高信号问题）是目前**唯一**的「per-client 建跟踪问题」机制。M1 只有冻结的 `roman-baseline-v1`、无按客户动态建 query-set 路径。删之前应确认 M1 侧的替代路径进了 P31.X.4 范围，否则退役后「客户级 AI 可见度覆盖全客户」这一步会缺发动机。建议：删 ai-tracker 判断/采集，但把「问题生成 + 高信号问题沉淀」显式列为 M1 待补能力，别让它随代码一起蒸发。
3. **诊断打分维度不是「删」是「搬」（提醒，非反对）**：组 F 是客户可见分数，务必在三张表 DROP 之前完成 M1 重接（P31.X.4），否则客户诊断的 AI 可见度维度会静默归零并污染 `overall_score` 与处方。执行顺序已把 DROP 卡在最后。
4. **组 R 与 ai-tracker 删除无关，别捆在一起**：Goals 读的是系统 C，不是系统 B。把它当独立小 PR 先落，避免「三系统整合」叙事误导成一次大改。

---

## 8. 复审意见（子牙 架构 / 魏征 挑刺）——待填，本轮不闭合，留给真删 PR

（子牙、魏征复审结论追加于此。发现项不在本轮修复，随删除 PR 处理。）

<!-- 子牙： -->
<!-- 魏征： -->
