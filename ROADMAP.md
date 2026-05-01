# Magic Engine — Roadmap

> 最后更新：2026-05-01 · 当前阶段：**Phase 8.6 — Link Intelligence（开工）**
> 配套：[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)（产品视角）· [ARCHITECTURE.md](./ARCHITECTURE.md)（技术架构）

---

## 当前进度速览

```
✅ Phase 1-6     社媒内容矩阵（已完成）
✅ Phase 7.0     决策窗口（7/7 决策完成，2026-04-30）
✅ Phase 8.1     ESLint fix 完成
✅ Phase 8.6     Link Intelligence（2026-05-01 完成）
✅ Phase 8.7     SERP Intelligence（2026-05-01 完成）
🔥 Phase 8.8     Local Visibility（AU/NZ 城市排名）← 当前位置
📋 Phase 8.9     Market Baseline（市场基准数据）
📋 Phase 8.11    Billing Monitor（成本追踪）
📋 Phase 8.C     月报整合
📋 Phase 9       自动化深化
📋 Phase 10      平台扩展与沉淀
```

**Phase 8.8 当前状态**：开工。建设本地搜索可见度模块（AU/NZ 主要城市）。

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
Q3: 服务化 + 报告化           📋 Phase 8-9
    ├── 月度 AI 可见度报告自动生成
    ├── 客户接入向导优化
    ├── 站点权威度追踪
    └── 客户 Portal（client-facing view）

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
- [ ] ⏸ **P7.1.7** `src/lib/ai-tracker/runners/perplexity.ts` — 暂缓（用户决策 2026-04-30：先做 OpenAI + Claude）
- [x] **P7.1.8** `src/lib/ai-tracker/parser.ts` — 自然语言回复 → BrandMention[] + client_brand_rank（二次 Strategy Engine 调用）

**编排与 API（Day 6-7）**
- [x] **P7.1.9** `src/lib/ai-tracker/orchestrator.ts` — N 问句 × 2 引擎并行车道，批量并发，全套入库 + 周快照聚合
- [x] **P7.1.10** `POST /api/ai-tracker/run` 路由 — 手动触发一轮（maxDuration 5 分钟）
- [x] **P7.1.11** `GET /api/cron/ai-tracker-weekly` 路由 — Bearer CRON_SECRET 鉴权，遍历有 enabled query 的客户

**前端页面（Day 8-10）**
- [ ] **P7.1.12** 路由 `/dashboard/ai-visibility/[clientId]` 创建
- [ ] **P7.1.13** Tab 1: Rankings Table 组件
- [ ] **P7.1.14** Tab 2: Tool Comparison 组件
- [ ] **P7.1.15** Tab 3: By AI Model 组件
- [ ] **P7.1.16** Tab 4: Queries 管理组件
- [ ] **P7.1.17** 顶部 [Run Now] / [Schedule Weekly] 按钮
- [ ] **P7.1.18** 侧边栏导航加 "AI Visibility" 菜单项

**联调（Day 11-12）**
- [ ] **P7.1.19** 端到端测试：CTS Tours 跑一次基线
- [ ] **P7.1.20** 数据持久化验证

**验收标准**：
- 进入客户 → AI Visibility 页 → 点 "Run Now" → 5 分钟内看到 3 家 AI 的排名表
- Cron 每周一自动跑，结果存入 snapshots
- UI 完全用对外封装名（"AI Visibility Tracker"，不出现 OpenAI/Perplexity 等）

---

### 3.2 GEO Composer（Week 3）

**目标**：基于 Brief + Tracker 弱项，自动生成 GEO 指令并提供部署 snippet。

**数据库（Day 13）**
- [ ] **P7.2.1** 创建 `geo_directives` 表（schema 见 ARCHITECTURE.md §11.3）

**核心库（Day 14-15）**
- [ ] **P7.2.2** `src/lib/geo/composer.ts` — Strategy Engine prompt：Brief + Tracker 弱项 → directive JSON
- [ ] **P7.2.3** `src/lib/geo/html-generator.ts` — JSON → 隐藏 div HTML
- [ ] **P7.2.4** `src/lib/geo/snippet-builder.ts` — HTML + 安装说明（WordPress/Webflow/通用）

**API（Day 16）**
- [ ] **P7.2.5** `POST /api/clients/[id]/geo/generate`
- [ ] **P7.2.6** `GET /api/clients/[id]/geo`（active directive）
- [ ] **P7.2.7** `PATCH /api/clients/[id]/geo/[directiveId]`（编辑）
- [ ] **P7.2.8** `POST /api/clients/[id]/geo/[directiveId]/activate`
- [ ] **P7.2.9** `GET /api/clients/[id]/geo/snippet`
- [ ] **P7.2.10** `POST /api/clients/[id]/geo/deployments`（记录部署 URL）

**前端页面（Day 17-19）**
- [ ] **P7.2.11** 路由 `/dashboard/geo-composer/[clientId]` 创建
- [ ] **P7.2.12** 顶部状态栏（Active Directive / Deployed pages）
- [ ] **P7.2.13** 左侧结构化编辑器（4 个字段块）
- [ ] **P7.2.14** 右侧 HTML Snippet 实时预览 + 一键复制
- [ ] **P7.2.15** "How AI sees this" 模拟按钮（Strategy Engine 跑一次）
- [ ] **P7.2.16** [Regenerate from Brief] / [Regenerate from Tracker] 按钮
- [ ] **P7.2.17** [Save Draft] / [Activate] 按钮
- [ ] **P7.2.18** 侧边栏导航加 "GEO Composer" 菜单项

**验收标准**：
- 客户详情页有 GEO Tab（或独立菜单）
- 一键基于 Brief + Tracker 生成 directive
- 复制 HTML snippet 按钮可用
- 已部署页面列表（手填记录）

---

### 3.3 博客生成 + Snippet 部署（Week 4）

**目标**：把 GEO 注入到实际生产内容流。

**博客生成自动注入（Day 20-21）**
- [ ] **P7.3.1** 改造 Campaign 批量生成 / Route A 流程，输出 HTML 时拼接 active GEO directive
- [ ] **P7.3.2** 新增 `POST /api/clients/[id]/blog/generate`（独立长文流程）
- [ ] **P7.3.3** 博客 HTML 模板含完整 SEO 元素（title / meta / schema / 内链 / GEO 隐藏块）

**博客查看页 UI（Day 22-23）**
- [ ] **P7.3.4** 路由 `/dashboard/clients/[id]/blog/[postId]` 创建
- [ ] **P7.3.5** 顶部操作栏：Edit / Copy HTML / Copy Text / Regenerate Content / Regenerate Image / Reject
- [ ] **P7.3.6** 右侧 SEO Checklist（Title / Meta / GEO Instructions / Internal Linking / Featured Image / CTA）
- [ ] **P7.3.7** 正文区渲染 HTML，带 "Show GEO Block" toggle（仅团队可见）

**Snippet 部署助手（Day 24-26）**
- [ ] **P7.3.8** 路由 `/dashboard/geo-composer/[clientId]/deploy` 创建
- [ ] **P7.3.9** 输入要部署的页面 URL → 输出 snippet + 安装说明
- [ ] **P7.3.10** 部署记录回写到 `deployed_pages`

**验收标准**：
- 博客生成时自动包含 GEO 指令
- 博客查看页 UI 仿 SEOPro 风格
- Snippet 部署助手可用

---

### 3.4 月报 + PoC 验证（Week 5）

**目标**：跑完 CTS Tours 全流程，验证商业模式可行性。

**月报页面（Day 27-28）**
- [ ] **P7.4.1** 路由 `/dashboard/reports/[clientId]/monthly` 创建
- [ ] **P7.4.2** 第 1 节：AI 可见度总览（本月平均排名 vs 上月，带箭头）
- [ ] **P7.4.3** 第 2 节：排名变化曲线（4 周折线图）
- [ ] **P7.4.4** 第 3 节：GEO 部署动作（本月新部署页数 + Active version）
- [ ] **P7.4.5** 第 4 节：竞品对比（top 10 问句中的排名）
- [ ] **P7.4.6** 第 5 节：下月建议（Strategy Engine 自动生成）
- [ ] **P7.4.7** 报告导出（HTML 截图 / PDF 二选一，先 HTML）

**CTS Tours PoC（Day 29 部署 + 后续 2-4 周观察）**
- [ ] **P7.4.8** CTS Tours 加进 Magic Engine（Master Brief 完整）
- [ ] **P7.4.9** AI Visibility Tracker 跑基线
- [ ] **P7.4.10** GEO Composer 生成 v1 directive
- [ ] **P7.4.11** 给 CTS Tours 实际网站贴 snippet（首页 + 3 个核心着陆页）
- [ ] **P7.4.12** Magic Engine 生成 2-3 篇博客（含 GEO）发布到 ctstours.co.nz/blog
- [ ] **P7.4.13** 标记基线日期 + 设置每周自动追踪
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

- [x] **P8.1** 客户接入向导（3 步流程：基本信息 → Airtable 配置 → SEMrush/DataForSEO 参数）
  - ✅ 已完成：Step1BasicInfo、Step2Workspace、Step3Keywords 组件
  - ✅ 已完成：`POST /api/clients/onboarding/route.ts`（3 步 API）
  - 待验证：修复 ESLint 报错，集成到 Dashboard 主页
  
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
  - ✅ 数据库迁移：`supabase/migrations/20260501000003_dataforseo_backlinks.sql`
  - ✅ API 客户端：`src/lib/dataforseo/client.ts`（Basic Auth 认证）
  - ✅ 数据解析器：`src/lib/dataforseo/backlinks-parser.ts`（upsert + velocity 快照）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/backlinks/sync`
  - ✅ 指标端点：`GET /api/clients/[id]/datasources/backlinks/metrics`
  - ✅ 前端页面：`src/app/dashboard/link-intelligence/page.tsx`（反链表格、同步按钮）
  - ✅ Dashboard 导航：Link Intelligence 菜单项已添加
  - ✅ 环境配置：render.yaml 已更新 DATAFORSEO_LOGIN/PASSWORD
  - **验收**：端到端流程验证 ✅（UI 正常加载、API 可调用、Supabase 表已创建）
  
- [x] **P8.7** SERP Intelligence（排名追踪）✅ 完成 2026-05-01
  - ✅ 数据库：`supabase/migrations/20260501000004_serp_rankings.sql`（serp_rankings + serp_ranking_history）
  - ✅ DataForSeoClient.getSerp() 方法实现
  - ✅ 数据解析器：`src/lib/dataforseo/serp-parser.ts`（storeSerpiData、calculateSerpTrends、getSerpMetrics）
  - ✅ 同步端点：`POST /api/clients/[id]/datasources/serp/sync`
  - ✅ 查询端点：`GET /api/clients/[id]/datasources/serp/rankings`（支持排序、分页）
  - ✅ 前端页面：`src/app/dashboard/serp-intelligence`（关键词表格、排名变化、机会识别）
  - ✅ Dashboard 导航：SERP Intelligence 菜单项已添加（📈 emoji）
  - **验收**：支持 100+ 关键词追踪、4 周趋势计算、Top 10/50 分类 ✅
  
- [ ] **P8.8** Local Visibility（本地搜索可见度）
  - 数据库：创建 `local_serp_rankings` 表（client_id, keyword, city_name, location_code, position, date）
  - LocationCode 标准化（AU 城市：Sydney=2036, Melbourne=2157, Brisbane=2174… / NZ 城市：Auckland=2554, Wellington=2579…）
  - API：`POST /api/clients/[id]/datasources/local/sync` — DataForSEO Local Pack API
  - 前端：`/dashboard/clients/[id]/local-visibility` 页面（按城市 / 关键词矩阵、热力图、机会排名）
  - **验收**：支持 AU/NZ 主要城市（Sydney, Melbourne, Brisbane, Auckland, Wellington），显示每个城市每个关键词的排名
  
- [ ] **P8.9** Market Baseline（市场基准数据）
  - 用途：PoC 报告对标、行业竞争水位参考
  - 数据来源：DataForSEO 行业快照 / Semrush Top 10 对标
  - API：`GET /api/clients/[id]/market-baseline?industry=&region=` — 聚合行业平均数据
  - 前端：显示在月报中（"你的排名 vs 行业平均"）
  - **验收**：月报中有"行业基准对标"版块
  
- [ ] **P8.10** (待定 — 可能是 DataForSEO 成本优化或其他功能)
  - 暂预留
  
- [ ] **P8.11** Billing Monitoring（DataForSEO 成本追踪）
  - 数据库：创建 `datasource_usage_logs` 表（client_id, service, api_calls, cost_usd, month）
  - 用途：按客户、按服务、按月追踪 DataForSEO 的 API 成本
  - API：`GET /api/admin/billing/datasources?month=` — 成本汇总
  - 前端：`/dashboard/admin/billing-monitor` 页面（仅管理员可见，展示所有客户的 DataForSEO 成本）
  - **验收**：能按客户、按月查看 DataForSEO 成本，用于计费和成本优化

#### 8.C 跨界整合（与 Phase 7 联动）

- [ ] **P8.C.1** 月报（P7.4.1-P7.4.7）扩展，纳入 P8.6-P8.9 数据
  - AI Visibility Tracker（Phase 7）+ Link Intelligence（P8.6）+ SERP Intelligence（P8.7）+ Local Visibility（P8.8）
  - 一份完整月报展示"全景可见度"
  
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

### Phase 9 — 自动化深化
- [ ] **P9.1** Cron：每日 sync Content Workspace → 主库
- [ ] **P9.2** 批量生成：一键为所有 approved 帖子生成图片
- [ ] **P9.3** 批量发布：所有已生成帖子推送到 Publishing Hub
- [ ] **P9.4** Publer Webhook 接收发布后数据
- [ ] **P9.5** 互动率分析与 prompt 优化反馈循环

### Phase 10 — 平台扩展与沉淀
- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持
- [ ] **P10.3** Magic Lab Academy 课程化（基于实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** 部分模块对外 SaaS 化（Pro 套餐）

---

## 6. 技术债

- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）

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

### 2026-04-28
- **架构**：Supabase 单一数据源；Content Workspace 可选；禁止双向实时同步
