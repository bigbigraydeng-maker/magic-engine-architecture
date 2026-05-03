# Magic Engine — Roadmap

> 最后更新：2026-05-03 · 当前阶段：**Phase 8.Q 进行中（8.Q.1✅ 8.Q.2✅ 8.Q.3部分✅）**
> 配套：[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)（产品视角）· [ARCHITECTURE.md](./ARCHITECTURE.md)（技术架构）

---

## 当前进度速览

```
✅ Phase 1-6     社媒内容矩阵（已完成）
✅ Phase 7.0     决策窗口（7/7 决策完成，2026-04-30）
✅ Phase 7.1     AI Visibility Tracker（完成，含引擎修复 E1-E5）
✅ Phase 7.2     GEO Composer（完成，P7.2.1-P7.2.18 全部交付）
✅ Phase 7.3     双信号博客生成（完成：Blog Studio + SEO Checker + GEO注入）
✅ Phase 7.4     月报 + PoC 验证（P7.4.8-P7.4.13 完成，等待追踪数据）
✅ Phase 8.6     Link Intelligence（DataForSEO 外链，2026-05-01 完成）
✅ Phase 8.7     SERP Intelligence（DataForSEO 排名追踪，2026-05-01 完成）
✅ Phase 8.8     Local Visibility（DataForSEO 本地搜索，2026-05-01 完成）
✅ Phase 8.9     Market Baseline（SEMrush 市场基准，2026-05-01 完成）
✅ Phase 8.11    Billing Monitor（DataForSEO 成本追踪，2026-05-01 完成）
✅ Phase 8.C.1   月报整合（完成，2026-05-01）
✅ Phase 8.R     Reels Studio（提示词生成 + 参考帧生成/上传 + I2V视频 + 对话修改，2026-05-02 完成）
🔄 Phase 8.Q     内容质控提升（8.Q.1外编版本管理✅ 8.Q.2 Brief编辑✅ 8.Q.3 Prompt预览部分✅ 8.Q.4待做）
📋 Phase 8.B     批量生产 + 自动排期 + 无缝发布（走向 Airtable-free 运营模式）
📋 Phase 8.M     Marketing Agent 记忆系统（每客户长期 Agent 智能化，中长期）
📋 Phase 8.D     DNZ诊断策略层（域名全量采集 → 三维策略分析 → 策略驱动执行）
📋 Phase 9       报告化 + 客户 Portal
📋 Phase 10      多语言 + Magic Lab Academy 沉淀
```

**Phase 7 核心战略**：双信号博客（Dual-Signal Blog）— 每篇文章同时携带 SEO 信号（Google 排名）和 GEO 信号（AI 推荐），选题由 AI Tracker 弱项 × SEMrush 低KD机会交叉驱动，形成数据自强化飞轮。

**Phase 8 核心战略**：DataForSEO 集成补充 SEMrush 数据缺口，构建完整 SEO 可见度体系（外链、SERP 排名、本地搜索、市场基准）。Phase 8.C.1 月报整合将 6 大数据源聚合，交付完整月度洞察报告。

---

## 1. 战略路线图

### 2026 H1（已完成 + 当前）

```
Q1: 社媒内容矩阵建设          ✅ Phase 1-6
    ├── 多客户管理
    ├── Brand Brief Studio
    ├── Campaign Studio 批量生成
    ├── Visual / Video / Avatar Studio
    ├── Content Workspace 双向同步
    └── Publishing Hub 多平台发布

Q2: GEO 核心差异化建设        🔥 Phase 7
    ├── AI Visibility Tracker
    ├── GEO Composer
    ├── 长文博客生成线
    ├── 客户接入向导
    └── PoC 验证（CTS Tours）
```

### 2026 H2（规划）

```
Q3: 诊断驱动内容策略          📋 Phase 8
    ├── DNZ 采集（客户域名全量内容快照）
    ├── 三维策略分析（现有内容 × AI弱项 × 关键词缺口）
    ├── 策略驱动的内容执行（升级页面 / 新建博客 / 社媒联动）
    └── 客户接入向导（5步建档，集成 DNZ）

Q3-Q4: 报告化 + 服务交付     📋 Phase 9
    ├── 月报 PDF 自动生成 + 邮件发送
    ├── 客户 Portal（client-facing view）
    └── 站点权威度追踪（DA / 外链 / 内链）

Q4: 沉淀 + 扩展                📋 Phase 10+
    ├── 多语言内容支持
    ├── Magic Lab Academy 课程化
    ├── 部分模块对外 SaaS（远期）
    └── Plugin（WordPress/Webflow GEO 注入）
```

---

## 2. 任务跟踪机制 ⭐（防丢任务规则）

> 用户多次反馈"Code 会丢任务"。本节是强制流程。

### 2.1 三层跟踪体系

```
ROADMAP.md（持久层 / 本文件）
   │  所有任务的源头与归宿，按 Phase 分组，含验收标准
   ↓
TodoWrite（会话层）
   │  当前会话的细粒度执行追踪
   ↓
Git Commit（事实层）
   每个完整任务一个 commit，message 引用任务 ID
```

### 2.2 任务 ID 命名规则

`P<Phase>.<Section>.<Task>` 格式：
- `P7.0.3` = Phase 7 Section 0（决策） Task 3
- `P7.1.2` = Phase 7 Section 1（AI Tracker） Task 2
- `P7.2.1` = Phase 7 Section 2（GEO Composer） Task 1

每个任务在本文件中是**可勾选 checkbox**。完成后必须立即勾选并 commit。

### 2.3 强制流程（任何 Agent 必读）

**新需求进入时**：
1. 用户提需求 → Agent 先在 ROADMAP.md 对应 Phase 下登记任务（含 ID + 验收标准）
2. 同步用 TodoWrite 创建会话级追踪
3. 然后才能开始执行

**任务执行中**：
- 一次 in_progress 一个任务（TodoWrite 强制规则）
- 遇到阻塞 → 不要硬推，回写 ROADMAP.md 标注 ⚠️Blocked + 原因

**任务完成后**：
- ROADMAP.md 中的 checkbox 改为 [x]
- TodoWrite 标记 completed
- Git commit message 包含任务 ID：`feat(ai-tracker): add OpenAI runner [P7.1.3]`

**会话结束前**：
- 检查 TodoWrite 中所有未完成项 → 必须回写 ROADMAP.md（**禁止只在 TodoWrite 里**）
- 更新 ROADMAP.md 顶部"当前进度速览"

### 2.4 用户问"现在做到哪了"时

回答模板：
```
当前 Phase: <PhaseName>
已完成：P7.1.1, P7.1.2（AI Tracker 数据库 + 问句生成）
进行中：P7.1.3（OpenAI Runner，预计今日完成）
下一项：P7.1.4（Claude Runner）
风险：<如有>
```

---

## 3. Phase 7 — GEO + AI Tracker MVP（5 周）

### 3.0 决策窗口（开工前必须完成）

**P7.0** 系列任务，全部完成才能进入 P7.1。

- [x] **P7.0.1** AI Tracker 第一版接哪 3 家 LLM？
  - ✅ **决策（2026-04-30）**：OpenAI GPT-4o + Anthropic Claude + Perplexity Sonar
- [ ] **P7.0.2** Google AI Overview 是否做？（无 API，需要 SerpAPI）
  - ⚠️ **决策（2026-04-30）**：Phase 7 暂缓，Phase 8 必做（AU/NZ 市场 Google 占 95%+，AIO 流量价值高）
- [x] **P7.0.3** 行业问句生成模式？
  - ✅ **决策（2026-04-30）**：混合模式（Strategy Engine 自动生成 + 团队编辑）
- [x] **P7.0.4** Tracker 跑频？
  - ✅ **决策（2026-04-30）**：每周一次全量追踪（20 问句 × 3 模型，周一执行）+ 手动 Run Now 按需触发
  - 理由：AI 输出有随机性，周级粒度趋势清晰；GEO 注入到 AI 反应需 2-4 周，每天追踪反而放大噪音
- [x] **P7.0.5** GEO 注入方案？
  - ✅ **决策（2026-04-30）**：A 博客内嵌 + B Snippet 复制粘贴。C 插件 Phase 10 远期再说
- [x] **P7.0.6** PoC 客户选定？
  - ✅ **决策（2026-04-30）**：CTS Tours（NZ 公司，符合 AU/NZ 市场定位），**已确认有客户网站发布权限**
- [x] **P7.0.7** 月报形态？
  - ✅ **决策（2026-04-30）**：Web 报告页（最快），PDF 导出 Phase 8

### 🌏 地域性约定（贯穿 Phase 7 全程）

> 2026 主战场：**澳大利亚（AU）+ 新西兰（NZ）**

所有 Phase 7 任务必须默认 AU/NZ 上下文：
- AI Tracker 行业问句必须带地域标签（"in New Zealand"、"for Australian travelers"）
- GEO Composer 输出指令必须含 AU/NZ 市场信号
- Keyword Intelligence 默认数据库 `au` / 客户级可覆盖 `nz`
- Brand Brief / 内容生成 Strategy Engine prompt 显式声明市场
- 时区默认 NZST / AEST

详见 [`CLAUDE.md §十二`](./CLAUDE.md)。

---

### 3.1 AI Visibility Tracker（Week 1-2）

**目标**：跑通"客户域名 → 行业问句 → 多 AI 引擎查询 → 排名表"完整链路。

**数据库（Day 1）**
- [x] **P7.1.1** 创建 3 张 Supabase 表：`ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots`
  - ✅ Migration: `supabase/migrations/20260430000002_ai_visibility_tracker.sql`
  - 包含 RLS、索引、updated_at 触发器
  - **待用户在 Supabase 控制台执行**

**问句生成（Day 2）**
- [x] **P7.1.2** `src/lib/ai-tracker/question-generator.ts` — 调 Strategy Engine 输入 Master Brief 输出 10-25 条行业问句
  - ✅ 含 AU/NZ 地域上下文强制约束
  - ✅ 5 种问题分类（comparison / how_to / recommendation / decision / discovery）
  - ✅ 类型定义追加到 `src/types/magic-engine.ts`
- [x] **P7.1.3** AI Tracker API 路由
  - ✅ `POST /api/ai-tracker/queries/generate` — Strategy Engine 生成 + 落库
  - ✅ `GET /api/ai-tracker/queries?client_id=...` — 列表
  - ✅ `POST /api/ai-tracker/queries` — 手动添加单条
- [x] **P7.1.4** 端到端验证：CTS Tours Brief → 生成有效问句
  - ✅ 2026-04-30 PoC：18 条问句生成，27.5s，成本 $0.026
  - ✅ 100% AU/NZ 地域信号（New Zealand / Kiwi / Auckland）
  - ✅ 100% AU/NZ 英语拼写（travellers / specialisation）
  - ✅ 0 条提及客户品牌名（符合"看 AI 是否自发推荐"设计）
  - ✅ 5 个分类全覆盖（comparison / how_to / recommendation / decision / discovery）
  - ✅ GET round-trip 验证 18 条已持久化到 Supabase

**LLM Runner（Day 3-5）**
- [x] **P7.1.5** `src/lib/ai-tracker/runners/openai.ts` — gpt-4o-search-preview + AU/NZ user_location
- [x] **P7.1.6** `src/lib/ai-tracker/runners/claude.ts` — claude-sonnet-4-5 + web_search_20250305 tool
- [x] ⏸ **P7.1.7** `src/lib/ai-tracker/runners/perplexity.ts` — 代码已实现（2026-05-01，见 P7.1-E3）；API key 未绑定，接入时填 PERPLEXITY_API_KEY 并将 engines 切换为 `['openai', 'perplexity', 'google']`
- [x] **P7.1.8** `src/lib/ai-tracker/parser.ts` — 自然语言回复 → BrandMention[] + client_brand_rank（已重写为 GPT-4o-mini JSON mode，见 P7.1-E1）

**编排与 API（Day 6-7）**
- [x] **P7.1.9** `src/lib/ai-tracker/orchestrator.ts` — N 问句 × 2 引擎并行车道，批量并发，全套入库 + 周快照聚合
- [x] **P7.1.10** `POST /api/ai-tracker/run` 路由 — 手动触发一轮（maxDuration 5 分钟）
- [x] **P7.1.11** `GET /api/cron/ai-tracker-weekly` 路由 — Bearer CRON_SECRET 鉴权，遍历有 enabled query 的客户

**引擎修复（Hotfix 2026-05-01）**
- [x] **P7.1-E1** `parser.ts` 重写 — 从 Claude Sonnet 切换到 OpenAI GPT-4o-mini (JSON mode)；消除每次查询双倍 Claude token 消耗，解决 30k tokens/min 速率限制根因；parser 成功率 100%，成本降低 ~10×
- [x] **P7.1-E2** `runners/gemini.ts` 新增 — Gemini 2.5 Flash + Google Search Grounding；代表 AU/NZ ~90% 搜索市场份额的 Google AI Overview；真实实时搜索结果；$0.00048/query
- [x] **P7.1-E3** `runners/perplexity.ts` 新增 — Perplexity sonar runner（OpenAI-compatible API）；API key 未配置时自动跳过；代码已就绪，接入时只需填 PERPLEXITY_API_KEY
- [x] **P7.1-E4** `orchestrator.ts` 更新 — 默认引擎切换为 `['openai', 'google']`；新增 `ENGINE_DISPLAY_NAMES` 映射（ChatGPT / Perplexity / Google AI / Claude）；Claude runner 软禁用（`AI_TRACKER_ENABLE_CLAUDE=true` 可重启）

**验证结果（2026-05-01）**：36 queries（18 × 2 engines）：OpenAI 92% 成功 ✅，Gemini 100% ✅，Parser 100% ✅，速率限制错误 0 ✅

**前端页面（Day 8-10）**
- [x] **P7.1.12** 路由 `/dashboard/ai-visibility/[clientId]` 创建 + 入口页 `/dashboard/ai-visibility`（客户选择网格）
- [x] **P7.1.13** Tab 1: Rankings Table 组件 — 周快照品牌排名，客户品牌 ⭐ 高亮，列展示各引擎分均
- [x] **P7.1.14** Tab 2: Engine Comparison 组件 — ChatGPT vs Google AI 成功率/提及率/平均排名/延迟；含最近30条运行日志
- [x] **P7.1.15** Tab 3: By AI Model 组件 — 每模型 token/成本/延迟/品牌检测率技术明细
- [x] **P7.1.16** Tab 4: Queries 管理组件 — 查询列表 + enable/disable toggle + 生成新问题 + 每条最新排名预览
- [x] **P7.1.17** ▶ Run Now 按钮 — 异步触发（最长5分钟）+ 进度反馈 + 完成后自动刷新数据
- [x] **P7.1.18** 侧边栏导航加 🤖 "AI Visibility" 菜单项

**支持 API（同步新增）**
- [x] `GET /api/ai-tracker/runs` — 客户最近 N 条 runs 列表
- [x] `GET /api/ai-tracker/snapshots` — 客户最近 N 条周快照
- [x] `PATCH /api/ai-tracker/queries/[id]` — 更新单条查询（enabled/question/notes）

**联调（Day 11-12）**
- [x] **P7.1.19** 端到端测试：CTS Tours 跑一次基线 ✅ 2026-05-01 截图验证：#1.5 avg rank，142/1000 runs，100% engine success
- [x] **P7.1.20** 数据持久化验证 ✅ snapshot 已生成，ranking_table 正确，UI 4 Tab 全部正常

**验收标准**：
- 进入客户 → AI Visibility 页 → 点 "Run Now" → 5 分钟内看到 3 家 AI 的排名表
- Cron 每周一自动跑，结果存入 snapshots
- UI 完全用对外封装名（"AI Visibility Tracker"，不出现 OpenAI/Perplexity 等）

---

### 3.2 GEO Composer（Week 3）

**目标**：基于 Brief + Tracker 弱项，自动生成 GEO 指令并提供部署 snippet。

**数据库（Day 13）**
- [x] **P7.2.1** 创建 `geo_directives` 表（schema 见 ARCHITECTURE.md §11.3）

**核心库（Day 14-15）**
- [x] **P7.2.2** `src/lib/geo/composer.ts` — GPT-4o-mini JSON 生成 + 弱项提取
- [x] **P7.2.3** `src/lib/geo/html-generator.ts` — JSON → 隐藏 div HTML（aria-hidden）
- [x] **P7.2.4** `src/lib/geo/snippet-builder.ts` — 平台 snippet（WordPress/Webflow/通用）

**API（Day 16）**
- [x] **P7.2.5** `POST /api/clients/[id]/geo/generate`
- [x] **P7.2.6** `GET /api/clients/[id]/geo`（all directives + active）
- [x] **P7.2.7** `PATCH /api/clients/[id]/geo/[directiveId]`（编辑 4 字段）
- [x] **P7.2.8** `POST /api/clients/[id]/geo/[directiveId]/activate`（原子 archive→activate）
- [x] **P7.2.9** `GET /api/clients/[id]/geo/snippet`（HTML + 平台说明）
- [x] **P7.2.10** `POST /api/clients/[id]/geo/deployments`（记录部署 URL）

**前端页面（Day 17-19）**
- [x] **P7.2.11** 路由 `/dashboard/geo-composer/[clientId]` 创建（含客户列表 landing）
- [x] **P7.2.12** 顶部状态栏（Active Directive / Deployed pages 数量）
- [x] **P7.2.13** 左侧结构化编辑器（Primary Rec / Scenarios / Audience / Competitive）
- [x] **P7.2.14** 右侧 HTML Snippet 实时预览 + 一键复制 + 安装说明
- [x] **P7.2.15** "How AI sees this" placeholder（Coming soon）
- [x] **P7.2.16** [✨ Regenerate from AI Tracker] / [From Brief only] 按钮
- [x] **P7.2.17** [Save Draft] / [⚡ Activate] 按钮（含版本历史选择器）
- [x] **P7.2.18** 侧边栏导航加 "GEO Composer 🌐" 菜单项

**验收标准**：
- 客户详情页有 GEO Tab（或独立菜单）
- 一键基于 Brief + Tracker 生成 directive
- 复制 HTML snippet 按钮可用
- 已部署页面列表（手填记录）

---

### 3.3 双信号博客生成 + Snippet 部署（Week 4）

**目标**：把 GEO 注入到实际生产内容流，建立 SEO × GEO 双信号内容飞轮。

**核心策略：双信号博客（Dual-Signal Blog）**

每篇博客同时携带两套信号，互不干扰、叠加增益：
- **SEO 信号**：关键词、meta、schema、内链 → 影响 Google 排名
- **GEO 信号**：隐藏指令块 + 实体提及 → 影响 AI 推荐

内容生成分三种模式：

| 模式 | 触发条件 | 优先级 |
|------|---------|--------|
| `unified` | AI Tracker 弱项 **且** SEMrush 有低KD量词 | ★★★ 最高 |
| `geo_only` | AI Tracker 弱项，SEMrush 无SEO价值词 | ★★☆ 中 |
| `seo_only` | 纯低KD机会词，无GEO弱项对应 | ★☆☆ 低 |

**博客选题与关键词质检（Day 20）**
- [x] **P7.3.1** `src/lib/geo/html-generator.ts` 新增 `getActiveGeoHtml(clientId)` 导出
- [x] **P7.3.2** `src/lib/blog/topic-selector.ts` — AI Tracker 弱项 × SEMrush 交叉分析，输出 `BlogOpportunity[]`（含 mode 分类）
- [x] **P7.3.3** `GET /api/clients/[id]/blog/opportunities` — 返回机会列表供编辑选题

**博客生成核心（Day 21）**
- [x] **P7.3.4** `src/lib/blog/generator.ts` — GPT-4o 长文生成（unified/geo_only 两套 prompt 策略）
- [x] **P7.3.5** `src/lib/blog/html-builder.ts` — 组装完整 HTML（meta/schema/body/GEO块）
- [x] **P7.3.6** `src/lib/blog/seo-checker.ts` — 自动计算 SEO checklist（8 项）
- [x] **P7.3.7** 新建 `blog_posts` 表（含 `mode` / `geo_directive_id` / `source_query_id` 字段）
- [x] **P7.3.8** `POST /api/clients/[id]/blog/generate`（请求体含 mode / primary_keyword / source_query_id）

**博客查看页 UI（Day 22-23）**
- [x] **P7.3.9** 路由 `/dashboard/clients/[id]/blog/[postId]` 创建
- [x] **P7.3.10** 顶部操作栏：Approve / Copy HTML / Copy Text / Regenerate / Reject
- [x] **P7.3.11** 右侧双信号 Checklist（SEO 8项 + GEO 3项）
- [x] **P7.3.12** 正文区渲染 HTML，带 "Show GEO Block" toggle（仅团队可见）
- [x] **P7.3.13** 选题面板：AI Tracker 弱项 × SEMrush 机会对照表

**内容审计（Content Audit）— 防关键词蚕食（Day 23 补充，2026-05-01）**
- [x] **P7.3.17** `src/lib/blog/content-auditor.ts` — Jina.ai 抓取客户站点 sitemap/blog，GPT-4o mini 对比 intent，返回 `upgrade | new`
- [x] **P7.3.18** `POST /api/clients/[id]/blog` 集成审计逻辑：`skip_audit` 可绕过；`action=upgrade` 时不生成新文章，返回推荐卡片
- [x] **P7.3.19** 博客列表页 `upgradeRec` 琥珀色推荐横幅：显示已有文章链接、置信度、"Generate Anyway" 按钮
- [x] **P7.3.20** `GenerateBlogRequest` 增加 `skip_audit?: boolean`；新增 `ContentAuditResult` 类型到 `magic-engine.ts`

**Snippet 部署助手（Day 24-26）**
- [ ] **P7.3.21** 路由 `/dashboard/geo-composer/[clientId]/deploy` 创建（纯前端）
- [ ] **P7.3.22** 输入要部署的页面 URL → 展示 snippet + 安装说明 + 一键标记已部署
- [ ] **P7.3.23** 已部署页面列表（调用已有 deployments API）

**验收标准**：
- 博客选题来自 AI Tracker 弱项 × SEMrush 交叉验证，有数据依据
- unified 模式文章同时通过 SEO checklist 和 GEO checklist
- 博客生成时自动注入 active GEO directive HTML
- 博客查看页有双信号 checklist 展示
- 内容审计：客户站有同类文章时提示升级而非直接生成，防止关键词蚕食
- Snippet 部署助手可用，部署记录写回 deployed_pages

---

### 3.4 月报 + PoC 验证（Week 5）

**目标**：跑完 CTS Tours 全流程，验证商业模式可行性。

**月报页面（Day 27-28）**
- [x] **P7.4.1** 路由 `/dashboard/reports/[clientId]/monthly` 创建
- [x] **P7.4.2** 第 1 节：AI 可见度总览（本月平均排名 vs 上月，带箭头）
- [x] **P7.4.3** 第 2 节：排名变化曲线（4 周折线图）
- [x] **P7.4.4** 第 3 节：GEO 部署动作（本月新部署页数 + Active version）
- [x] **P7.4.5** 第 4 节：竞品对比（top 10 问句中的排名）
- [x] **P7.4.6** 第 5 节：下月建议（Strategy Engine 自动生成）
- [x] **P7.4.7** 报告导出（HTML 截图 / PDF 二选一，先 HTML）

**CTS Tours PoC（Day 29 部署 + 后续 2-4 周观察）**
- [x] **P7.4.8** CTS Tours 加进 Magic Engine（Master Brief 完整，ID: a93c40e0，2026-05-01）
- [x] **P7.4.9** AI Visibility Tracker 跑基线（36 queries，10 runs，avg_rank 1.49，snapshot 2026-04-27）
- [x] **P7.4.10** GEO Composer 生成 v1 directive（ID: 733be532，status: active，6 scenarios，2026-05-01）
- [x] **P7.4.11** GEO snippet 已生成 + deployed_pages 登记（首页 + china-tours + china-visa + small-group-tours）
- [x] **P7.4.12** 生成 GEO 博客：
  - 小团游 vs 大巴团文章（ID: 84932691，1100词，geo_only，2026-05-01）
  - ~~259d7bc9~~ 签证文章已删除（事实错误：GPT-4o 误以为NZ仍需签证）
  - 替换文章（ID: e99d8de8，1240词，geo_only）：「新西兰人首次赴华攻略 — 30天免签完全指南」，包含已调研的正确免签政策，2026-05-01
  - **经验教训**：内容生成前需提供调研事实；对政策/法规类话题不依赖模型训练数据
- [x] **P7.4.13** 标记基线日期 + 设置每周自动追踪（2026-05-01）
  - `clients.geo_intervention_start = '2026-05-01'`（新字段，migration 20260501000003 已执行）
  - `render.yaml` 新增 `ai-tracker-weekly` Cron（每周一 01:00 UTC ≈ 周一 13:00 NZST）
  - Cron 路由 `GET /api/cron/ai-tracker-weekly` 已存在，自动处理所有有 enabled queries 的客户
- [ ] **P7.4.14** 第 2/4 周复跑 Tracker，观察排名变化
- [ ] **P7.4.15** 第 4 周生成首份月度报告

**验收标准**：
- CTS Tours 月报页可看
- 至少积累 4 周追踪数据
- **关键指标**：CTS Tours 在 ChatGPT/Claude/Perplexity 中至少 1 家排名提升 ≥ 2 位

---

### 3.5 Phase 7 总验收

- [ ] **P7.X.1** 所有上述任务完成
- [ ] **P7.X.2** UI 完全符合"对外封装名"规范（不出现真实第三方）
- [ ] **P7.X.3** PoC 数据证明 GEO 注入有效（或得出反向结论）
- [ ] **P7.X.4** 在 README / PRODUCT_OVERVIEW 中更新功能演示
- [ ] **P7.X.5** Magic Lab Academy 准备至少 1 个 GEO 实战案例文档

---

## 4. 已完成历史（Phase 1-6）

### Phase 1-3：核心引擎 ✅
- [x] 多客户管理（clients 表，per-client Content Workspace 配置）
- [x] 内容生成（Route A/B/C，Content Engine）
- [x] Visual Studio（图片生成 via Atlas Cloud）
- [x] Video Studio（视频生成 via Atlas Cloud）
- [x] 生成状态轮询 + 文件存储

### Phase 4：Content Workspace 集成 ✅
- [x] pull-content：从 Content Workspace sync 内容到主数据库
- [x] 状态过滤
- [x] Image_URL 写回
- [x] Publer_Post_ID 写回
- [x] per-client 自定义表 ID

### Phase 5：Content Workbench（主操作台）✅
- [x] 表格视图（列：Status / Format / Platform / Date / Headline / Caption / Prompt / Hashtags / Asset）
- [x] 字段点击即编辑（text / textarea / datetime / hashtags / status dropdown）
- [x] 编辑 blur 后自动保存 + 写回
- [x] Generate 按钮（自动识别 Format → 图片/视频）
- [x] 生成中进度提示 + 缩略图预览
- [x] format/ratio 字段同步驱动图片尺寸

### Phase 6：Publishing Hub + 内容板增强 ✅
- [x] Publishing Hub 账号列表、媒体上传、帖子调度
- [x] 发布时自动写回 Publer_Post_ID
- [x] Keyword Intelligence 关键词抓取
- [x] Dashboard 侧边栏导航
- [x] Keywords 页面
- [x] Analytics 页面（基础）
- [x] Campaign 内联编辑（标题/描述/日期）
- [x] Content Board 列表+日历视图，批量审批，模态编辑

---

## 5. 后续 Phase（H2 规划）

### Phase 8 — DataForSEO 集成 + 客户陪跑工作流完善（11 项）

**战略定位**：引入 DataForSEO，补充 SEMrush 的数据缺口（外链、SERP 追踪、本地 SEO、市场基线），构建完整的 SEO 可见度体系。AU/NZ 市场重点，地域性强。

#### 8.A 客户接入向导（P8.1-P8.5）

- [x] **P8.1** 客户接入向导（3 步流程：基本信息 → Airtable 配置 → SEMrush/DataForSEO 参数）✅ 2026-05-01
  - ✅ Step1BasicInfo、Step2Workspace（含 Skip）、Step3Keywords 组件
  - ✅ `POST /api/clients/onboarding/route.ts`（3 步 API）
  - ✅ Step 1 targetMarket → Step 3 defaultMarket 串联修复
  - ✅ Step 2 Airtable 步骤可 Skip（非 Airtable 客户不再卡流程）
  - ✅ Clients 列表页 "+ New Client" 跳转向导（migration 补 onboarding_completed_at 列）
  
- [ ] **P8.2** 月报导出 PDF + 邮件发送
  - 依赖 P8.6-P8.9 完成后进行
  
- [ ] **P8.3** 站点权威度追踪（DA / 外链 / 内链）
  - DataForSEO 会提供外链数据；DA 可能需要 Moz API 或 DataForSEO Rank Tracker
  
- [ ] **P8.4** 客户 Portal（client-facing view，只看自己的内容）
  - 与 P8.6-P8.11 并行开发
  
- [ ] **P8.5** Dashboard 简单鉴权（密码或 Magic Link）
  - 与其他任务并行开发

#### 8.B DataForSEO 集成核心模块（P8.6-P8.11）

> **数据架构**：DataForSEO 提供 4 大数据流，均存入 Supabase，前端通过对外封装名展示。

- [x] **P8.6** Link Intelligence（外链数据）✅ 完成 2026-05-01
  - ✅ 数据库迁移：`supabase/migrations/20260501000004_dataforseo_backlinks.sql`
  - ✅ API 客户端：`src/lib/dataforseo/client.ts`（Basic Auth 认证）
  - ✅ 数据解析器：`src/lib/dataforseo/backlinks-parser.ts`（upsert + velocity 快照）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/backlinks/sync`
  - ✅ 指标端点：`GET /api/clients/[id]/datasources/backlinks/metrics`
  - ✅ 前端页面：`src/app/dashboard/link-intelligence/page.tsx`（反链表格、同步按钮）
  - ✅ Dashboard 导航：Link Intelligence 菜单项已添加
  - ✅ 环境配置：render.yaml 已更新 DATAFORSEO_LOGIN/PASSWORD
  - **验收**：端到端流程验证 ✅（UI 正常加载、API 可调用、Supabase 表已创建）
  
- [x] **P8.7** SERP Intelligence（排名追踪）✅ 完成 2026-05-01
  - ✅ 数据库：`supabase/migrations/20260501000005_serp_rankings.sql`（serp_rankings + serp_ranking_history）
  - ✅ DataForSeoClient.getSerp() 方法实现
  - ✅ 数据解析器：`src/lib/dataforseo/serp-parser.ts`（storeSerpiData、calculateSerpTrends、getSerpMetrics）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/serp/sync`
  - ✅ 查询端点：`GET /api/clients/[id]/datasources/serp/rankings`（支持排序、分页）
  - ✅ 前端页面：`src/app/dashboard/serp-intelligence`（关键词表格、排名变化、机会识别）
  - ✅ Dashboard 导航：SERP Intelligence 菜单项已添加（📈 emoji）
  - **验收**：支持 100+ 关键词追踪、4 周趋势计算、Top 10/50 分类 ✅
  
- [x] **P8.8** Local Visibility（本地搜索可见度）✅ 完成 2026-05-01
  - ✅ 数据库：`supabase/migrations/20260501000006_local_serp_rankings.sql`（local_serp_rankings + local_ranking_history + local_cities 预填充）
  - ✅ AU 城市：Sydney (2036), Melbourne (2157), Brisbane (2174), Perth (2190), Adelaide (2091), Hobart (2147), Gold Coast (2171), Canberra (2099)
  - ✅ NZ 城市：Auckland (2554), Wellington (2579), Christchurch (2555), Dunedin (2556), Hamilton (2557), Tauranga (2558)
  - ✅ DataForSeoClient.getLocal() 方法实现（Local Pack API）
  - ✅ 数据解析器：`src/lib/dataforseo/local-parser.ts`（storeLocalData、calculateLocalTrends、getLocalMetrics）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/local/sync`（多城市并行同步）
  - ✅ 查询端点：`GET /api/clients/[id]/datasources/local/rankings`（按城市分组、支持排序）
  - ✅ 前端页面：`src/app/dashboard/local-visibility`（城市选择器、指标卡片、排名表格、机会识别）
  - ✅ Dashboard 导航：Local Visibility 菜单项已添加（🗺️ emoji）
  - **验收**：支持 AU/NZ 8+6 城市、28 天趋势计算、新/失排名检测、Top 10/50 分类 ✅
  
- [x] **P8.9** Market Baseline（市场基准数据）✅ 完成 2026-05-01
  - ✅ 数据库：`supabase/migrations/20260501000007_market_baseline.sql`（market_baseline + market_comparison）
  - ✅ Semrush 集成：`src/lib/semrush/market-baseline.ts`（getIndustryBaseline、calculateMarketComparison、storeMarketBaseline、storeMarketComparison、getMarketMetrics）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/market/sync`（拉取 Semrush 数据、计算行业对标）
  - ✅ 查询端点：`GET /api/clients/[id]/datasources/market/rankings`（按关键词返回对标数据、支持分页）
  - ✅ 前端页面：`src/app/dashboard/market-baseline/page.tsx`（机会评分卡片、Top Opportunities 表、Underperformers 列表、完整关键词对标表）
  - ✅ Dashboard 导航：Market Baseline 菜单项已添加（📊 emoji）
  - **验收**：支持 100+ 关键词对标、机会评分 0-100、竞争强度分类（领先/持平/落后）✅
  
- [ ] **P8.10** (待定 — 可能是 DataForSEO 成本优化或其他功能)
  - 暂预留
  
- [x] **P8.11** Billing Monitoring（DataForSEO 成本追踪）✅ **2026-05-01 完成**
  - 数据库：创建 `datasource_usage_logs` 表（client_id, service, api_calls, cost_usd, month）✅
  - 用途：按客户、按服务、按月追踪 DataForSEO 的 API 成本 ✅
  - API：`GET /api/admin/billing/datasources?month=` — 成本汇总，支持降级回退（测试环境样本数据）✅
  - 前端：`/dashboard/admin/billing-monitor` 页面（仅管理员可见，展示所有客户的 DataForSEO 成本）✅
  - E2E 测试：11 个 billing monitor 测试，31/31 Phase 8 E2E 测试通过 ✅
  - **验收**：✅ 能按客户、按月查看 DataForSEO 成本，用于计费和成本优化；E2E 测试全覆盖
  - **提交**：be9e259（API 修复）+ 17e301e（E2E 测试）+ 4362658（仪表板重构）

#### 8.C 跨界整合（与 Phase 7 联动）

- [x] **P8.C.1** 月报（P7.4.1-P7.4.7）扩展，纳入 P8.6-P8.11 数据 ✅ **2026-05-01 完成**
  - ✅ 后端：`monthly-aggregator.ts` 新增 5 个 Phase 8 接口类型 + 5 个独立 collector 函数（Promise.allSettled 并行，单个失败不影响其他）
  - ✅ 前端：`_components/Shared.tsx`（KpiCard/SectionHeader/EmptyState）+ 5 个 Panel 组件（Link/Search/Local/Market/Usage）
  - ✅ 月报页从 5 节扩展为 10 节，所有 Phase 8 节空数据时优雅降级（中文空态提示）
  - ✅ DataSourceUsagePanel 使用 `SERVICE_DISPLAY_MAP` 映射，不暴露真实供应商名
  - ✅ 构建通过（npm run build ✓），TypeScript strict 编译无错
  - **数据源**：
    1. AI Visibility Tracker（Phase 7.1 orchestrator）
    2. Link Intelligence（P8.6 外链数据）
    3. SERP Intelligence（P8.7 排名追踪）
    4. Local Visibility（P8.8 本地搜索）
    5. Market Baseline（P8.9 市场基准）
    6. Billing Monitor（P8.11 成本追踪）
  
- [ ] **P8.C.2** GEO Composer（Phase 7）+ DataForSEO 数据闭环
  - 基于 Market Baseline（P8.9）优化 GEO 指令
  
---

#### Phase 8  总体排期

```
Week 1-2: P8.1 ESLint fix + Dashboard 集成
Week 2-3: P8.6 Link Intelligence 核心开发
Week 3-4: P8.7 SERP Intelligence + P8.8 Local Visibility 并行
Week 4-5: P8.9 Market Baseline + P8.11 Billing Monitor
Week 5-6: P8.4-P8.5 鉴权 + Portal 联调
Week 6-7: P8.2 月报 PDF + 邮件
Week 7: 联调验证 + PoC 更新
```

---

#### DataForSEO API 集成清单

**需要的环境变量**：
- `DATAFORSEO_LOGIN`
- `DATAFORSEO_PASSWORD`

**API 模块**：
- `src/lib/dataforseo/client.ts` — API 认证 + 基础请求
- `src/lib/dataforseo/backlinks.ts` — Link Intelligence（P8.6）
- `src/lib/dataforseo/serp.ts` — SERP Tracking（P8.7）
- `src/lib/dataforseo/local.ts` — Local Pack（P8.8）
- `src/lib/dataforseo/parser.ts` — 响应解析 + Supabase 落库

**UI 封装名规范**（必须）：
- DataForSEO → "Link Intelligence" / "SERP Intelligence" / "Local Visibility" / "Market Baseline"
- 不允许在任何用户可见界面出现 "DataForSEO" 字样

---

### Phase 8.D — DNZ 诊断驱动内容策略 ⭐（规划中）

> **设计背景（2026-05-01 确立）**
>
> CTS Tours PoC 过程中发现根本问题：Magic Engine 在不了解客户已有什么内容的情况下直接生成博客，
> 导致两个缺陷：① 可能与客户现有页面形成关键词蚕食；② 无法判断是升级已有页面还是新建内容。
>
> 解决方案：**先诊断，再生成**。所有内容执行都应由数据驱动的策略层输出，而不是凭感觉选题。

**三层架构**：

```
Layer 1: DNZ 采集（Domain Network Zone）
   客户域名全量内容快照 → 知道"客户已有什么"

Layer 2: 三维策略分析
   现有内容 × AI弱项（Tracker）× 关键词缺口（SEMrush）
   → 输出：每个机会的类型（升级/新建/社媒）+ 优先级评分

Layer 3: 策略驱动执行
   按策略面板点击生成：上下文注入、防重叠、类型匹配
```

---

#### Phase 8.0 — DNZ 采集基础设施

**目标**：能够抓取客户域名上的所有页面，并将其内容结构化存储，作为后续分析的基础。

- [ ] **P8.0.1** 新建 `client_site_pages` 表 + 迁移文件（见 ARCHITECTURE.md §3.6）
- [ ] **P8.0.2** `src/lib/site-audit/crawler.ts` — sitemap.xml 解析 → 提取所有 URL，对每个 URL 调用 Jina.ai 抓取正文
- [ ] **P8.0.3** `src/lib/site-audit/classifier.ts` — GPT-4o mini 分类：页面类型（服务/博客/关于/首页）+ 话题标签 + 主关键词推断
- [ ] **P8.0.4** `POST /api/clients/[id]/site-audit/crawl` — 触发全站采集（异步，支持限速，每次最多 100 页）
- [ ] **P8.0.5** `GET /api/clients/[id]/site-audit/pages` — 列出已采集页面（支持 type / topic 筛选）
- [ ] **P8.0.6** UI：`/dashboard/clients/[id]/site-audit` — 采集进度条 + 已采集页面表格（URL / 类型 / 话题 / 字数 / GEO块是否存在）

**验收标准**：
- 输入 ctstours.co.nz，能抓取 ≥ 30 个页面并完成分类
- 每个页面有：url、page_type、topics[]、primary_keyword、word_count、has_geo_block

---

#### Phase 8.1 — 三维内容策略分析

**目标**：将 DNZ 采集结果、AI 弱项、关键词缺口三维交叉，输出有数据依据的优先级策略列表。

- [ ] **P8.1.1** 新建 `content_strategy_items` 表 + 迁移文件（见 ARCHITECTURE.md §3.7）
- [ ] **P8.1.2** `src/lib/strategy/analyzer.ts` — 三维交叉逻辑：
  - 维度A：AI Tracker 弱项（brand_rank = null 或 rank > 3 的 query）
  - 维度B：SEMrush 关键词缺口（竞品排名的词，客户没有对应页面）
  - 维度C：客户现有页面内容薄弱点（word_count < 500 或无 GEO 块）
- [ ] **P8.1.3** `src/lib/strategy/scorer.ts` — 优先级评分：
  - `unified` 机会（AI弱项 + SEO缺口同时满足）：最高分
  - `geo_only` 机会（AI弱项，但 SEO 价值低）：中分
  - `upgrade` 机会（已有页面，但内容薄弱 / 缺 GEO 块）：视缺口大小评分
- [ ] **P8.1.4** `POST /api/clients/[id]/strategy/generate` — 触发一次完整策略分析，写入 content_strategy_items
- [ ] **P8.1.5** `GET /api/clients/[id]/strategy` — 返回策略列表（按 priority_score 降序）
- [ ] **P8.1.6** UI：`/dashboard/clients/[id]/strategy` — 策略面板：
  - 顶部：三维覆盖热力图（哪些话题 AI弱项 + SEO有价值 + 无现有内容）
  - 主列表：每条推荐有 Action Type 标签（🔄 升级 / ✨ 新建 / 📱 社媒）、优先级、理由
  - 每条可点击执行 → 跳转到对应的生成流程

**验收标准**：
- 对 CTS Tours 跑分析，输出 ≥ 10 条策略建议，每条有 action_type + priority_score + rationale
- "升级现有页面" 类型的推荐中，能关联到 client_site_pages 中的具体页面

---

#### Phase 8.2 — 策略驱动的内容执行

**目标**：所有内容生成都通过策略面板触发，携带完整上下文（现有内容 + 关键词 + AI弱项），消除盲目生成问题。

- [ ] **P8.2.1** 博客生成注入 `existing_pages_context`：生成前把话题相关的 client_site_pages 内容摘要注入 prompt，让 GPT-4o 写不同角度而非重叠内容
- [ ] **P8.2.2** 升级现有页面流程：抓取原文 → Strategy Engine 生成 SEO + GEO 增强版 → UI 展示 diff 对比（原文 vs 升级版）→ 客户一键批准
- [ ] **P8.2.3** 内容审计范围扩展：将现有 `content-auditor.ts` 的扫描范围从 blog 路径扩展到全站 `client_site_pages`（已在 Phase 8.0 采集）
- [ ] **P8.2.4** 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn）

**验收标准**：
- 从策略面板点击生成一篇博客，prompt 中包含话题相关的现有页面摘要
- 升级流程可展示 diff，客户操作后写入 blog_posts（mode = 'seo_only' 或 'unified'）

---

#### Phase 8.3 — 客户接入向导（集成 DNZ）

**目标**：5 分钟完成新客户建档，DNZ 采集作为标准步骤嵌入，确保每个客户上线前即有内容现状数据。

- [ ] **P8.3.1** 向导 `/dashboard/clients/new`：Step 1 基本信息 → Step 2 上传 Brief 文件 → Step 3 触发 DNZ 采集 → Step 4 审核采集结果 → Step 5 激活（生成 Master Brief + active GEO Directive）
- [ ] **P8.3.2** Dashboard 简单鉴权（Magic Link，防止数据泄露）

**验收标准**：
- 全程 < 10 分钟完成新客户建档
- 建档完成后，客户主页显示：DNZ采集状态、已采集页面数、Master Brief 状态、GEO Directive 状态

---

### Phase 9 — 报告化 + 客户交付

- [ ] **P9.1** 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图）
- [ ] **P9.2** 客户 Portal（client-facing view，只看自己内容 + 当月月报）
- [ ] **P9.3** 站点权威度追踪（DA / 外链 / 内链趋势）
- [ ] **P9.4** Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议
- [ ] **P9.5** 批量执行：一键为所有 approved 策略条目生成对应内容

### Phase 10 — 平台扩展与沉淀

- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持（中文市场优先）
- [ ] **P10.3** Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做）

---

## 6. 技术债

### 既有技术债
- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）

### P8.C.1 月报聚合器引入的技术债（后续补齐）

**聚合器核心库**
- [ ] **TD.7** 收集器模块（6 个）缺少错误重试机制
  - 当前：单次调用失败直接返回空数据
  - 待补：Exponential backoff + 3 次重试 + 降级策略
  - 优先级：MEDIUM（Phase 8.C.1 MVP 不影响，Phase 9 前必须做）

- [ ] **TD.8** 月报聚合库缺少事务型一致性保证
  - 当前：6 个收集器独立落库，无全局事务
  - 待补：Supabase transaction 或消息队列确保一致性
  - 优先级：HIGH（数据不一致会导致报告错误，应在 Phase 8.C.1 后期补）

- [ ] **TD.9** 聚合器性能未优化（N+1 查询）
  - 当前：逐个数据源查询，串行执行
  - 待补：并行化 + JOIN 优化 + Redis 缓存 30 min
  - 优先级：MEDIUM（现阶段 <10 客户无压力，>50 客户前必须优化）

**API 端点**
- [ ] **TD.10** 月报查询端点缺少分页 / 排序参数
  - 当前：返回全量数据
  - 待补：支持 limit / offset / sort_by / order
  - 优先级：LOW（MVP 可不做，UI 下个迭代加）

- [ ] **TD.11** API 缺少速率限制（Rate Limit）
  - 当前：无限制调用
  - 待补：每客户 100 req/min（Phase 8.C.2 前做）
  - 优先级：MEDIUM

**前端 UI**
- [ ] **TD.12** 月报页面缺少加载骨架屏（loading skeleton）
  - 当前：空白等待，UX 差
  - 待补：各分节加 skeleton loader（Tailwind 实现）
  - 优先级：LOW（可在 Phase 8.C.2 优化）

- [ ] **TD.13** 分节组件之间缺少交互（drill-down / tooltip）
  - 当前：静态卡片展示，难以深入分析
  - 待补：点击链接到各模块详情页、Hover tooltip 显示计算逻辑
  - 优先级：LOW（Phase 9 增强）

- [ ] **TD.14** 月报导出功能（PDF / 邮件）未实现（P8.2 任务）
  - 当前：无导出
  - 待补：HTML → PDF 通过 headless browser；邮件模板 + Sendgrid 集成
  - 优先级：HIGH（P8.2 单独任务，排期 Phase 8.C.2 后）

**测试覆盖**
- [ ] **TD.15** 聚合器单元测试覆盖率 < 70%
  - 当前：仅端到端测试
  - 待补：Mock 各数据源，添加 20+ 单元用例
  - 优先级：HIGH（应在 Phase 8.C.1 完成前补，目标 80%+）

- [ ] **TD.16** 未做月报端到端测试（CTS Tours 实际客户）
  - 当前：样本数据验证
  - 待补：真实客户 1 个月数据 round-trip 验证
  - 优先级：MEDIUM（可在 Phase 8.C.2 进行）

**文档与监控**
- [ ] **TD.17** 聚合器架构文档缺失
  - 当前：代码注释零散
  - 待补：ARCHITECTURE.md 新增 §13 月报聚合架构
  - 优先级：LOW（Phase 9 前完成）

- [ ] **TD.18** 缺少聚合器性能 / 错误监控仪表板
  - 当前：无实时监控
  - 待补：Datadog / Sentry dashboard（成本 → Phase 10）
  - 优先级：LOW（Phase 9+ 考虑）

---

## 7. 风险跟踪

| 风险 | 影响 | 缓解策略 | 负责人 |
|------|------|---------|--------|
| Google 判定 GEO 隐藏指令为 cloaking | GEO 失效 | 用 aria-hidden 标准做法；持续监测 SEO 流量 | 产品 |
| AI 引擎升级识别 prompt injection | GEO 价值下降 | 是赛跑窗口；同步研究 Schema.org 等替代方案 | 产品 |
| Perplexity API 限流或涨价 | Tracker 成本上升 | 准备 SerpAPI 备选；本地缓存 7 天 | 开发 |
| PoC 客户排名无显著提升 | 商业模式不成立 | 调整 GEO 策略；可能改打"内容生产效率"卖点 | 产品 |
| 当前未做用户认证 | 数据安全风险 | Phase 8 引入简单鉴权；陪跑模式下风险可控 | 开发 |

---

## 8. 决策日志

> 重大决策记录在此，便于追溯。

### 2026-04-30
- **战略**：确定 Magic Engine 三大核心：SEO + GEO + 社媒内容矩阵；GEO 为 2026 Q2 核心差异化
- **商业模式**：年度陪跑服务（5–15 万/客户/年），不做 SaaS 月费
- **目标市场** ⭐：2026 主战场 = 澳大利亚（AU）+ 新西兰（NZ）；地域性强，所有功能必须默认 AU/NZ 上下文
- **品牌封装**：第三方供应商封装规范（详见 CLAUDE.md §三）
- **Phase 7 决策（开工前）**：
  - P7.0.1 ✅ AI Tracker 接 OpenAI + Claude + Perplexity
  - P7.0.2 ⚠️ Google AIO 暂缓到 Phase 8（AU/NZ 市场必做）
  - P7.0.3 ✅ 问句生成混合模式
  - P7.0.4 ✅ Tracker 跑频每周一次（周一全量 + 手动 Run Now）
  - P7.0.5 ✅ GEO 注入方案 A + B
  - P7.0.6 ✅ PoC 客户 CTS Tours（含发布权限）
  - P7.0.7 ✅ 月报形态 Web 报告页

---

## Phase 8.Q — 内容质控提升（System Design Audit 缺口修复）

> **背景（2026-05-03 确立）**
>
> 系统设计评审（SYSTEM_DESIGN_AUDIT.md）识别出 6 大缺口，影响内容管理的生产级能力：
> 1. 🔴 外编版本管理：支持下载→编辑→上传→版本记录（最高优先级）
> 2. 🟡 Visual Brief 编辑：Launch Hub 可编辑 visual_brief 后重新生成图片
> 3. 🟡 Prompt 预览编辑：Campaign 生成前展示 prompt，允许修改后再执行
> 4. 🟡 Brief 版本锁定：content_posts 记录生成时的 brief 快照
>
> Phase 8.Q 优先修复 🔴 高优先级缺口，逐步补全中优先级项。

---

### Phase 8.Q.1 — 外编版本管理（🔴 最高优先级）

**目标**：为 visual_assets 建立完整的版本历史，支持"下载 → 外部编辑 → 上传最终版"完整工作流。

**数据库（Day 1）**
- [x] **P8.Q.1** 新建 `visual_asset_versions` 表 + 迁移文件 ✅ 2026-05-03
  ```sql
  CREATE TABLE visual_asset_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
    version_num INT NOT NULL DEFAULT 1,
    storage_url TEXT NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'user:<email>'
    edit_type TEXT NOT NULL DEFAULT 'ai_generated',
    -- 'ai_generated' | 'external_edit' | 'manual_replacement'
    edit_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE visual_assets
    ADD COLUMN current_version_num INT DEFAULT 1,
    ADD COLUMN is_final BOOLEAN DEFAULT false,
    ADD COLUMN external_edit_status TEXT;
    -- null | 'needs_external_edit' | 'in_external_edit' | 'final'
  ```
- [x] **P8.Q.2** 回填现有 `visual_assets` 数据：为每条已有 storage_url 创建 version_num=1 的历史记录 ✅ 2026-05-03（migration 含回填 SQL）

**API 层（Day 2-3）**
- [x] **P8.Q.3** `GET /api/visual-assets/[assetId]/versions` — 返回版本历史列表 ✅ 2026-05-03
- [x] **P8.Q.4** `POST /api/visual-assets/[assetId]/upload-version` — 上传新版本 ✅ 2026-05-03
  - 创建 `visual_asset_versions` 记录（version_num 自增）
  - 更新 `visual_assets.storage_url` + `current_version_num` + `is_final=true`
  - `edit_type='external_edit'`，记录 `edit_notes`
- [x] **P8.Q.5** `PATCH /api/visual-assets/[assetId]/edit-status` — 更新外编状态 ✅ 2026-05-03
  - `{ status: 'needs_external_edit' | 'in_external_edit' | 'final' }`

**前端 UI（Day 4-6）**
- [x] **P8.Q.6** Launch Hub 表格 Asset 列改造 ✅ 2026-05-03
  - 「⬇ Download」按钮 — 下载当前版本
  - 「✏ Mark for External Edit」按钮 — 更新状态为 `needs_external_edit`（行变灰显示"外编中"标签）
  - 「⬆ Upload Final Version」按钮（外编状态中可用）— 触发 P8.Q.4 API
  - 「🔢 v{n}」版本徽章 — 显示当前版本号，点击展开版本历史 modal
- [x] **P8.Q.7** 版本历史 Modal：时间线展示所有版本（时间、类型、操作者），点击可预览或恢复特定版本 ✅ 2026-05-03
- [x] **P8.Q.8** Publer 排期时自动选 `is_final=true` 的版本（`publer/create-post` route 更新筛选逻辑）✅ 2026-05-03

**验收标准**：
- 一条 AI 生成图片的 asset，能完整走通：下载 → 标记外编 → 上传最终版 → 版本历史记录正确
- Publer 排期时，自动取 is_final=true 的版本而非最新生成版本
- 版本历史 Modal 能看到完整历史记录

---

### Phase 8.Q.2 — Visual Brief 编辑（🟡 中优先级）

**目标**：Launch Hub 允许用户编辑 `visual_brief` 后重新生成图片，而不需要回到 Campaign 页面。

- [x] **P8.Q.9** `Launch Hub` 视觉资产行新增「✏ Edit Brief」按钮 ✅ 2026-05-03
  - 点击展开 inline 编辑框，加载 `content_posts.visual_brief`
  - 用户修改后出现「🔄 Regen with new prompt」按钮（`dirtyBriefs` 集合驱动）
  - 更新 `content_posts.visual_brief` 到 Supabase，Regen 时清除 dirty 标记
- [ ] **P8.Q.10** Reels Studio 参考帧区域：Opening/Closing Prompt 均支持直接编辑 + 重新生成（已部分实现，确认完整性）

**验收标准**：
- 在 Launch Hub 中修改 visual_brief 后，点击 Regenerate 能生成新图片
- 新图片作为新 asset 或替换当前 ready asset（version 记录）

---

### Phase 8.Q.3 — Prompt 预览与编辑（🟡 中优先级）

**目标**：Campaign 批量生成前，让用户看到将要使用的 prompt，并允许修改。

- [x] **P8.Q.11** Campaign 生成按钮改为"预览 Prompt → 确认生成"两步流程 ✅ 2026-05-03
  - 新建 `POST /api/clients/[id]/campaign/[campaignId]/preview-prompt`（运行关键词/话题规划，返回 system_prompt + per-post user_prompts）
  - `PromptPreviewModal.tsx`：全屏遮罩，可编辑 system prompt + 每条 user prompt
  - `batch-generate` 支持 `prompt_overrides`（用户修改后的 prompt 覆盖）
- [ ] **P8.Q.12** 新建 `prompts` 表（存储历史使用过的 prompt，供分析和优化）
  ```sql
  CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id),
    stage TEXT NOT NULL,  -- 'campaign' | 'visual' | 'blog' | 'reels'
    prompt_text TEXT NOT NULL,
    variables JSONB,  -- { brief_id, campaign_id, keyword, ... }
    used_count INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE content_posts ADD COLUMN prompt_id UUID REFERENCES prompts(id);
  ```
- [ ] **P8.Q.13** 博客生成流程同样引入"Prompt 预览"步骤（Blog Studio 生成前展示 prompt）

**验收标准**：
- Campaign 批量生成时，展示 prompt 预览 modal，用户可修改后确认
- 每次生成都记录到 prompts 表，可追溯

---

### Phase 8.Q.4 — Brief 版本锁定（🟡 中优先级）

**目标**：每条 content_post 记录生成时的 Master Brief 快照 ID，确保回溯一致。

- [ ] **P8.Q.14** `content_posts` 表新增 `master_brief_version_id UUID REFERENCES master_briefs(id)`
- [ ] **P8.Q.15** Campaign 生成时注入当前 active brief ID 到 content_post 记录
- [ ] **P8.Q.16** Brief 变更时，提示"有 X 条帖子使用旧版 Brief，是否重新生成？"

**验收标准**：
- 每条 content_post 可追溯到生成时的 brief 版本
- 若 brief 更新，系统能识别哪些内容基于旧版本

---

## Phase 8.B — 批量生产 + 自动排期 + 无缝发布

> **背景（2026-05-03 确立）**
>
> 当前工作流仍依赖 Airtable 做内容审批和内容日历。随着 Magic Engine 功能成熟，
> 核心目标是构建**全 ME 原生**的批量生产→审批→排期→自动发布流程：
>
> ```
> Campaign 批量生成 → Launch Hub 批量生成图片
>   → ME 原生审批（不依赖 Airtable）
>   → 设置排期日历
>   → 系统自动 → Publer 发布
>   → ME 收到发布回调，标记完成
> ```
>
> 这是走向「设定好排期，让系统自己跑」的关键阶段。Airtable 保留为可选输入渠道，
> 但不再是唯一的审批和排期通道。

---

### Phase 8.B.1 — 客户平台配置

**目标**：每个客户可独立配置社媒平台偏好、默认发布时间等，为批量排期提供基础。

- [ ] **P8.B.1** `clients` 表新增平台配置字段
  ```sql
  ALTER TABLE clients
    ADD COLUMN platforms TEXT[] DEFAULT ARRAY['instagram', 'facebook'],
    ADD COLUMN default_post_time TIME DEFAULT '09:00:00',  -- 客户时区的默认发布时间
    ADD COLUMN posting_timezone TEXT DEFAULT 'Pacific/Auckland',
    ADD COLUMN posting_frequency TEXT DEFAULT 'daily';  -- 'daily' | '3x_week' | 'weekly'
  ```
- [ ] **P8.B.2** 客户详情页（`/dashboard/clients/[id]`）新增"平台设置"Tab
  - 选择平台（Instagram / Facebook / LinkedIn / TikTok）
  - 配置默认发布时间 + 时区
  - 配置发布频率
- [ ] **P8.B.3** API：`PATCH /api/clients/[id]/platform-settings` — 保存平台配置

**验收标准**：
- 每个客户有独立的平台和发布时间配置
- 后续批量排期时能自动读取这些配置

---

### Phase 8.B.2 — Launch Hub 批量图片生成

**目标**：在 Launch Hub 中，可以一次性选中多条帖子批量生成图片，而不是逐条点击。

- [ ] **P8.B.4** Launch Hub 表格新增行选择（复选框）
- [ ] **P8.B.5** 顶部工具栏"批量操作"区：
  - 「🖼 批量生成图片」— 对选中的所有 `visual_brief` 非空且无 ready asset 的帖子触发生成
  - 「📅 批量设置排期」— 对选中的 approved 帖子批量设置发布时间
  - 「✅ 批量审批」— 对选中的 draft/pending 帖子一键审批
- [ ] **P8.B.6** 批量生成进度展示：生成中的条目显示 spinner，完成后实时更新缩略图（轮询或 Supabase realtime）
- [ ] **P8.B.7** API：`POST /api/visual/batch-generate` — 接收 `post_ids[]`，对每条异步触发生成（已有单条接口，包装为批量）

**验收标准**：
- 选中 10 条帖子，点"批量生成图片"，系统自动并发触发（最多 3 条同时进行，控制成本）
- 生成完成后，缩略图在 Launch Hub 实时更新

---

### Phase 8.B.3 — ME 原生审批工作流

**目标**：在 Magic Engine 内完成内容审批，无需依赖 Airtable 或 Zapier。Airtable 保留为可选渠道。

- [ ] **P8.B.8** `content_posts` 状态机完整实现（已有 draft/approved/rejected，补充 review_requested）
  - `draft` → `review_requested`（提交审核）→ `approved` 或 `rejected`
  - 支持 `revision_notes` 字段（拒绝时写明原因）
- [ ] **P8.B.9** Launch Hub 审批操作列：
  - 「✅ 审批」按钮（当前状态：draft/review_requested）
  - 「❌ 拒绝」按钮（弹窗填写 revision_notes）
  - 「📝 修改」直接编辑 caption/hashtags（已有功能，确认完整性）
- [ ] **P8.B.10** Content Board 页面新增审批视图（按 status 分列的看板视图，类似 Kanban）
  - 列：Draft → Review → Approved → Scheduled → Published
  - 拖拽卡片可更新状态
- [ ] **P8.B.11** 审批后自动触发工作流（已有逻辑，确认触发链完整）：
  - `approved` → 检查是否有 ready asset → 若有则推 Publer → 若无则先生成图片

**验收标准**：
- 全程在 ME 完成：内容生成 → 审批 → 自动推送 Publer，无需打开 Airtable
- Kanban 视图可拖拽更新帖子状态

---

### Phase 8.B.4 — 内容日历与自动排期

**目标**：可视化内容发布日历，支持手动和自动排期，让团队一目了然看到每天发什么。

- [ ] **P8.B.12** 新路由 `/dashboard/content-calendar/[clientId]` — 月历视图
  - 每天的格子显示当天的帖子（已排期 / 已发布）
  - 颜色区分：蓝=待发布 / 绿=已发布 / 灰=草稿
  - 点击日期可快速新建帖子排期
- [ ] **P8.B.13** API：`GET /api/clients/[id]/content-calendar?month=2026-05` — 返回该月所有 content_posts（含 scheduled_at）
- [ ] **P8.B.14** 排期操作：
  - 批量自动排期：读取客户 `posting_frequency` + `default_post_time`，为所有 approved 帖子按频率自动分配 `scheduled_at`
  - 单条拖拽排期：在日历上拖拽帖子到目标日期
  - 一键推送：「🚀 推送所有排期」→ 对所有 `approved` 且 `scheduled_at` 已设置的帖子调用 Publer
- [ ] **P8.B.15** 侧边栏导航加 📅 "Content Calendar" 菜单项

**验收标准**：
- 月历视图正确显示所有已排期内容
- "批量自动排期"按钮能按配置的频率为 approved 帖子分配发布时间
- "一键推送"能将所有排期内容推送到 Publer

---

### Phase 8.B.5 — 视频上传支持

**目标**：Launch Hub 支持上传外部剪辑好的视频（替代只能 AI 生成视频的限制）。

- [ ] **P8.B.16** Launch Hub 视频格式帖子（`format=video`）的 Asset 列，增加"⬆ Upload Video"按钮
  - 支持 MP4/MOV，最大 500MB
  - 上传到 Supabase Storage `visual-assets/{client_id}/{post_id}/`
  - 创建 `visual_assets` 记录（`asset_type='video'`, `generation_status='ready'`）
- [ ] **P8.B.17** 上传进度条（大文件上传体验）
- [ ] **P8.B.18** 上传完成后，视频缩略图在 Launch Hub 实时展示（使用 HTML video 第1帧）

**验收标准**：
- 上传一个 MP4 视频，Launch Hub 显示视频缩略图
- 推送到 Publer 时，使用该上传视频（而非 AI 生成版本）

---

### Phase 8.B.6 — Airtable 依赖解耦（可选渐进式）

> 此阶段不是"删除 Airtable"，而是让 Airtable 成为**可选**渠道，而非必须路径。

- [ ] **P8.B.19** 审查所有 Airtable 写回逻辑，标记为"可选 best-effort"（已有 `.catch()` 静默失败，确认覆盖完整）
- [ ] **P8.B.20** `clients` 表新增 `airtable_enabled BOOLEAN DEFAULT true`
  - 客户配置页可关闭 Airtable 同步
  - 所有写回逻辑在 `airtable_enabled = false` 时跳过
- [ ] **P8.B.21** 发布成功回调（`/api/webhooks/publer-published`）：移除对 Airtable 写回的强依赖，改为纯 Supabase 更新
- [ ] **P8.B.22** 审批 webhook（`/api/webhooks/airtable-approved`）：保留兼容，但 ME 原生审批（P8.B.9）不经过此路由

**验收标准**：
- 将一个测试客户的 `airtable_enabled` 设为 false，从内容生成到发布全链路不报错
- Airtable 写回失败时，主流程不受影响

---

## Phase 8.M — Marketing Agent 记忆系统（中长期）

> **背景（2026-05-03 规划）**
>
> 当前 Claude Sonnet 作为无状态 API 调用——每次调用都是全新对话，不记得上次生成了什么，
> 不知道这个客户哪类内容表现好，不会随时间改善对客户品牌的理解。
>
> Marketing Agent 记忆系统让每个客户拥有一个"长期 Agent"，随时间积累品牌知识、
> 学习成功模式，下一次生成时自动注入最优上下文。

- [ ] **P8.M.1** DB：新建 `agent_profiles` 表（每客户一个，存 personality_notes + learned_preferences）
- [ ] **P8.M.2** DB：新建 `agent_conversations` 表（存对话历史，按 context 分类：brief_refinement / campaign_planning / strategy_review）
- [ ] **P8.M.3** DB：新建 `agent_learnings` 表（存从已发布内容中学到的成功模式）
- [ ] **P8.M.4** `POST /api/clients/[id]/agent/learn` — 定期（每月）分析已发布内容表现，更新 agent_learnings
- [ ] **P8.M.5** 在 Campaign 生成 prompt 中注入 agent_learnings（高表现内容特征作为参考）
- [ ] **P8.M.6** 在 Master Brief 精炼对话（BriefChat）中加载历史对话上下文（agent_conversations）
- [ ] **P8.M.7** 客户详情页新增"Agent Profile" Tab：展示 Agent 学到了什么、成功模式、对话历史

**验收标准**：
- 系统能记住"这个客户的 Instagram 帖子平均点赞最高的是问答型文案 + 人物照片"
- 下一次生成 Campaign 时，这个偏好自动体现在 prompt 中

---

## Phase 8.R — Reels Studio（2026-05-02 开始）

> **背景**：用户在 Loveart 中用 Nano Banana（Google Imagen）生成参考图，在 Atlas Cloud 用 Seedance 2.0 I2V 做视频。
> Reels Studio 打通从「提示词生成 → 上传参考帧 → 触发 I2V → 生成 FB 标题」的全链路。
>
> **对外封装名**：Video Studio（沿用），不暴露 Seedance / Atlas。

### 设计约束
- 一次生成一条（控制成本，I2V ~0.022 USD/秒）
- 以 Master Brief + Campaign Brief 为上下文生成提示词
- 支持对话式修改（修改某个字段而不重新生成全部）
- 参考帧由用户在 Loveart 生成后手动上传
- 视频生成用 Atlas `bytedance/seedance-2.0-fast/image-to-video`

### 任务列表

- [x] **P8.R.1** ROADMAP.md 登记 Reels Studio（2026-05-02）
- [x] **P8.R.2** DB Migration：`reels_drafts` 表 + `visual_assets.post_id` 可空
  - ✅ `supabase/migrations/20260502000002_create_reels_studio.sql` — **⚠️ 需在 Supabase Dashboard 执行**
- [x] **P8.R.3** `src/lib/reels/generator.ts`：Claude prompt + JSON 解析
  - ✅ `generateReelsContent()` + `refineReelsContent()` + `formatMasterBriefForPrompt()`
- [x] **P8.R.4** `src/lib/visual/seedance.ts`：新增 `submitI2VGeneration` 函数
  - ✅ 调用 `bytedance/seedance-2.0-fast/image-to-video`（first_frame_image + last_frame_image）
- [x] **P8.R.5** API 路由（7 个端点，全部交付）
  - ✅ `GET/POST /api/clients/[id]/reels` — 列表 + 新建
  - ✅ `POST /api/clients/[id]/reels/generate` — Claude 生成 4 字段
  - ✅ `GET/PATCH /api/clients/[id]/reels/[draftId]` — 读取 + 更新
  - ✅ `POST /api/clients/[id]/reels/[draftId]/refine` — AI 对话修改
  - ✅ `POST /api/clients/[id]/reels/[draftId]/upload-frame` — 上传参考帧
  - ✅ `POST /api/clients/[id]/reels/[draftId]/generate-video` — 触发 I2V
  - ✅ `GET /api/clients/[id]/reels/[draftId]/video-status` — 轮询状态
- [x] **P8.R.6** `ReelsStudio.tsx`（两栏 UI）
  - ✅ 左栏：4 个可编辑字段 + 参考帧上传（9:16）+ 视频播放器 + 状态轮询
  - ✅ 右栏：Strategy Engine 对话框，乐观更新
  - ✅ Draft 列表侧栏 + 状态徽章
- [x] **P8.R.7** 在 `/dashboard/clients/[id]/page.tsx` 加 `🎬 Reels Studio` Tab
- [x] **P8.R.8** Build 检查通过 + 推送到 master（commit: 5e24037，2026-05-02）

---

### 2026-05-03
- **System Design Audit**：评审识别 6 大缺口（见 SYSTEM_DESIGN_AUDIT.md）：外编版本管理（🔴高）、Visual Brief编辑（🟡中）、Prompt预览（🟡中）、Brief版本锁定（🟡中）、Agent记忆系统（🟡中）
- **Phase 8.Q 立项**：优先修复外编版本管理（直接提升内容管理生产力），再做 Visual Brief 编辑 + Prompt 预览
- **Phase 8.B 立项（最重要战略决策）**：确立"批量生产 → ME原生审批 → 自动排期 → 自动发布"新工作流目标
  - Airtable 解耦策略：Airtable 变为可选渠道（`airtable_enabled` 开关），不是必须路径
  - 内容日历进入核心 UI，取代对 Airtable 内容日历的依赖
  - 批量图片生成 + 视频上传 + 一键推送排期 是近期最高价值功能
- **Phase 8.M 立项**：Marketing Agent 记忆系统，中长期目标，不影响近期交付
- **Reels Studio 完成（P8.R）**：提示词生成、参考帧生成/上传、I2V视频、对话修改全链路完整交付（2026-05-02/03）

### 2026-04-28
- **架构**：Supabase 单一数据源；Content Workspace 可选；禁止双向实时同步
