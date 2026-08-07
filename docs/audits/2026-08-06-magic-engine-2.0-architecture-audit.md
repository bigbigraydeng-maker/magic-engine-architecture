# Magic Engine 2.0 — 架构审计报告

> **审计日期**：2026-08-06 · **审计范围**：`main` 全仓（1,897 个 TS/TSX 文件 / 364,155 行）
> **审计方式**：只读代码审计，**本次未修改任何 `src/` 代码**（只新增本文件）
> **依据 Brief**：Magic Engine 2.0 — Architecture Audit Brief（From AI Assistant to Autonomous AI Operating System）
>
> 本报告每一条主要结论都标注了具体文件与行号。读者可自行复核。
> 与 [STATE.md](../STATE.md) 冲突的数字以本文件为准（STATE.md 最后核对于 2026-07-25）。

---

## 1. Executive Summary（一句话结论）

**Magic Engine 的 D（发现）、A（分析）、P（处方）三段已经是真自动化，跑在定时任务上；E（执行）不是。**

具体到可验证的事实：

- 系统里**唯一一个通用的"自动把动作跑掉"的引擎**是 `src/lib/execution/auto-run.ts`（2026-08-05 才上线），它的白名单里只有 **3 种动作类型**，全是"写博客初稿"（`src/lib/execution/auto-run-policy.ts:27-36`），产物只落 `blog_posts.status='draft'`。
- 除此之外，`execution_items` 这张中央动作表有 **35 个写入方、62 处引用**，但**没有第二个自动消费方**。看板上的动作绝大多数在等人。
- 该模块自己的注释记录了生产库实测：**281 件待办，最后一件"完成"是 15 天前**（`auto-run.ts:5-7`）；**272 件里 204 件不挂在任何方案下**（`auto-run-policy.ts:88-92`）。

所以 Brief 里那句"发现 90 件、自动做掉 85 件"的目标，与现状的差距**不在 AI 能力，在执行基础设施**：

| 缺的东西 | 现状 |
|---|---|
| 通用工作流运行时（状态 / 断点续跑 / 重试） | **不存在**。取而代之的是 ≥8 张各写一套重试字段的作业表 |
| 统一的外部工具执行层（幂等 / 重试 / 审计） | **不存在**。15 个文件各自 `new OpenAI()` / `new Anthropic()`；全仓只有 1 个退避实现 |
| 学习回路 | **代码写好了但没接上电**。`src/lib/memory/extractor.ts` 零调用方，唯一入口 `/api/cron/memory-extractor` 未被任何调度器调度 |
| Goal → 执行的传导 | **断的**。`goals` 表是一等公民（有 baseline/target/period/budget），但传给决策 AI 时被压成一个字符串 |

**好消息**：底座比想象的健康得多。诊断（六维采集器）、处方自动落地、SEO 巡逻规则引擎、飞轮归因、人工任务下发通道、cron 运行日志 —— 这些都是真的、有测试的、在跑的。Magic Engine 2.0 **不需要重写**，需要的是**把六到八个已存在但各自为政的机制收敛成一层**，然后把 E 段的白名单从 3 种扩到几十种。

**建议第一刀切在哪**：SEO 内容闭环。它是全仓唯一 D/A/P/E/V 五段代码都已存在的战线，缺的只是"把它们串成一条能自己跑完、跑挂了能续、跑完了能验证、验证结果能回流"的运行时。

---

## 2. Current Architecture Map（现在这套系统怎么工作）

### 2.1 物理形态

```
┌─────────────────────────────────────────────────────────────────┐
│  Render 单体 Web Service（Next.js 14 App Router）                │
│  · 473 个 API 路由（src/app/api/**/route.ts）                    │
│  · 106 个页面（src/app/**/page.tsx），其中 dashboard 78k 行 TSX  │
│  · 101 个业务域目录（src/lib/*/）                                │
└──────────────┬──────────────────────────────────────────────────┘
               │ 全部走 supabaseAdmin（service-role key）
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL · 204 个 migration → 167 张表               │
│  不使用 end-user RLS；RLS 一律 service-role 模板                 │
└─────────────────────────────────────────────────────────────────┘

触发源（三种，互不相干）：
  ① Render Cron × 46 条  → curl https://app.magicengine.com.au/api/cron/*
  ② GitHub Actions × 5   → 同上（factory-sweepers / goals-expiry / baseline-domains / demo-refresh / winner-reel）
  ③ 一台本地 Mac 上的常驻进程 scripts/factory-worker/worker.mjs（无 launchd/pm2，挂了无告警）
```

### 2.2 一个请求怎么流过系统

以「客户网站有个 SEO 问题 → 系统写一篇文章」这条最完整的链路为例：

```
① 数据采集（多条独立 cron，互不通信）
   keyword-snapshots-weekly  → keyword_snapshots
   google-data-pullback-daily → gsc_performance_snapshots
   site-audit-cron            → client_site_pages
        │
② 发现 D  seo-patrol-daily （src/lib/seo-patrol/job.ts）
   读快照 → 纯函数规则引擎 rules.ts（R1 低 CTR / R3 内容过期 / R4 关键词机会）
   → 写 seo_patrol_findings
   → 转成 PriorityAction → persistZhugeActions() → 写 execution_items(status='pending')
        │
③ 分析 A  周一体检（src/lib/diagnostic/scheduled-run.ts → runner.ts）
   6 个 Collector 并行采集 → 打分 → 写 diagnostic_runs / diagnostic_findings
        │
④ 处方 P  周二自动开方（src/lib/diagnostic/auto-prescribe.ts）
   吃周一体检结果 → Claude 生成方案 → landPrescription()
   → 派生 Initiative → 再生成一批 execution_items
        │
⑤ 执行 E  ← 🔴 链条在这里变窄成针眼
   src/lib/execution/auto-run.ts（cron，dry-run 模式上线中）
   ├ 白名单只认 3 种 action_type
   ├ 一轮最多 3 件、每客户 1 件
   ├ 六道闸：客户状态 / 周更开关 / 背书新鲜度 / 类型白名单 / fix_type / 是否点名题目
   └ 产物：blog_posts.status='draft'  ← 到此为止，不发布
        │
        ├──→ 其余 99% 的动作：停在看板上等人点
        │
⑥ 发布（人手触发，无自动化）
   人在 UI 上点 → /api/clients/[id]/cms/publish-blog → src/lib/cms/blog-publisher.ts
   → WordPress / Shopify / GitHub PR
        │
⑦ 验证 V（部分自动）
   src/lib/gsc/inspect.ts + indexing-client.ts + seo-patrol/index-check.ts → 收录检查
   attribution-cron（6h）→ src/lib/flywheel/attribution/job.ts
   → 对每个有 expected_metric 的 flywheel_action 算 baseline/after/delta/verdict
   → 写 flywheel_outcomes（confirmed / inconclusive / reversed）
        │
⑧ 学习 L  🔴 断开
   src/lib/memory/extractor.ts：把 outcomes 转成 proven_patterns / failed_experiments
   → **零调用方**，唯一入口 /api/cron/memory-extractor **未被任何调度器调度**
   （部分补偿：agent-learning-rollup 每周一 07:00 跑，写汇总级 preference）
        │
⑨ 兜底：人工任务下发
   pm-daily-todo（周日至周四 19:00）→ src/lib/pm-todo/manual-items.ts
   12 类人工任务，每条自带 what / how / href
```

### 2.3 Agent 层

四个"人格 agent"，**都不是长驻进程，是被调用的函数**：

| Agent | 代码 | 职责 | 状态 |
|---|---|---|---|
| 张骞（Discovery） | `src/lib/zhangqian/`（8,667 行） | 采证据 | 有独立 sweeper cron |
| 华佗（Analysis） | `src/lib/huatuo/`（4,140 行） | 六维打分 + 叙述 | 被诊断 runner 调用 |
| 诸葛亮（Prescription） | `src/lib/zhuge/`（5,384 行） | 出 work order | `conductor.ts` 单次 Claude 调用（可带 4 个只读工具） |
| 鲁班（Execution） | `src/lib/luban/`（2,272 行） | 执行 | 只在 FDE 打开对话抽屉时被调用 |

---

## 3. What Is Already Good（必须保留，不要重写）

这一节很重要 —— 下面这些是真资产，Magic Engine 2.0 应该建在它们上面，不是替代它们。

### 3.1 诊断采集层（`src/lib/diagnostic/`，15,422 行 · 全仓最大模块）

6 个独立 Collector（seo / social / reputation / competitor / ai_visibility / ads），可单维跑也可全量跑（`runner.ts:20-32`），有 `diagnostic_runs` 表记录每次运行。这是一套结构良好、可扩展的**Discovery + Analysis 基础设施**。加第七维只需加一个 Collector。

### 3.2 SEO 巡逻规则引擎（`src/lib/seo-patrol/rules.ts`）

**纯函数规则引擎**，5 条规则各自独立、可测试、可加。文件头部老实交代了 R2/R5 缺数据源所以永不触发（`job.ts:15-20`）—— 这种"知道自己哪里瞎"的自觉，比装作全覆盖有价值得多。这是 Magic Engine 2.0 的 Discovery 层该长的样子：**规则是数据，不是代码路径**。

### 3.3 auto-run 的判定层（`src/lib/execution/auto-run-policy.ts`）

虽然白名单只有 3 项，但**判定框架本身设计得非常好**：
- 白名单而非黑名单，失败模式选择正确（`auto-run-policy.ts:6-9`）
- `Endorsement` 类型区分了 6 种背书状态，方案/计划都有保质期（45 天 / 8 天）
- 客户状态闸排在所有判断之前
- 每条拒绝都返回一句人话理由

这套判定逻辑是 Magic Engine 2.0 **Governance 层的现成骨架**。要扩的是白名单，不是这套框架。

### 3.4 飞轮三表 + 归因作业（`src/lib/flywheel/`）

`flywheel_actions` → `flywheel_metrics` → `flywheel_outcomes` 三段式，加 6 个 Adapter（`adapters/registry.ts`）。归因作业（`attribution/job.ts`）每 6 小时算一次 baseline→after→verdict。**这是全仓唯一一处真正的"结果回流"机制**，也是 Learning 层唯一现成的数据源。

### 3.5 人工任务下发通道（`src/lib/pm-todo/manual-items.ts`）

12 类人工任务，每条强制 what/how/href 三件套，还有"红线类问题即使链接坏了也照样下发"的设计（`manual-items.ts:27-36`）。**Brief §17 要的 Human-in-the-Loop，这里已经有了一个能用的实现**。Magic Engine 2.0 的 approval gate 应该复用它，不是另建。

### 3.6 记忆层的数据模型（`src/lib/memory/`）

五张表（learned_preferences / proven_patterns / failed_experiments / decision_history / global_learned_lessons）+ 分级 scope（global / channel / industry）+ 置信度 + 反例计数（`service.ts:139-212`）。**模型设计是对的**，甚至考虑到了 PostgREST 注入风险（`service.ts:174-179`）。它唯一的问题是没通电。

### 3.7 cron 运行日志（`src/lib/cron/run-logger.ts` + `cron_run_logs`）

56 个 cron 路由中 52 个接了 `startCronRun()`。这是**目前唯一成体系的可观测性**，覆盖率 93%。

### 3.8 单体架构本身

473 个路由、167 张表全在一个 Next.js 进程里。Brief §34 警告不要引入微服务 —— **这个警告在这里是多余的，因为这个仓库根本没往那个方向跑**。单体 + Postgres 是对的选择，Magic Engine 2.0 应该继续单体。

---

## 4. Top Architectural Problems（按根因排序，不是按症状）

### 🔴 问题 1：没有工作流运行时，取而代之的是「每张表各写一套」

**根因**，不是症状。全仓**不存在** `src/lib/workflow` / `queue` / `job` / `state-machine` 任何形式的通用抽象（已核实：目录不存在，也无 `WorkflowState` / `StateMachine` 类型定义）。

实际存在的是 **≥8 张各自为政的作业表**，重试与认领字段各写各的：

| 表 | 认领 | 重试 | 退避 | 心跳 | 上限 |
|---|---|---|---|---|---|
| `content_work_orders` | `claimed_by`+`claimed_at` | `attempt_count` | ❌ | `heartbeat_at` | `max_attempts` |
| `execution_items` | `auto_run_started_at` | `auto_run_attempts` | `auto_run_next_at` | ❌（用 120 分钟超时） | 常量 `MAX_ATTEMPTS=3` |
| `website_publish_jobs` | ❌ | `retry_count` | ❌ | ❌ | ❌ |
| `content_factory_render_jobs` | ❌ | `attempts` | ❌ | ❌ | ❌ |
| `client_discovery_jobs` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `site_audit_jobs` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `public_scan_jobs` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `visual_assets` | ❌ | ❌ | ❌ | ❌ | 靠 `provider_job_id` 轮询 |

**这直接回答了 Brief §21 的问题**：「10 步流程第 6 步挂了会怎样？」

答案取决于挂在哪张表上：
- `content_work_orders`：sweeper 按心跳回收，可续跑（这张表做得最好）
- `execution_items`：`releaseStaleClaims()` 120 分钟后放回，attempts+1，2 天/4 天退避，3 次停手叫人（`auto-run.ts:357-383`）
- **其余 6 张：卡死，无人知晓，直到有人发现。** 例如 `site_audit_jobs` 卡住只能靠 `pm-todo` 的 `crawl_stale` 项在 14 天后被人看见。

而且**这些"步"根本不属于同一个流程**。"写文章 → 发布 → 验证收录 → 观察排名"这四步分散在 `blog_posts.status` / `website_publish_jobs.status` / `seo_patrol_findings` / `flywheel_outcomes` 四张表里，**没有任何一行数据表示"这是同一件事的第 1/2/3/4 步"**。

> **Brief §31 要的答案就是这个**：不是"工作流 A 丢上下文、B 也丢、C 也丢"，而是**根本没有工作流这个概念**。

### 🔴 问题 2：E 段的针眼 —— 一个 3 项白名单挡住整个执行层

`AUTO_RUNNABLE_ACTION_TYPES` 只有 3 项（`auto-run-policy.ts:27-36`），且全是同一件事（写博客初稿）。

更根本的是**动作类型本身不是受控词汇表**。`auto-run-policy.ts:14-16` 老实记录：

> 动作类型也是 AI 现编的自由文本（36 种，含 `diversify_meta_ad_creatives` 和 `diversify_meta_creatives` 这种同义重复）

诸葛亮的 prompt 让它自由生成 `action_type` snake_case slug（`conductor.ts:88`），下游却要用**精确字符串匹配**来判断能不能自动跑。**这是一个结构性缺陷：生成端是开放词汇表，消费端是封闭白名单，中间没有注册表。** 每加一种能自动做的事，都要手工在两处对齐字符串。

`OUTWARD_ACTION_TYPES`（12 项，`auto-run-policy.ts:60-73`）同理 —— 它是人手维护的同义词表，AI 换个词就绕过去了。

### 🔴 问题 3：学习回路的电线没接上

- `src/lib/memory/extractor.ts`（Phase 23.C，设计良好、幂等、纯规则无 LLM）**零调用方**
- 唯一入口 `/api/cron/memory-extractor/route.ts` **不在 `render.yaml`，也不在 `.github/workflows/`**（本次实测确认）
- 因此 `flywheel_outcomes` → `client_proven_patterns` / `client_failed_experiments` 这条路**从未跑过**

结果：诸葛亮的 prompt 里那段 `## Client Memory`（`conductor.ts:82-84`「prefer proven patterns, avoid failed experiments」）读到的多半是空的。系统"记不住教训"不是模型的问题，是**一根没插的电线**。

（部分补偿：`agent-learning-rollup` 每周一 07:00 在跑，写汇总级 preference。但它是二级汇总，缺了一级抽取，等于在空表上做汇总。）

**同一根因下的其他孤儿 cron**（本次实测，56 个路由中 5 个无调度）：
`flywheel-seo-weekly` · `admin-key-expiry` · `memory-extractor` · `factory-review-sweeper`（已知退役）· `factory-worker-sweeper`（实际由 `factory-sweepers.yml` 硬编码路径调度，只是我的静态扫描匹配不到 —— 这本身说明调度关系不可静态验证）

### 🟠 问题 4：Goal 是一等公民的表，却不是一等公民的输入

`goals` 表结构非常完整（`src/lib/strategy/goals.ts:167-190`）：`intent` / `primary_metric_key` / `baseline_value` / `target_value` / `target_direction` / `supporting_metrics` / `period_start`/`end` / `budget_amount`。

但传到决策层时发生了什么：

```typescript
// src/lib/zhuge/conductor.ts:245-252
function formatBusinessContext(ctx: BusinessContext): string {
  if (ctx.monthly_budget_aud != null) parts.push(`Budget: AUD $${ctx.monthly_budget_aud}/month`)
  if (ctx.primary_goal) parts.push(`Primary goal: ${ctx.primary_goal}`)   // ← 一个字符串
  ...
}
```

**baseline、target、当前值、剩余天数、离目标还差多少 —— 一个都没进去。** 诸葛亮的排序框架（`conductor.ts:76-84`，8 条优先级规则）里，**没有任何一条提到 Goal**。它按严重度和分数排序，不按"离目标的距离"排序。

所以 Brief §26 的问题「客户要把营收从 $30K 做到 $60K，Magic Engine 下一步该做什么？」—— **当前架构回答不了**。它能回答的是「哪个维度分最低」。

`goal-current-value-refresh` cron 每天在跑，但 ROADMAP 里 `P31.X.2`（主指标自动拉取 current_value）还未完成，意味着**很多 Goal 的当前值是人手填的**。

### 🟠 问题 5：没有统一的外部执行层

- **15 个文件**直接 `new OpenAI()` / `new Anthropic()`，绕过 `src/lib/ai/generate.ts` 和 `src/lib/anthropic/client.ts` 两个"统一层"
- **全仓只有 1 个退避实现**（`auto-run.ts:345-348`），没有共享的 `withRetry` 工具
- 成本记账分三本账：`datasource_usage_logs`(7 处) / `mtc_ledger`(6 处) / `factory_balance_ledger`(2 处)，**没有一个地方能回答"这次自动执行花了多少钱"**
- 幂等靠各模块自觉：`blog/weekly-blog.ts`、`social/comment-autoreply-engine.ts`、`memory/extractor.ts` 各有各的去重键，没有统一契约

**这直接回答了 Brief §31 的第二个例子**：不是"WordPress 发布挂了、社媒发布挂了、Google API 挂了"三个 bug，而是**没有统一的外部工具执行层**。

### 🟠 问题 6：鲁班的工具层几乎是空的

`src/lib/luban/tools.ts` 提供 4 个工具，实际能力：

| 工具 | 真实能力 |
|---|---|
| `add_work_log` | 写一行日志 ✅ |
| `generate_content` | **只支持 `module='seo_engine'`**，其他一律返回一段道歉文本（`tools.ts:199-207`） |
| `publish_to_gbp` | 没配 GBP 写权限就降级成"草稿写进日志，请 FDE 手动发"（`tools.ts:362-387`） |
| `discover_local_competitors` | 爬黄页 ✅（只读） |

**没有 `publish_blog` / `update_page_meta` / `schedule_social_post` / `adjust_ad_budget` 任何一个真正的执行工具。** Brief §14 要的 `Agent → Capability Interface → Provider Adapter → External API` 分层，当前是 `Agent → 4 个半成品 → 少量 Adapter`。

而 CMS 发布能力其实**是存在的**（`src/lib/cms/blog-publisher.ts` 支持 WordPress/Shopify/GitHub PR，8,005 行）—— 只是**没有以工具的形式暴露给 agent**，只能人在 UI 上点。

### 🟡 问题 7：多租户 = 配置 + 大量硬编码

- **254 个文件**引用了硬编码的客户名 / 客户 UUID（`oztop` / `ctstours` / `c0000000-...` / `d5c98811-...`）
- 其中在业务逻辑（非测试）里的约 40 个，包括 `src/lib/seo-patrol/job.ts`、`src/lib/cron/registry.ts`、`src/lib/blog/content-auditor.ts`
- **两个按客户命名的 cron 路由**：`/api/cron/oztop-seo-optimizer?max=8`（周一 05:00）和 `/api/cron/cts-seo-optimizer`（周一 05:30），都在 `render.yaml` 里
- **一个按客户命名的模块**：`src/lib/seo-meta/cts-meta-pr.ts`

按 Brief §27 的分类：目前 **"平台逻辑" 与 "客户配置" 没有清晰边界**。新接一个客户，除了填 Master Brief，大概率还要动代码。

### 🟡 问题 8：UI 复杂度已经超过自己定的规矩

- 106 个页面，dashboard 下 78,230 行 TSX
- 最大文件 `src/app/dashboard/clients/[id]/execution/_client.tsx` **3,295 行**（CLAUDE.md §7 定的规矩是文件 < 800 行）
- 第二 `SocialPlanSection.tsx` 2,272 行、第三 `prescription/new/page.tsx` 1,855 行
- **没有系统级的对话入口**。有的是三个绑在具体对象上的抽屉：`LubanChatDrawer`（绑执行项）、`ZhugeDrawer`（绑客户）、`BriefChat`（绑 brief）

---

## 5. DAPE / Loop Maturity Analysis（闭环成熟度）

评分标准（Brief §24）：0 不存在 · 1 基本手工 · 2 AI 给建议 · 3 部分自动 · 4 端到端自动 · 5 自主 + 验证 + 自我改进

| 战线 | D 发现 | A 分析 | P 处方 | E 执行 | V 验证 | L 学习 | 自动再触发 | **总分** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **SEO 内容** | ✅ 自动 | ✅ 自动 | ✅ 自动 | 🟡 只写草稿 | 🟡 有收录检查+归因 | ❌ 断电 | 🟡 部分 | **3** |
| **GEO / AI 可见度** | ✅ 自动 | ✅ 自动 | ✅ 自动 | ❌ 永不自动 | 🟡 tracker 复测 | ❌ | ❌ | **2** |
| **社媒内容** | 🟡 部分 | 🟡 部分 | ✅ 自动 | 🟡 依赖一台 Mac | 🟡 engagement 回流 | ❌ | ❌ | **2** |
| **广告** | ✅ 自动 | ✅ 自动 | ✅ 自动 | ❌ 全在禁止名单 | 🟡 ad_daily_insights | ❌ | ❌ | **2** |
| **口碑** | ✅ 自动 | ✅ 自动 | 🟡 | ❌ 设计上就外包 FDE | ❌ | ❌ | ❌ | **1** |
| **竞品** | ✅ 自动 | ✅ 自动 | 🟡 | ❌ 设计上就外包 FDE | ❌ | ❌ | ❌ | **1** |

### 逐条依据

**SEO = 3 分（最成熟，也是唯一接近闭环的）**
- D：`seo-patrol-daily` 跑规则引擎，R1/R3/R4 吃真数据；R2/R5 无数据源，永不触发（`job.ts:15-20`）
- A：`diagnostic/runner.ts` 周一六维体检
- P：`auto-prescribe.ts` 周二自动开方并落地成 execution_items
- E：`auto-run.ts` 能写草稿，一轮 3 篇封顶；**发布必须人点**
- V：`gsc/inspect.ts` + `seo-patrol/index-check.ts` 能查收录；`attribution/job.ts` 14 天窗口算 verdict
- L：`memory/extractor.ts` 未接调度 → **outcome 不回流成经验**

**GEO = 2 分**
`publish_geo_directive` / `publish_geo_snippet` 明确列在 `OUTWARD_ACTION_TYPES`（「会写到客户网站上」），**按设计永不自动执行**。ai-tracker 每周复测提供了验证信号，但没有任何东西消费这个信号去调整下一步。

**广告 = 2 分**
6 个广告类动作全在禁止名单（「会开始花广告费」/「会改正在投放的广告」）。这是**正确的安全选择**，但意味着广告战线在架构上没有 E 段 —— 需要的不是打开闸门，是**建预算护栏 + 审批闸**这一层。

**社媒 = 2 分**
Factory 的 worker（`scripts/factory-worker/worker.mjs`）跑在一台本地 Mac 上，**仓库里没有 launchd/pm2 配置，挂了没告警**（STATE.md §4.4）。这不是架构问题，是运维单点，但直接影响这条线的可靠性评分。

---

## 6. Memory & State Analysis（为什么系统会「忘」）

Brief §22 要求「精确指出系统为什么会忘」。答案有四层，**每一层的原因都不同**：

### A. 业务记忆（客户是谁）—— 记得住 ✅

`master_briefs`（含品牌声调、内容支柱、目标受众、VI）+ `clients.primary_keywords` + `client_site_pages`。CLAUDE.md §8 明确要求写任何客户数据前先查这两处。**这一层是健康的**。

### B. 运行状态（现在在做什么）—— 部分记得 🟡

记得住的：`execution_items.status` / `blog_posts.status` / `content_work_orders.status`。

**记不住的是"这几件事属于同一个流程"**。一篇文章从 `execution_items(pending)` → `blog_posts(draft)` → `website_publish_jobs(published)` → `seo_patrol_findings` → `flywheel_outcomes`，**五张表五个 id，没有一条贯穿的 correlation id**。所以问「上周那篇关于 X 的文章现在到哪一步了」，系统答不上来 —— 要人拼。

`flywheel_actions.execution_item_id` 是唯一一处跨表关联，但只连了两张。

### C. 情节记忆（以前发生过什么）—— 记得住原始数据，记不住结论 🟡

`flywheel_outcomes` 有完整的 baseline/after/delta/verdict/confidence。这是好的原始记录。

但**从原始记录提炼成"教训"的那一步没跑**（见问题 3）。所以系统"知道 3 月那次动作 verdict=reversed"，但不"知道这类动作对这个客户没用"。

### D. 学到的偏好 —— ❌ 断电

`client_proven_patterns` / `client_failed_experiments` 的唯一自动写入方是未调度的 extractor。手工入口存在（`/api/clients/[id]/memory/annotate`），但依赖人去标注。

### E. 策略记忆（允许做什么）—— 硬编码在代码里 🟡

政策目前**不是数据，是代码常量**：
- `AUTO_RUNNABLE_ACTION_TYPES`（3 项数组）
- `OUTWARD_ACTION_TYPES`（12 项对象）
- `PRESCRIPTION_FRESH_DAYS = 45` / `ENDORSEMENT_FRESH_DAYS = 8`
- `MAX_ITEMS_PER_RUN = 3` / `MAX_ITEMS_PER_CLIENT = 1`

改一条政策 = 改代码 + 部署。**不同客户不可能有不同的自动化授权级别**，而这恰恰是 Brief §15.E 和 §17 要的能力。

### 关于 `.md` 文件的判断（Brief §16）

**好消息：这个仓库没有掉进"Markdown 当操作系统"的坑。** 关键状态全在 Postgres 里，`.md` 只承担知识和文档职责。

唯一的风险点是 `docs/` 已经膨胀（19 个子目录），而 STATE.md 自己承认与 ARCHITECTURE.md 严重漂移（ARCHITECTURE.md 顶部有一大段"本文件不是系统现状"的免责声明，列了 4 处数量级差距）。这是**文档债，不是架构债**，但会持续误导每个新会话。

---

## 7. Agent Architecture Analysis

### 7.1 四个 agent 的实际形态

| | 张骞 | 华佗 | 诸葛亮 | 鲁班 |
|---|---|---|---|---|
| **形态** | 函数（有 sweeper cron） | 函数 | 单次/多轮 Claude 调用 | 对话式（FDE 手动开） |
| **输入** | 客户域名 | 6 个 Collector 结果 | 证据 + 分数 + findings + memory | 单个 execution_item |
| **输出** | `client_discovery` | `diagnostic_findings` + 分数 | `PriorityAction[]` → `execution_items` | 对话 + 4 个工具 |
| **工具** | 爬虫 / DataForSEO | 无 | 4 个**只读**工具（`agent-tools/readonly/`） | 4 个工具（3 个半成品） |
| **记忆访问** | ❌ | ✅ `huatuo/memory.ts` | ✅ L1+L2+反馈环 | ❌ |
| **prompt 大小** | 大 | 大 | `SYSTEM_PROMPT_LONG` ~1.5k tokens + 动态注入 | 中 |
| **状态管理** | 库 | 库 | 无（单次调用） | 无 |

### 7.2 判断：是「协作的专职 agent」还是「一串接起来的 prompt」？

**是后者，但比典型的"prompt 链"好。**

支持"好"的证据：
- 它们通过**数据库表**交接，不是通过对话上下文传递（这一点做对了）
- 诸葛亮有真正的工具循环（`conductor.ts:404-451`），且工具是**服务端注入 clientId 的只读工具**（`agent-tools/readonly/`）—— 模型无法指定查别的客户（`conductor.ts:59`）
- 有 `max_tokens` 截断保护，拒绝解析残缺 JSON（`conductor.ts:436-438`）
- 有记忆命中日志，可 grep 生产日志证明记忆被读了（`conductor.ts:357-372`）

支持"仍是 prompt 链"的证据：
- **鲁班和诸葛亮之间没有契约**。诸葛亮输出 `executable_by: string | null`（一个自由文本工具名），鲁班的工具表是硬编码的 4 个。两边对不上就是 `null`。
- **张骞和华佗之间没有共享 schema**，靠 `ZhugeInput.discoveryEvidence` 一个大 JSON 传
- **没有一个 agent 知道 Goal**（见问题 4）
- 每个 agent 的"记忆"是各自 loader 拼的 prompt 段落，不是共享的 context 服务

### 7.3 「什么该是 agent」（Brief §35 的问题）

按当前代码看，**有两个不该是 agent 的地方，和一个该是但不是的地方**：

**不该是 agent 的**：
1. 诸葛亮做的"按严重度排序"完全可以是确定性函数。它真正需要 AI 的部分是 `why_now`（写给人看的一句话）和"这个打法对这个客户合不合适"的判断。现在把排序也交给了 LLM，结果是**排序不稳定、不可复现、无法测试**。
2. `action_type` 由 LLM 自由生成 —— 这应该是从注册表里选，不是生成。

**该是但不是的**：
3. **没有"下一步该做什么"的决策层**。诸葛亮是"这个客户的问题清单排序器"，不是 Brief §9 要的 Growth Brain（跨 Goal、跨战线、跨客户的资源分配）。

---

## 8. Tool / API Architecture Analysis

### 8.1 当前分层

```
Agent  ──→  ❌ 没有 Capability Interface  ──→  ~30 个 Provider 客户端
                                                 lib/dataforseo/ lib/gsc/ lib/meta/
                                                 lib/publer/ lib/cms/wordpress-client.ts
                                                 lib/cms/shopify-client.ts lib/gbp/ ...
```

**中间那一层是空的。** `src/lib/cms/` 里已经有了正确形状的东西（`blog-publisher.ts` 内部分发到 WordPress / Shopify / GitHub），但它：
- 不是以 agent 工具的形式暴露的
- 只覆盖 CMS 一个域
- 只能由 HTTP 路由触发（`/api/clients/[id]/cms/publish-blog`）

### 8.2 缺失的横切能力（Brief §17 清单逐条核对）

| 能力 | 状态 | 证据 |
|---|---|---|
| 幂等 | 🟡 各模块自觉 | 5 个模块各有各的去重键，无统一契约 |
| 重试 | 🟡 只有 1 处 | 全仓唯一退避实现在 `auto-run.ts:345` |
| 断点续跑 | ❌ | 无 checkpoint 概念 |
| 超时处理 | 🟡 | cron 层 `curl --max-time`；`auto-run` 有 `BATCH_BUDGET_MS` |
| 限流 | 🟡 | 只有 `zhangqian/rate-limiter.ts` 一处 |
| 凭证过期 | 🟡 | `meta/token-manager.ts`、`platform_oauth_connections` 有，但每家各写 |
| 错误分类 | ❌ | 无统一错误类型 |
| 审计日志 | 🟡 | `execution_logs` + `cron_run_logs` + `mcp_access_log`，三套，不覆盖外部调用 |
| 权限 | 🟡 | `middleware.ts` + `auth/whitelist.ts` 管人；**管不了 agent** |
| 审批闸 | 🟡 | 有（白名单 + `OUTWARD_ACTION_TYPES`），但是代码常量不是数据 |
| 回滚 / 补偿 | 🟡 | 只有 `website_publish_jobs.status='rolled_back'` 一处 |
| 成本控制 | 🟡 | 三本账，无法归集到单次动作 |
| 可观测性 | 🟡 | cron 层 93% 覆盖；**业务动作层 0 覆盖** |

**一句话**：外部执行的横切关注点（cross-cutting concerns）**全部散落在各业务模块里各写一遍**。这就是 Brief §31 说的"不要修三个 bug，要问是不是缺了统一层"。

---

## 9. Goal & Event Architecture Analysis

### 9.1 Goal

结论见问题 4。补充两点：

- `goals` 表支持多个同时 active（Phase 32 移除了单 active 限制，`goals.ts:200-204`）—— 数据模型已经为多目标准备好了
- `goal-current-value-refresh` cron 每天跑，但 `P31.X.2`（自动拉 current_value）未完成 → **进度是半自动的**
- `initiatives` 表存在，`goals → initiatives → execution_items` 三层链路在数据模型上通了

**所以 Goal 架构的差距不在建模，在传导。** 只要把 Goal 的结构化数据（gap / 剩余天数 / 各 supporting_metric 的当前值）真正喂进决策层，并把"离目标的距离"加进排序框架，Goal-Directed 就成立了。这是**中等工作量，不是重写**。

### 9.2 Event

当前有 **6 张事件性质的表**，互不相干：

| 表 | 引用数 | 生产者 | 消费者 |
|---|---|---|---|
| `anomaly_signals` | 10 | `anomaly-detector` cron | 诊断 / 待办 |
| `content_demand_signals` | 9 | 内容工厂 | 工厂调度 |
| `zhuge_feedback_events` | 5 | UI 上的 dismiss/accept | 诸葛亮 prompt |
| `work_events` | 5 | 团队记忆 | distill |
| `voice_webhook_events` | 4 | 语音回调 | 语音 finalize |
| `website_lead_events` / `contact_stage_events` | 3 / 3 | 网站 / CRM | CRM |

**没有统一的事件信封，没有订阅机制，没有事件总线。** 每一对生产者-消费者是硬连线的（消费者直接 `from('xxx_signals').select()`）。

### 9.3 建议（明确回答 Brief §25）

**不要引入事件总线。现在还不到时候。**

理由：
1. 当前是**单进程单库**，没有跨服务通信需求
2. 事件消费方全部是 cron 轮询，而 cron 层已经工作得不错（52/56 有运行日志）
3. Brief §34 明确警告不要为了架构好看引入复杂度

**该做的是更简单的事**：把 `execution_items` 升级成真正的持久化任务/工作流表（加 `run_id` / `step` / `parent_id` / `correlation_id` / `idempotency_key` / `next_attempt_at` / `payload` / `result`），让 cron 从"每个业务域一个轮询器"收敛成"少数几个通用 runner 轮询同一张表"。

**事件总线可以等到有第二个部署单元时再说。**

---

## 10. Scalability Analysis

### 10.1 多客户（Multi-customer）

**当前状态：接一个新客户需要工程介入。**

证据：
- 254 个文件含硬编码客户标识
- 2 个按客户命名的 cron 路由（`oztop-seo-optimizer` / `cts-seo-optimizer`）
- 1 个按客户命名的模块（`seo-meta/cts-meta-pr.ts`）
- `auto-run` 依赖 `clients.seo_config.weekly_blog` 这个开关 —— 这是对的方向（配置驱动），但只有一个开关

**该抽成配置的**：周更节奏 / 自动化授权级别 / 预算上限 / 品牌红线 / 审批规则 / 目标市场。目前这些要么是代码常量，要么不存在。

### 10.2 多行业（Multi-industry）

有基础：`clients.industry` + `industry_benchmarks` + `huatuo/industry-mapper.ts` + `industry-ai-visibility/`。
`global_learned_lessons` 支持按 industry scope 隔离（`memory/service.ts:139-212`），这个设计是对的。

风险：`industry` 是 PM 后台自由填写的文本（`service.ts:174-179` 专门为此做了归一化 + 注入防护）。**行业应该是受控词汇表，不是自由文本。**

### 10.3 多国家 / 多语言

- 已支持 AU/NZ 二元：`src/lib/locale/client-locale.ts:158`（`en-NZ` / `en-AU`）
- DataForSEO location_code 2036(AU) / 2554(NZ) 硬编码在多处
- **没有 i18n 框架**（无 next-intl 等），UI 文案是中英混排硬编码
- 时区处理散落

**判断**：AU/NZ 双市场是够用的，扩到第三个国家需要一次专门重构，但**不是现在的瓶颈**。

### 10.4 多渠道

Brief §4 列了 14 个潜在域。当前覆盖 6 个（六支柱）。新增一个渠道现在需要：新 Collector + 新 Adapter + 新 action_type + 新 cron + 新 UI 页 + 改白名单。**没有插件机制**。

---

## 11. UI / Product Complexity Analysis

### 11.1 哪些复杂度是架构造成的（自动化能消掉的）

| 界面 | 存在的原因 | 自动化后 |
|---|---|---|
| 执行看板逐条点「开始/完成」（`execution/_client.tsx` 3,295 行） | E 段自动化只覆盖 3 种动作 | 大部分可消失，只留异常项 |
| `prescription/new` 手工开方（1,855 行） | 早于 `auto-prescribe` 存在 | 已被周更处方取代，可退化成"复核" |
| Content Board 逐条审批 | 无内容质量自动闸 | 抽检 + 例外，不逐条 |
| `visuals/page.tsx` 电子表格（1,529 行） | 视觉生成状态无自动流转 | 大部分可消失 |
| `geo-composer` | GEO 部署永不自动 | 建了预览+回滚后可自动 |

### 11.2 哪些必须保留（不是复杂度，是控制权）

- **今日待办 / 人工任务栏**（`pm-todo`）—— Brief §18 要的"例外管理"，已经有了
- **Goal / Initiative 视图** —— 客户要看进度
- **审批面** —— 花钱和对外发布的闸
- **数据下钻仪表盘** —— 客户要能验证
- **客户设置** —— 配置化的落点

### 11.3 关于对话式入口

**当前没有系统级对话入口**，只有三个绑定具体对象的抽屉。

Brief §18 描述的体验（「这个月什么在拖我们后腿？」「你这周做了什么？」）**需要的不是新 UI，是新数据**：一个能回答"跨 Goal、跨战线、当前状态 + 本周产出 + 阻塞点"的查询层。这个查询层现在不存在（要拼 5 张表）。

**建议顺序：先建查询层（问题 1 的 correlation id 是前提），再建对话入口。反过来做会得到一个胡说八道的聊天框。**

---

## 12. Gap Matrix（现状 vs Magic Engine 2.0）

| 能力 | 现状 | 目标 | 差距 | 严重度 | 建议方向 |
|---|---|---|---|:---:|---|
| **Goals** | 表完整，但不进决策 | 目标驱动排序 | 传导断裂 | 🔴 高 | 把结构化 Goal 喂进决策层 + 排序加"离目标距离" |
| **Events** | 6 张各自为政的信号表 | 有意义的信号 | 无统一信封 | 🟡 中 | **暂不建总线**；先统一到任务表 |
| **Workflows** | 不存在通用抽象 | 可续跑的工作流 | **完全缺失** | 🔴 最高 | 建 `runs`/`run_steps`，改造 `execution_items` |
| **Execution** | 3 项白名单，只写草稿 | 85/90 自动完成 | 针眼 | 🔴 最高 | 动作类型注册表 + 能力工具层 + 分级授权 |
| **Verification** | 收录检查 + 归因作业 | 每个动作都验证 | 只覆盖 SEO | 🟠 中高 | 归因作业泛化到全部动作类型 |
| **Memory** | 模型好，写入方未接电 | 结果回流成经验 | **一根没插的电线** | 🔴 高 | 给 `memory-extractor` 加调度（1 行改动） |
| **Learning** | 汇总层在跑，抽取层没跑 | 影响未来决策 | 上游断 | 🔴 高 | 同上 + 验证 memory 真被读到 |
| **Agents** | 4 个函数，靠表交接 | 有契约的专职角色 | 无工具契约 | 🟠 中高 | `executable_by` 改成注册表枚举 |
| **Tool abstraction** | 中间层是空的 | Capability 层 | **完全缺失** | 🔴 最高 | 建 `lib/capabilities/`，把 cms/publer/gbp 收编 |
| **Error recovery** | 只有 1 处退避 | 统一重试/续跑 | 各写各的 | 🔴 高 | 随工作流运行时一起建 |
| **Human approval** | 有，但是代码常量 | 按客户/动作分级 | 不可配置 | 🟠 中高 | 政策入库（`client_automation_policies`） |
| **Multi-tenancy** | 254 文件硬编码 | 配置即接客 | 大量客户特化 | 🟠 中高 | 逐步下沉到 `clients` + 配置表 |
| **Configuration** | 散在代码常量 | 一等公民 | 无配置层 | 🟠 中高 | 同上 |
| **Observability** | cron 93%，业务 0% | 端到端可追 | 无 correlation id | 🔴 高 | 随工作流运行时一起建 |
| **UI** | 106 页 78k 行，最大 3,295 行 | 对话+看板+审批+例外 | 操作按钮过多 | 🟡 中 | **等自动化可信后再简化**，不要先动 UI |
| **Scalability** | 单体 + Postgres | 同左 | **不需要改** | 🟢 低 | 保持单体 |

---

## 13. Architecture Scorecard（0–5，每项附理由）

| # | 维度 | 分 | 理由 |
|---|---|:---:|---|
| 1 | **Discovery 发现** | **4** | 六维 Collector + SEO 巡逻规则引擎 + 异常检测 + 竞品/口碑快照，全部 cron 自动。扣分：R2/R5 规则缺数据源永不触发（`seo-patrol/job.ts:15-20`） |
| 2 | **Analysis 分析** | **4** | 诊断 runner 结构清晰、可单维可全量，有 synthesis 层，周更在跑。扣分：评分公式自己承认要重做（ROADMAP `P31.X.4`） |
| 3 | **Prescription 处方** | **4** | `auto-prescribe.ts` 周二自动开方并落地成 Initiative + execution_items，不等 PM 点头（PM 2026-08-04 拍板）。扣分：不看 Goal |
| 4 | **Execution 执行** | **1** | 唯一通用执行器白名单 3 项、一轮 3 件、只写草稿；281 件待办 15 天没动过。给 1 不给 0 是因为**这个 1 是刚做出来的、方向正确的 1** |
| 5 | **Verification 验证** | **2** | 归因作业（6h）+ GSC 收录检查真实存在且有测试。但只覆盖有 `expected_metric` 的动作，且 SEO 之外基本空白 |
| 6 | **Learning 学习** | **1** | 数据模型 5 张表 + 抽取器代码完整 + 幂等设计正确 —— **但抽取器零调用方，cron 未调度**。汇总层（rollup）在空表上跑 |
| 7 | **Long-term memory 长期记忆** | **2** | 业务记忆（brief）健康；情节记忆有原始数据；学到的偏好基本为空；策略记忆是代码常量 |
| 8 | **Workflow reliability 工作流可靠性** | **1** | 无通用运行时。8 张作业表中只有 `content_work_orders`（心跳+认领+重试上限）和 `execution_items`（退避+超时回收）算及格，其余 6 张卡住无人知 |
| 9 | **Agent modularity Agent 模块化** | **3** | 四个 agent 职责清晰、通过表交接（不靠对话上下文）、诸葛亮的只读工具服务端注入身份 —— 这些都对。扣分：agent 与工具之间无契约 |
| 10 | **Tool/API abstraction 工具抽象** | **1** | Capability 层完全缺失；15 个文件绕过统一 LLM 层；鲁班 4 个工具里 2 个是半成品。`lib/cms/` 有正确形状但没暴露成工具 |
| 11 | **Goal alignment 目标对齐** | **2** | 表建得好（intent/baseline/target/period/budget/多目标），链路 goals→initiatives→execution_items 通了。但决策层只收到一个字符串，排序框架 8 条规则无一提 Goal |
| 12 | **Autonomous operation 自主运行** | **1** | 能自己跑完全程的只有"写博客草稿"这一件事，且一天最多 3 篇 |
| 13 | **Human-in-the-loop 人机协同** | **4** | 本项是**亮点**。白名单而非黑名单、六道闸、每条拒绝给人话理由、人工任务强制 what/how/href、红线项链接坏了也照发。扣分：政策是代码常量，不能按客户分级 |
| 14 | **Multi-customer 多客户扩展** | **2** | 数据模型全 client_id 隔离 ✅；但 254 文件硬编码客户标识、2 个按客户命名的 cron、1 个按客户命名的模块 |
| 15 | **Multi-industry 多行业扩展** | **2** | 有 `industry_benchmarks` + 行业记忆隔离 + industry-mapper。扣分：industry 是自由文本，需要专门做归一化和防注入 |
| 16 | **Internationalization 国际化就绪** | **2** | AU/NZ 双市场做得扎实（拼写/时区/location_code/`gl=` 参数）。但无 i18n 框架，UI 文案硬编码中英混排，扩第三国要重构 |
| 17 | **Observability 可观测性** | **2** | cron 层 52/56 有运行日志，`scripts/doctor.sh` 能自检调度覆盖 —— 这部分做得好。但**业务动作层零覆盖**：无 correlation id、无端到端追踪、成本分三本账 |
| 18 | **UI simplicity 界面简洁度** | **2** | 106 页面 / 78k 行 TSX / 最大文件 3,295 行（自己定的规矩是 800）。无系统级对话入口。今日待办页是唯一符合 2.0 方向的界面 |

**加权观察**：D/A/P 三段平均 4.0，E/V/L 三段平均 1.3。**这个 2.7 分的落差就是 Magic Engine 2.0 的全部工作量所在。**

---

## 14. Proposed Target Architecture（目标架构）

### 14.1 原则

1. **继续单体。** 不引入微服务 / Kafka / K8s / 向量库（Brief §34）。
2. **加一层，不是加一个系统。** 目标架构的每一层都要能指出"它替换了现在散落在哪几个文件里的逻辑"。
3. **AI 负责判断，软件负责记忆**（Brief §19）。凡是"上次做过没"「该重试吗」「谁有权限」，一律确定性代码。

### 14.2 分层图

```
┌──────────────────────────────────────────────────────────────────────┐
│  L9  体验层                                                           │
│   现有：/dashboard/today（保留强化）· Goal 视图 · 审批面 · 下钻看板    │
│   新增：意图入口（最后做，依赖 L2 的查询能力）                          │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L1  Goal & KPI 层        【已有 80%：goals / initiatives 表】        │
│   补：gap 计算 · supporting_metrics 自动拉值 · Goal→排序权重          │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L2  业务数字孪生         【已有 70%：master_briefs / clients /       │
│      client_site_pages / diagnostic_* / flywheel_metrics】            │
│   补：统一读取入口 getClientContext(clientId) —— 现在每个 agent 各拼   │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L3  Growth Brain 决策层  【新建，但可从 zhuge/conductor 演化】        │
│   职责：跨 Goal / 跨战线排序 —— 现在诸葛亮只做单客户单轮问题排序        │
│   🔴 排序用确定性打分，AI 只出「为什么」和「合不合适」                  │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L4  域管理器             【已有：华佗/诸葛亮/张骞/鲁班】              │
│   不需要新建 10 个 Manager。现有四角色 + 按 dimension 分支即可         │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L5  Loop Runtime         【🔴 完全新建 —— 本次审计的第一优先级】      │
│                                                                       │
│   新表 loop_runs      : id, client_id, loop_key, goal_id,            │
│                         status, current_step, context(jsonb),        │
│                         correlation_id, created_at                   │
│   新表 loop_run_steps : run_id, step_key, status, attempt,           │
│                         next_attempt_at, idempotency_key,            │
│                         input, output, error, claimed_at,            │
│                         heartbeat_at, cost_usd                       │
│                                                                       │
│   一个通用 runner cron 轮询 → 认领 → 执行一步 → 落状态 → 下一步        │
│   续跑 / 重试 / 退避 / 超时回收 / 审批暂停 全在这一层，只写一遍         │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L6  Capability / Tool 层 【🔴 新建门面，但底下的 Provider 已存在】     │
│                                                                       │
│   src/lib/capabilities/registry.ts                                   │
│     publish_content()   → lib/cms/blog-publisher.ts（已有）           │
│     update_page_meta()  → lib/cms/meta-patcher.ts（已有）             │
│     request_indexing()  → lib/gsc/indexing-client.ts（已有）          │
│     schedule_social()   → lib/publer/（已有）                         │
│     publish_gbp_post()  → lib/gbp/publisher.ts（已有）                │
│     generate_image()    → lib/visual/（已有）                         │
│     adjust_ad_budget()  → lib/meta/ + lib/google-ads/（已有）         │
│                                                                       │
│   每个 capability 声明：幂等键规则 · 是否对外 · 是否花钱 · 成本估算    │
│   · 回滚方式 · 验证方式。这份声明**就是白名单和审批闸的数据来源**       │
└────────────────────────────┬─────────────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────────────┐
│  L7  外部平台  WordPress / Shopify / GSC / GA4 / Meta / Publer / ...  │
└──────────────────────────────────────────────────────────────────────┘

横切（支撑全部层）：
  共享状态   loop_runs + loop_run_steps + execution_items（改造）
  记忆       memory 5 表【已有，接上电即可】
  信号       现有 6 张信号表【暂不统一】
  可观测     cron_run_logs【已有】+ correlation_id 贯穿【新增】
  治理       client_automation_policies【新建：把代码常量搬进库】
```

### 14.3 哪些现有组件保留 / 改造 / 退役

| | 组件 |
|---|---|
| **原样保留** | `lib/diagnostic/` 全部 Collector · `lib/seo-patrol/rules.ts` · `lib/flywheel/` 三表 + Adapter · `lib/memory/` 全部 · `lib/pm-todo/` · `lib/cron/run-logger.ts` · `lib/cms/` 各 Provider 客户端 · `middleware.ts` 鉴权 |
| **改造升级** | `execution_items` → 挂到 `loop_runs` 下 · `auto-run-policy.ts` 判定框架 → 读 `client_automation_policies` · `zhuge/conductor.ts` → 排序确定性化 + 吃 Goal · `luban/tools.ts` → 换成 capability registry |
| **可退役** | `prescription/new` 手工开方页（已被 auto-prescribe 取代）· 6 张作业表中无重试机制的那几张的私有轮询逻辑（收编进 loop runtime）· 按客户命名的 cron 路由 |

---

## 15. Migration Plan（迁移计划）

> 原则：**每一期都要能独立上线并产生可验证价值**，不允许"建了半年基础设施才见效"。

---

### Phase A — 接上已经断掉的电线（1–2 天）

| 项 | 内容 |
|---|---|
| **目标** | 让已经写好的代码开始工作。这一期不写新架构。 |
| **涉及组件** | `render.yaml` · `src/lib/cron/registry.ts` · `src/lib/memory/extractor.ts` · 5 个孤儿 cron |
| **具体动作** | ① 给 `memory-extractor` 加调度（学习回路通电）② `flywheel-seo-weekly` / `admin-key-expiry` 逐个定性：接调度或标退役 ③ 验证 `agent-learning-rollup` 在非空表上的行为 ④ 修 `factory-sweepers.yml` 的硬编码路径，让 `doctor.sh --cron` 能静态验证 |
| **预期收益** | Learning 层从 1 分 → 2–3 分。**投入产出比全案最高。** |
| **技术风险** | ~~极低~~ → **中**（2026-08-07 实测修正）。接线前必须先修抽取器的幂等键，否则每天写重、把记忆表灌满同一条经验的副本。详见「§16 补记 A」 |
| **迁移风险** | 低。extractor 只追加不删除，且首跑前记忆表本来就是空的 |
| **依赖** | 无 |
| **相对复杂度** | ~~1 / 10~~ → **3 / 10** |
| **实际状态** | ✅ ①②已做（含幂等修复 + 6 个回归测试）· ③④ 未做 |

---

### Phase B — Loop Runtime 地基（1–2 周）

| 项 | 内容 |
|---|---|
| **目标** | 建立"一件事可以有多步、挂了能续、每步可重试、全程可追"的能力 |
| **涉及组件** | 新表 `loop_runs` + `loop_run_steps` · 新 `src/lib/loop/` · 1 个通用 runner cron · `execution_items` 加 `run_id` 列 |
| **具体动作** | ① 建表（RLS 走 service-role 模板）② 写 runner：认领（行级原子，复用 `auto-run.ts:298-324` 的写法）/ 心跳 / 超时回收 / 退避 / 审批暂停 ③ 把 `auto-run.ts` **改写成第一个 loop 定义**，不新增行为 ④ 全链路 `correlation_id` |
| **预期收益** | Workflow reliability 1 → 3；可观测性 2 → 3 |
| **技术风险** | 中。认领的并发正确性是关键 —— `auto-run.ts` 已经有一个验证过的实现可以照抄 |
| **迁移风险** | **低，如果坚持"先不改行为"**。auto-run 改写完必须产出与现在完全相同的结果 |
| **依赖** | Phase A（不强制） |
| **相对复杂度** | **5 / 10** |

---

### Phase C — 第一条真闭环：SEO 内容（2–3 周）

| 项 | 内容 |
|---|---|
| **目标** | 证明架构可行。一条从机会到验证全自动跑完的链路。 |
| **涉及组件** | `src/lib/capabilities/`（新）· `lib/cms/blog-publisher.ts`（收编）· `lib/gsc/`（收编）· `lib/seo-patrol/`（触发端） |
| **loop 定义** | `discover`(已有) → `select_topic`(已有) → `draft`(已有) → `qa`(已有 `blog/seo-checker.ts`) → **`publish`(新：走 capability，客户级政策决定要不要审批)** → **`verify_live`(新)** → **`request_indexing`(已有 gsc/indexing-client)** → **`verify_indexed`(已有 seo-patrol/index-check)** → `measure`(已有 attribution) → `learn`(Phase A 接通的 extractor) |
| **具体动作** | ① 定义前 3 个 capability（`publish_content` / `request_indexing` / `update_page_meta`），每个带幂等键 + 成本 + 回滚 ② 建 `client_automation_policies` 表，把 `AUTO_RUNNABLE_ACTION_TYPES` 等常量搬进去 ③ **先只对一个客户开发布权限**（复用 `seo_config.weekly_blog` 那种逐客户开关的思路） |
| **预期收益** | SEO 战线 3 → 4.5 分。**这是 Brief §36 那个体验第一次成立** |
| **技术风险** | 中高。发布是不可逆动作，幂等必须做对（同一篇不能发两次） |
| **迁移风险** | **中高 —— 这是全案唯一真正碰客户网站的一期。** 缓解：单客户灰度 + 每步落审计 + 保留人工审批开关 |
| **依赖** | Phase A（学习）+ Phase B（运行时） |
| **相对复杂度** | **8 / 10** |

---

### Phase D — 动作类型注册表 + 泛化（2 周）

| 项 | 内容 |
|---|---|
| **目标** | 把"扩一种能自动做的事"从"改两处代码"变成"加一行注册" |
| **涉及组件** | `src/lib/actions/registry.ts`（新）· `zhuge/conductor.ts`（prompt 改成从枚举选）· `auto-run-policy.ts`（改成读注册表） |
| **具体动作** | ① 把现有 36 种自由文本 action_type 归并成受控词汇表（消掉 `diversify_meta_ad_creatives` / `diversify_meta_creatives` 这类同义重复）② 每种类型声明：对应 capability / 是否对外 / 是否花钱 / 验证方式 ③ 诸葛亮改成从枚举选，选不出就标 `needs_human` |
| **预期收益** | Execution 1 → 3；Agent 模块化 3 → 4；每新增一种自动能力的边际成本大幅下降 |
| **技术风险** | 中。要保证老数据里的自由文本 action_type 还能被正确处理 |
| **迁移风险** | 中。需要一次数据回填 |
| **依赖** | Phase C |
| **相对复杂度** | **6 / 10** |

---

### Phase E — Goal 传导 + Growth Brain（2–3 周）

| 项 | 内容 |
|---|---|
| **目标** | 让"下一步做什么"由离目标的距离决定，而不是由分数高低决定 |
| **涉及组件** | `lib/strategy/goals.ts` · `zhuge/conductor.ts` · 新 `lib/brain/prioritise.ts` |
| **具体动作** | ① 完成 `P31.X.2`（supporting_metrics 自动拉值）② 建 `computeGoalGap(goal)` → {gap, gap_pct, days_left, on_track} ③ **排序改成确定性打分函数**（gap 权重 × 预期影响 × 置信度 ÷ 成本），AI 只负责生成 `why_now` 和判断"这招对这个客户合不合适" ④ Goal 结构化数据完整进 prompt |
| **预期收益** | Goal alignment 2 → 4；排序变得可测试、可复现 |
| **技术风险** | 中。打分公式需要调，但错了不会造成不可逆后果 |
| **迁移风险** | 低 |
| **依赖** | Phase D |
| **相对复杂度** | **6 / 10** |

---

### Phase F — 复制到第二、第三条战线（各 1–2 周）

| 项 | 内容 |
|---|---|
| **目标** | 验证 loop 框架是可复用的，不是给 SEO 定制的 |
| **建议顺序** | ① **GEO**（技术上最像 SEO，且 `publish_geo_snippet` 的风险可控 —— 加一个隐藏 div，可回滚）② **社媒**（Publer 已有 API，但要先解决 factory worker 单点）③ **广告**（最后 —— 花钱，必须先有预算护栏 + 每日花费上限 + 强制审批） |
| **预期收益** | GEO 2 → 4；社媒 2 → 3.5 |
| **风险** | 广告那条**不要着急**。在预算护栏和成本归集（当前三本账）做好之前不要碰 |
| **依赖** | Phase C 验证通过 |
| **相对复杂度** | 各 **5 / 10** |

---

### Phase G — 多租户去硬编码（持续，穿插进行）

| 项 | 内容 |
|---|---|
| **目标** | 接新客户不需要动代码 |
| **具体动作** | ① 两个按客户命名的 cron 合并成一个参数化的 ② `seo-meta/cts-meta-pr.ts` 泛化 ③ 逐步把 40 个业务逻辑文件里的硬编码下沉到 `clients` 表或配置表 ④ `industry` 改成受控词汇表 |
| **预期收益** | Multi-customer 2 → 4 |
| **依赖** | 无（可穿插）· **相对复杂度 4/10（但工作量分散）** |

---

### Phase H — 体验简化（最后，且只在自动化可信之后）

| 项 | 内容 |
|---|---|
| **目标** | Brief §18 的对话 + 看板 + 审批 + 例外 |
| **前提** | **必须等 Phase C–F 跑稳，有至少一个季度的自动执行记录** |
| **具体动作** | ① 先建跨表查询层（依赖 Phase B 的 correlation_id）② 再建意图入口 ③ 最后才删按钮 |
| **风险** | **先删按钮 = 灾难。** 自动化还没接管，人却没了操作入口 |
| **依赖** | 全部 · **相对复杂度 7/10** |

---

## 16. Top 10 Recommended Actions（前十件事，按顺序）

1. ~~**给 `memory-extractor` 接上 cron 调度。** 一行 `render.yaml` 改动……零风险。~~
   **✅ 2026-08-07 已完成，但这条当时写错了 —— 它不是一行改动，也不是零风险。** 见下方「§16 补记」。（Phase A）

2. **把剩下 4 个孤儿 cron 逐个定性**：要么接上，要么删掉路由。**留着比删掉危险** —— 它们让人以为某件事在跑。2026-08-07 已定性，结论见「§16 补记」。（Phase A）

3. **建 `loop_runs` + `loop_run_steps` 两张表和通用 runner。** 认领逻辑直接照抄 `auto-run.ts:298-324`（已验证的行级原子写法）。第一个改造对象是 `auto-run` 自己，**要求改造后行为零变化**。（Phase B）

4. **给全链路加 `correlation_id`。** 从 `execution_items` 一路贯到 `blog_posts` / `website_publish_jobs` / `flywheel_actions` / `flywheel_outcomes`。这一个字段解决"这篇文章现在到哪一步了"这个现在答不上来的问题。（Phase B）

5. **建 `src/lib/capabilities/`，先收编 3 个**：`publish_content` / `request_indexing` / `update_page_meta`。底下的实现全部已存在（`cms/blog-publisher.ts` / `gsc/indexing-client.ts` / `cms/meta-patcher.ts`），只是把它们从"HTTP 路由能调"变成"loop 和 agent 都能调"，并强制每个声明幂等键 + 成本 + 回滚方式。（Phase C）

6. **把自动化政策从代码常量搬进数据库**（新表 `client_automation_policies`）。现在 `AUTO_RUNNABLE_ACTION_TYPES` / `OUTWARD_ACTION_TYPES` / `MAX_ITEMS_PER_RUN` 都是代码常量，意味着**所有客户共享同一套授权级别**。搬进库之后才能做"这个客户可以自动发布，那个客户必须人审"。判定框架（`auto-run-policy.ts` 的 `judgeAutoRun`）保持不变，只换数据源。（Phase C）

7. **打通 SEO 第一条真闭环，先只对一个客户开发布权限。** 机会 → 草稿 → 质检 → 发布 → 验证上线 → 提交收录 → 验证收录 → 测量 → 学习。这九步里七步的代码已经存在，缺的是把它们串成一个可续跑的 run。（Phase C）

8. **建动作类型注册表，把 36 种自由文本收成受控词汇表。** 同时改诸葛亮的 prompt：从"生成一个 snake_case slug"改成"从这个列表里选，选不出就标 needs_human"。这一步之后，扩展自动化能力的边际成本才会真正下降。（Phase D）

9. **让排序确定性化，并把 Goal 真正喂进去。** `computeGoalGap()` + 打分公式（gap 权重 × 预期影响 × 置信度 ÷ 成本）；AI 保留 `why_now` 和"合不合适"的判断。**副作用是排序终于可测试了** —— 现在诸葛亮的排序无法写回归测试。（Phase E）

### §16 补记（2026-08-07，动手之后回填）

> 这一节是**审计结论被实施推翻的记录**，刻意不删原文。原因见末尾。

#### 补记 A：第 1 条我写错了 —— 「零风险一行改动」是错的

动手接线时先读了一遍抽取器和它上游的归因作业，发现一个纯静态审计没看穿的缺陷：

**归因作业每 6 小时把 `flywheel_outcomes` 整条删掉重建**
（`flywheel/attribution/job.ts:127-149`：`.delete().eq('action_id', id)` 后 `.insert()`），
而 `flywheel_outcomes.id` 是 `gen_random_uuid()` 默认值 ——
**同一条归因结论的 id 每 6 小时换一次。**

而抽取器的去重键正是这个 id（原 `extractor.ts:136` `source_id: out.outcome_id`）。

照原样接上每日调度的后果：

| 时间 | 发生什么 |
|---|---|
| 第 1 天 | 为每条 confirmed 结论写一条经验，`source_id` = 当时的 outcome.id |
| +6 小时 | 归因重跑，删了重建，id 变了 |
| 第 2 天 | 去重集合里没有新 id → **再写一条一模一样的经验** |
| … | 每天 +1，永不收敛 |

而诸葛亮读记忆只取最新 15 条（`memory/service.ts` `loadPatterns` 的 `.limit(15)`）——
**两周后那 15 条会全是同一条经验的 15 个副本。比现在空着更糟**：空的时候 AI 知道自己没有经验，
灌满重复副本之后它以为自己有 15 条，实际只有 1 条，且挤掉了其他所有真经验。

同一轮还发现两个同源问题：

- **偏好条目的去重键里含着计数**。content 是「3 次 confirmed: …」，计数一涨就是新字符串 →
  3 次写一条、4 次再写一条，堆成一串只有数字不同的同义反复。
- **两处 loader 都没分页**，PostgREST 硬顶 1000 行且不报错（仓库里 `supabase-paginate.ts`
  的注释已经为这个坑写过一次事故复盘）。去重集合被截断 = 去重部分失效，照样写重。

**已修**（都在抽取器内部，没碰在跑的归因作业）：
幂等键改挂 `action_id`（归因按 action_id 整条删，所以一动作恒有且仅有一条结论，天然一对一，
且 `flywheel_actions` 行从不被重建）· 偏好去重改认 `(flywheel, type, action_type)` ·
两处 loader 改走 `fetchAll` · 去重集合读失败时改成**这轮不写**而不是照写。
配 6 个回归测试，并做了变异验证（把键改回 `outcome_id`，3 个用例精确挂掉）。

**这条补记为什么重要，超出它本身：**
它是报告 §4「问题 5：幂等靠各模块自觉，没有统一契约」的第一个实证，而且证明了
**这类缺陷读代码读不出来 —— 要把两个模块的生命周期摆在一起想才看得见**。
Magic Engine 2.0 每接一条新的自动执行，都会遇到一次同形状的问题。
这正是 §14.2 里 L6 Capability 层「每个 capability 必须声明幂等键规则」那条要求的由来 ——
把「幂等怎么做」从每个模块各自的自觉，变成一个不声明就过不去的必填项。

#### 补记 B：孤儿 cron 定性结论（第 2 条）

| 端点 | 定性 | 理由 |
|---|---|---|
| `memory-extractor` | ✅ **已接**（`35 6 * * *`） | 排在归因（06:00，超时 5 分钟）之后、周一经验汇总（07:00）之前 |
| `flywheel-seo-weekly` | ⏸ **等 PM 拍板** | 能跑（`SeoContentAdapter` 的注释还写 SEMrush，实际 import 已是 `dataforseo/labs`），但每周对每个客户花 DataForSEO 的钱。**涉及花钱 = PM 的决策，不是我的** |
| `admin-key-expiry` | ❌ **不要照原样接** | 它只 `console.warn`，邮件通道（P2）还没建。接上等于让告警死在日志里 —— 正是铁律 §3 明令禁止的。要接必须先给 `pm-todo/manual-items.ts` 加一个 kind 走今日待办 |
| `factory-review-sweeper` | ✅ 已知有意退役 | Airtable 停用 |
| `factory-worker-sweeper` | ✅ 其实在跑 | 由 `.github/workflows/factory-sweepers.yml` 里的 shell 循环拼路径调度，**只是静态扫描匹配不到**。`doctor.sh --cron` 会把它误报成孤儿 —— 这本身是个该修的小账 |

#### 补记 C：一个新增的红线（接线时才知道）

`cron/registry.ts:63-65` 记着一件不写下来就会踩的事：

> 新增 Render 服务**要有人进 Render 面板点一次 Apply，而这件事不报任何错**。

所以 `render.yaml` 改完 **不等于** 任务会跑。已核实兜底通道是通的：
`schedule.ts` 的 `judgeJob` 会把它判成 `never_ran` → `pm-todo/manual-items.ts` 的
`cron_not_running` → 今日待办「🙋 需要你动手」栏，附 Render 链接和三步排查。
`addedAt: '2026-08-07'` 是宽限期标记，防止它在第一次排班到点前被误报。

**所以这次交付之后还有一件事要人做**：进 Render 点一次 Apply。
不点的话，最迟一天后今日待办会主动来提醒 —— 这一条不会烂在日志里。

---

10. **把 factory worker 从那台 Mac 上搬下来。** 这不是架构问题，但它是当前**唯一一个"进程挂了没人知道"的单点**（STATE.md §4.4：无 launchd/pm2，工单静默卡在 queued）。搬成 Render 上的 cron 或 background worker，或者至少加一个"超过 N 分钟没心跳就下发人工任务"的检测（`pm-todo` 里已经有 `factory_worker_idle` 这个 kind，确认它真的在跑）。

---

## 17. Things We Should NOT Do（不要做的事）

1. **不要引入事件总线 / 消息队列 / Kafka。** 当前是单进程单库，cron 轮询工作得不错（52/56 有运行日志）。事件总线要到有第二个部署单元时才有意义。**先把 8 张作业表收敛成 1 张 loop 表，收益远大于加一层总线。**

2. **不要建 10 个 Domain Manager Agent。** Brief §10 列了 SEO Manager / GEO Manager / Content Manager 等十个角色。现有的四角色（张骞/华佗/诸葛亮/鲁班）+ 按 dimension 分支已经够用。**再加六个 agent 只会增加六份 prompt 要维护，不会增加一份能力。** Brief §35 自己也这么警告了。

3. **不要先简化 UI。** 自动化还没接管之前删按钮，等于既没有自动执行也没有手动入口。UI 简化必须排在 Phase H，且以"这个按钮对应的事已经自动做了一个季度"为前提。

4. **不要为了"AI 原生"把确定性逻辑改成 LLM 调用。** 恰恰相反：当前诸葛亮的**排序**就该改回确定性函数。判断"上次做过没"、"该不该重试"、"谁有权限"这类问题永远不要问 LLM。

5. **不要引入向量数据库。** 当前记忆层的问题是"抽取器没接电"，不是"检索不够聪明"。5 张结构化表 + Postgres 查询完全够用。装了向量库只会掩盖真正的问题。

6. **不要一次性重写 `execution_items`。** 它有 35 个写入方、62 处引用。改造方式是**加列不改语义**（加 `run_id`、`correlation_id`），让新旧两条路并存一段时间。

7. **不要先打开广告战线的自动执行闸门。** 6 个广告动作现在全在 `OUTWARD_ACTION_TYPES` 里是**对的**。在预算护栏、每日花费上限、成本归集（现在三本账）做好之前，"自动改正在投放的广告"是不可逆的花钱操作。

8. **不要在功能分支里顺手改 `STATE.md` / `ROADMAP.md`。** 已经是 CLAUDE.md §6 的明文规矩，这里重申是因为本次审计发现的很多"孤儿 cron"和"文档漂移"根源就在这里。

9. **不要因为 `ARCHITECTURE.md` 过时就重写它。** 它顶部已经诚实地标注了"本文件不是系统现状"。**该做的是把它拆成"设计意图"（保留）和"当前状态"（合并进 STATE.md）**，而不是再写一份会在两个月后过时的大文档。

10. **不要把 `.md` 当运行时状态。** 当前仓库没掉进这个坑（关键状态全在 Postgres），继续保持。特别是：**loop 的步骤定义可以写在代码里，但 loop 的运行状态必须在数据库里。**

---

## 18. Recommended First Reference Loop（第一条参考闭环）

## 🎯 **SEO 内容闭环**

### 为什么是它（四条理由，按重要性）

**① 九步里有七步的代码已经存在。** 这是决定性因素。其他任何战线都需要先建 Discovery 或 Verification，SEO 不需要：

| 步骤 | 现有代码 | 状态 |
|---|---|---|
| 发现机会 | `lib/seo-patrol/rules.ts` R1/R3/R4 | ✅ 在跑 |
| 判断该不该做 | `lib/execution/auto-run-policy.ts` | ✅ 在跑 |
| 选题 | `lib/blog/topic-selector.ts` + 去重审计 | ✅ 在跑 |
| 写草稿 | `lib/blog/generator.ts` | ✅ 在跑 |
| 质检 | `lib/blog/seo-checker.ts` + `content-auditor.ts` | ✅ 在跑 |
| **发布** | `lib/cms/blog-publisher.ts` | ⚠️ 存在但只能人点 |
| **验证上线** | — | ❌ 缺 |
| 提交收录 | `lib/gsc/indexing-client.ts` + `sitemap-ping.ts` | ✅ 存在 |
| 验证收录 | `lib/seo-patrol/index-check.ts` | ✅ 存在 |
| 测量 | `lib/flywheel/attribution/job.ts` + GSC 快照 | ✅ 在跑 |
| 学习 | `lib/memory/extractor.ts` | ⚠️ 未接电（Phase A 解决） |

**真正要新写的只有两件：把发布从"人点"变成"loop 调"，和"验证上线"这一步。**

**② 风险最可控，且已经有一个验证过的安全模型。** 发布博客是**加内容**，不是**改现有内容**。真出问题可以撤下来，不像改广告预算或改现有排名页那样不可逆。而且 `auto-run-policy.ts` 已经建立了一套六道闸的判定框架，直接复用。

**③ 验证信号最干净。** GSC 给的是客观数据：这页收录了吗、有多少曝光、CTR 多少、排第几。不像社媒互动或口碑那样噪声大。**闭环的价值全在于验证环节可信** —— 验证不可信的闭环只是自动化的错误。

**④ 它是当前唯一有真实积压需求的战线。** `execution_items` 里 281 件待办，白名单里那 3 种全是 SEO 内容类。**这条线自动化了，看板上的积压会真的下降** —— 这是 PM 能亲眼验证的结果。

### 这条闭环跑通之后，PM 会看到什么

**现在**：
> 「执行看板上有 281 件待办。最近一件完成是 15 天前。」

**跑通之后**：
> 「上周系统发现 12 个内容机会，自己写了 8 篇、发布了 6 篇、其中 5 篇 Google 已经收录，1 篇还在等。
> 剩下 4 个需要你定：3 个点名要改现有排名页（怕写歪），1 个客户还没开自动发布。
> 三周前发的那篇，曝光涨了 340 次 —— 这类打法记下来了，下次优先。」

**这就是 Brief §36 描述的那个体验第一次成立。** 而且它成立在一条战线上、一个客户上 —— 规模小到出问题能兜住，价值大到能证明整套架构值得复制到 GEO、社媒和广告。

---

## 附：本次审计的核查方法

所有数字均为**本次实测**（2026-08-06，`main` 分支），不是引用文档：

```bash
find src/app/api -name route.ts | wc -l                    # 473
find src/app -name page.tsx | wc -l                        # 106
find src -name "*.test.ts" -o -name "*.test.tsx" | wc -l   # 475
ls supabase/migrations/*.sql | wc -l                       # 204
grep -rhoiE "CREATE TABLE.*" supabase/migrations/*.sql | sort -u | wc -l   # 167
find src/app/api/cron -name route.ts | wc -l               # 56
grep -rl "startCronRun" src/app/api/cron --include=route.ts | wc -l        # 52
grep -rl "new OpenAI(\|new Anthropic(" src/lib src/app/api --include=*.ts | wc -l  # 15
```

**孤儿 cron 检测**（逐个路由回查 `render.yaml` 与 `.github/workflows/`）：
`flywheel-seo-weekly` · `admin-key-expiry` · `memory-extractor` · `factory-review-sweeper`（已知退役）· `factory-worker-sweeper`（实际由 `factory-sweepers.yml` 内的 shell 循环调度，静态不可验证）

### 2026-08-07 补测：`main` 的绿灯状态（首次实测，原报告没查）

第一轮审计只读代码，没跑过测试和构建。这次为了验证改动装了依赖，顺手拿到了基线：

| 项 | `main` 基线 | 说明 |
|---|---|---|
| `npx vitest run` | **22 个文件 / 112 个用例失败**（6801 通过） | 已确认与本次改动无关 —— 同一批文件在 `main` 上一模一样地挂 |
| `npx tsc --noEmit` | **128 个错误** | 多为 `--downlevelIteration` 与测试桩类型不匹配 |
| `npm run build` | ✅ 通过（需要 Supabase 环境变量才能过「收集页面数据」阶段） | 构建配置跳过 lint 与类型检查，所以上面 128 个错误拦不住部署 |

**这条值得单独记，因为它解释了一个机制问题**：`npm run build` 是推送前的唯一硬门槛，
而它**跳过 lint 和类型检查**（`Skipping linting`）。于是 128 个类型错误和 112 个挂掉的测试
可以一直存在而不挡任何一次上线 —— 它们既不会变好，也不会有人被迫看见。

这跟报告 §4「问题 3」是同一个病：**没有人被强制看见的信号，等于不存在的信号。**
建议（不在本次范围内）：先把 112 个失败分成「真 bug / 过期测试桩」两堆，
再决定是修还是删；在那之前不要往 CI 里加「测试必须全绿」的闸，
否则第一天就会被整体跳过，然后永远跳过。

**未在本次审计覆盖的范围**（诚实声明）：
- 生产数据库的真实数据（无凭证，所有关于"281 件待办""204 件无背书"的数字均引自代码注释中记录的实测结果，非本次直查）
- 外部 API 的真实连通性（容器网络策略限制）
- 运行时性能与成本的真实数字
- `website/` 目录（独立静态官网，与主系统架构无关）
