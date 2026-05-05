# ROADMAP Archive — Phase 1-8 已完成历史

> 归档日期：2026-05-06  
> 原始文件：ROADMAP.md  
> 内容：Phase 1-6 历史、Phase 7 详细任务、Phase 8 DataForSEO 模块、§6.5 待开发方案草稿

---

## Phase 1-6 历史记录

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


---

## Phase 7 详细任务

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

**安全修复（2026-05-05 TDD 补丁）**

P7.3.1-5 核心库交付后，安全审查发现 5 项阻塞问题，已通过 TDD 完全修复：

| 编号 | 严重级别 | 问题 | 修复 | 验证 |
|------|---------|------|------|------|
| **CRITICAL-1** | 🔴 | API 零认证（所有 `/api/clients/[id]/blog/*` 路由无 Bearer token 校验） | 新建 `src/lib/validation-utils.ts` → `requireBearerToken()` + timing-safe 比较；所有博客 API 路由添加鉴权 | 18 集成测试，100% 通过 |
| **CRITICAL-2** | 🔴 | SEMrush API Key 非空断言（`process.env.SEMRUSH_API_KEY!` 掩盖 undefined，直到运行时才暴露） | 改为显式 `getApiKey()` 函数，缺失时立即抛错；所有 SEMrush 调用处添加运行时验证 | 15 单元测试，100% 通过 |
| **HIGH-1** | 🟠 | limit 参数无上界（用户可传 `limit: 99999` 导致 OOM） | 添加 `clampLimit(value, 1, 100)` 工具函数；博客列表/机会列表添加参数边界检查 | 参数边界集成测试通过 |
| **HIGH-2** | 🟠 | ReDoS 漏洞（`seo-checker.ts` 正则模式在无边界用户输入上） | 添加常量：MAX_HTML_BODY_CHARS=1MB、MAX_BRAND_NAME_CHARS=200、MAX_QUERY_TEXT_CHARS=2000；函数入口添加尺寸校验 | 12 DoS 防护测试，100% 通过 |
| **HIGH-3** | 🟠 | Schema 泄漏（API 错误消息返回数据库列名和内部细节给客户） | 所有端点改为向客户端返回通用 "Request failed"；详细错误日志仅在服务端 console.error() | 10 错误消息隔离测试，100% 通过 |

**TDD 结果**：80 个新测试 + 86 个既有测试 = 166 个测试全部通过 ✅，新代码覆盖率 ≥80% ✅

**代码产物**：
- 新建：`src/lib/validation-utils.ts` + 配套单元测试 `src/lib/__tests__/validation-utils.test.ts`
- 修改：`src/lib/semrush/client.ts`、`src/lib/blog/seo-checker.ts`、3 个博客 API 路由、错误处理全栈

**安全审查**：OWASP Top 10 检查通过，timing attack 防护、ReDoS 防护、XSS 隔离、PII 日志隔离全部符合。

---

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
- [x] **P7.3.21** 路由 `/dashboard/geo-composer/[clientId]/deploy` 创建（纯前端）✅ 2026-05-05
  - ✅ 修复：line 76 const geoData 变量引用错误已修正
  - ✅ 整合了 DeploymentForm + DeployedPagesList 两大核心组件
- [x] **P7.3.22** 输入要部署的页面 URL → 展示 snippet + 安装说明 + 一键标记已部署✅ 2026-05-05
  - ✅ DeploymentForm.tsx：URL input + snippet display + confirmation dialog
  - ✅ UrlInput.tsx：HTTPS-only validation with real-time feedback
  - ✅ CodeSnippetBox.tsx：Code display with copy-to-clipboard
  - ✅ ConfirmDialog.tsx：Reusable confirmation modal
- [x] **P7.3.23** 已部署页面列表（调用已有 deployments API）✅ 2026-05-05
  - ✅ DeployedPagesList.tsx：List of deployed pages with status badges
  - ✅ DeploymentStatusBadge.tsx：Status indicators (active/pending/revoked)
  - ✅ useDeploymentApi：Custom hook for deployment API operations
  - ✅ deployment-constants.ts：Centralized configuration

**验收标准**：
- ✅ 博客选题来自 AI Tracker 弱项 × SEMrush 交叉验证，有数据依据
- ✅ unified 模式文章同时通过 SEO checklist 和 GEO checklist
- ✅ 博客生成时自动注入 active GEO directive HTML
- ✅ 博客查看页有双信号 checklist 展示
- ✅ 内容审计：客户站有同类文章时提示升级而非直接生成，防止关键词蚕食
- ✅ Snippet 部署助手可用，部署记录写回 deployed_pages

---

### 3.3.1 GEO Directive 部署机制决策（2026-05-05）

**决策背景**：GEO Directive 的实际部署流程涉及两种可行方案，需要明确 MVP 阶段采用哪一种。详见 [`GEO-Directive-Update-Mechanism.md`](./docs/GEO-Directive-Update-Mechanism.md)。

**Phase 1（MVP）：静态快照模型 ✅ 已实现**

采用 **嵌入式 JSON** 模式，无需动态基础设施投入：

```
GEO Composer （生成指令）
    ↓
Deploy 页面 （生成代码片段）
    ↓
用户复制 snippet （含完整 JSON）
    ↓
粘贴到客户 HTML （变成静态块）
    ↓
AI 爬虫读取 JSON （排名影响）
```

**优势**：
- 零后端投入，无需新增 API 基础设施
- 实施简单，用户即刻可用（copy-paste）
- 与 Google Analytics / Pixel 使用体验一致（用户习惯）
- PoC 阶段验证 GEO 概念可行性

**制约**：
- 更新已部署页面需手动重新 copy-paste
- 无法 A/B 测试不同版本
- 快速回滚需用户介入

**MVP 验收标准**：
- ✅ CTS Tours PoC 验证：4 周追踪数据中至少 1 家 AI（ChatGPT/Claude/Perplexity）排名提升 ≥2 位
- ✅ 证明静态 GEO 信号对 AI 排名有实际影响
- ✅ 收集客户部署反馈（用户体验、维护成本）

---

**Phase 2（Q3+ 2026 待评估）：动态脚本模型 📋 暂缓**

仅在 Phase 1 PoC 验证成功后考虑实施：

```
客户网站 HTML 仅包含：
<script src="https://magic-engine.com/api/clients/{clientId}/geo/directive/latest.js"></script>

Magic Engine 动态返回：
    自动注入最新 active directive
    1 小时缓存周期
    无需客户干预即可自动推送更新
    支持 A/B 测试 + 快速回滚
```

**延缓理由**：
1. **MVP 验证优先**：需先证明 GEO 概念对排名有实际影响，再投入基础设施
2. **成本-收益评估**：Phase 2 需新建 API 端点 + 缓存层 + 监控，只有确认客户有"频繁更新"需求时才值得
3. **客户反馈驱动**：从 CTS Tours 和初期客户的部署体验中收集"自动更新"的真实需求强度
4. **架构简洁性**：Phase 1 的 MVP 约束使系统更易理解和维护，减少初期认知负荷

**Phase 2 启动条件**（全部满足）：
- [ ] CTS Tours 4 周追踪数据证明 GEO 有效
- [ ] 至少 3 个其他客户已部署并运行 3+ 个月
- [ ] 客户明确表达"自动更新"为关键需求（例如每周新增博客）
- [ ] 已验证缓存策略对 AI 爬虫行为的影响

**预期启动时间**：2026 Q3（7月）或更晚，取决于 PoC 结果。

**技术参考**：
- 静态模型详细设计：GEO-Directive-Update-Mechanism.md §1
- Phase 2 API 草稿：GEO-Directive-Update-Mechanism.md §3.2
- 部署记录数据模型：P7.3.21-23（deployments 表）

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


---

## Phase 8 DataForSEO 集成详细记录


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


---

## §6.5 待开发功能方案草稿（已整合入正式章节）

## 6.5 待开发功能方案（2026-05-05）

### 🔥 P7.4.14-15: CTS Tours PoC 追踪与月度报告

**时间线**：
- P7.4.14：第 2 周再跑（2026-05-12 执行）
- P7.4.15：第 4 周再跑 + 生成月报（2026-05-26 执行）

**开发方案**：
```
任务内容：
1. 无新代码开发（追踪逻辑已就位）
2. 手动触发 AI Tracker 重新跑 36 queries（CTS Tours）
   - 调用 POST /api/clients/a93c40e0/ai-tracker/run
   - 记录结果到 ai_visibility_snapshots
3. 对比基线数据（2026-04-27）与追踪数据
   - 计算排名变化（Δ rank）
   - 统计有排名提升的 query 数量
4. 生成月度报告：
   - 调用 GET /api/clients/a93c40e0/reports/monthly
   - 返回 5 大分节数据
   - 导出为 HTML 快照

验收标准：
✅ CTS Tours 在 ChatGPT/Claude/Perplexity 中至少 1 家排名提升 ≥2 位
✅ 月报页面完整显示 4 周追踪曲线
✅ 报告导出成功
```

**技术栈**：API 调用 + 数据对比（无新代码）

---

### ✅ P8.0.4-P8.0.6: DNZ 诊断 Stage 2 异步框架 ✅ 完成（2026-05-05）

**核心目标**：为客户网站采集结果建立后台异步处理流程，支持 Cron 自动重新扫描。

#### P8.0.4: Job Runner（后台任务调度器）✅ 完成

- **文件**：`src/lib/dnz/job-runner.ts`（222 行）
- **类**：`DnzJobRunner`（Supabase 注入模式）
- **方法**：`createJob`, `getJobStatus`, `listJobs`, `cancelJob`
- **测试**：`src/lib/dnz/__tests__/job-runner.test.ts` — 48 个用例，100% 通过，100% 覆盖率
- **特性**：状态机（pending→running→completed/failed/cancelled），并发隔离，软删除

#### P8.0.5: Job Executor（采集执行引擎）✅ 完成

- **文件**：`src/lib/dnz/job-executor.ts`（≥200 行）
- **函数**：`executeJob`, `processPages`, `enrichPageWithGPT`
- **流程**：Sitemap 发现 → Jina.ai 提取 → GPT-4o mini 分类 → 批量 upsert
- **测试**：`src/lib/dnz/__tests__/job-executor.test.ts` — 40 个用例，100% 通过，98.88% 覆盖率
- **特性**：200 页批量限流，Jina 3次重试，单页失败不中断全流程，去重（jina_extracted_at）

#### P8.0.6: API Routes & Cron ✅ 完成（2026-05-05）

- **业务逻辑层**：`src/lib/dnz/dnz-api.ts` — `createDnzJob`, `getDnzJobWithProgress`, `cancelDnzJob`, `createWeeklyJobs`
- **API 路由**：
  - `POST /api/clients/[id]/dnz/rescan` — 创建 rescan/update 类型 job（`rescan/route.ts`）
  - `GET /api/clients/[id]/dnz/job/[jobId]` — 查询 job + progress（`processed_pages/total_pages`）
  - `DELETE /api/clients/[id]/dnz/job/[jobId]` — 取消 pending/running job；terminal 状态返回 400
- **Cron**：`GET /api/cron/dnz-weekly-rescan` — `x-cron-secret` 认证；为所有 active clients 创建 update jobs
- **测试**：
  - `src/lib/dnz/__tests__/dnz-api.test.ts` — 22 个业务逻辑单元测试，100% 通过
  - `src/app/api/clients/[id]/dnz/__tests__/routes.test.ts` — 23 个路由契约测试，100% 通过
  - **合计**：133 个测试全部通过，覆盖率 99.37%（目标 ≥80%）
- **架构亮点**：
  - 路由测试用直接 handler import + `NextRequest` mock（无需 HTTP 服务器）
  - 业务逻辑与路由分层（dnz-api.ts 可独立测试）
  - TypeScript strict mode，零 `any`
  - progress = 1.0 when total_pages = 0（新 client 开始扫描前显示完成）

**依赖关系**：P8.0.4 `createJob`/`cancelJob` + P8.0.5 `executeJob`  
**实际交付物**：5 个源文件 + 3 个测试文件 + 133 个单元/集成测试

---

### 🔥 P8.1.1-P8.1.6: 三维内容策略分析

**核心目标**：根据 AI Tracker 弱项 × SEMrush 缺口 × 现有内容薄弱点，自动生成优先级排序的内容策略建议。

**开发方案**：

#### P8.1.1-P8.1.2: 数据模型 + 分析库
```typescript
// Supabase migration：content_strategy_items 表
CREATE TABLE content_strategy_items (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL,
  topic TEXT NOT NULL,
  action_type ENUM('unified', 'geo_only', 'seo_only', 'upgrade') NOT NULL,
  priority_score FLOAT (0-100),
  ai_weak_queries TEXT[],         // 在 AI 中排名差的问句数组
  semrush_kd FLOAT,               // 关键词难度
  semrush_volume INT,             // 月搜量
  existing_page_id UUID NULL,     // 若是升级，指向 client_site_pages
  rationale TEXT,                 // AI 生成的推荐理由
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ          // 建议有效期（30天）
);

// 库：src/lib/strategy/analyzer.ts
class StrategyAnalyzer {
  async analyze(clientId: string): Promise<StrategyItem[]> {
    // 步骤 1：获取 AI Tracker 数据
    const aiWeakQueries = await getAIWeakItems(clientId);
    
    // 步骤 2：从 SEMrush 获取竞品排名词
    const semrushKeywords = await getSemrushCompetitorKeywords(clientId);
    
    // 步骤 3：获取现有页面列表
    const existingPages = await getClientSitePages(clientId);
    
    // 步骤 4：交叉分析
    return this.crossAnalyze(aiWeakQueries, semrushKeywords, existingPages);
  }
  
  private crossAnalyze(...): StrategyItem[] {
    // 维度 A：AI Tracker 弱项（rank > 3 或 null）
    // 维度 B：SEMrush 缺口（竞品排名但客户无对应页面）
    // 维度 C：现有页面薄弱（word_count < 500 或 no_geo_block）
    
    // 输出：StrategyItem[] 按优先级排序
  }
}

// 库：src/lib/strategy/scorer.ts
function scoreStrategy(item: AnalysisResult): StrategyItem {
  let score = 0;
  
  // unified（AI弱项 + SEO缺口）：最高分 80-100
  if (hasAIWeakness && hasSEOGap) score = 85;
  
  // geo_only（AI弱项，但 SEO 价值低）：中分 50-70
  else if (hasAIWeakness) score = 60;
  
  // seo_only（高 SEO 价值，但无 AI 弱项）：50-60
  else if (hasSEOGap) score = 55;
  
  // upgrade（现有页面薄弱）：按缺口大小 30-70
  else score = 40 + (1 - (page.wordCount / 2000)) * 30;
  
  return { ...item, priority_score: score };
}

单元测试：
  ✅ analyzer.analyze() 返回分层数组
  ✅ 验证维度 A/B/C 的交叉识别
  ✅ scorer 对 unified 评分 > geo_only 评分
  ✅ 升级建议关联到 existing_page_id
  
目标覆盖率：>= 80%
```

#### P8.1.3-P8.1.4: API 端点
```typescript
// 路由：src/app/api/clients/[id]/strategy/generate/route.ts
POST /api/clients/[id]/strategy/generate
  请求体：{}
  响应：
    {
      "success": true,
      "strategy_items": StrategyItem[],
      "count": number,
      "analysis_timestamp": ISO8601
    }

  实现：
  1. 调用 StrategyAnalyzer.analyze(clientId)
  2. 清理旧的过期建议（expires_at < now()）
  3. 批量写入 content_strategy_items 表
  4. 返回新生成的建议列表

// 路由：src/app/api/clients/[id]/strategy/route.ts
GET /api/clients/[id]/strategy?limit=20&offset=0
  响应：
    {
      "strategy_items": StrategyItem[],
      "total": number,
      "timestamp": ISO8601
    }

  实现：
  - 查询 content_strategy_items，ORDER BY priority_score DESC
  - 支持 limit / offset 分页

单元测试：
  ✅ POST generate：触发分析，写入数据库，返回列表
  ✅ GET strategy：分页查询，验证排序
  ✅ 过期建议清理（mock 时间）
  
目标覆盖率：>= 80%
```

#### P8.1.5-P8.1.6: 前端 UI
```typescript
// 组件：src/app/dashboard/clients/[id]/strategy/page.tsx
功能：
  1. 顶部热力图：显示 topic 维度分布
     - X 轴：话题类别（旅游、签证、文化等）
     - Y 轴：机会类型（unified / geo_only / seo_only / upgrade）
     - 颜色深度：priority_score
  
  2. 主列表：每行一条建议
     - 第 1 列：Action Type 标签（🔄 升级 / ✨ 新建 / 📱 社媒）
     - 第 2 列：Topic + Rationale（文字截断）
     - 第 3 列：优先级星标（5 星制）
     - 第 4 列：快速 Action 按钮（生成 / 标记完成 / 删除）
  
  3. 点击行项目：展开详情
     - 显示完整 rationale
     - 若是 upgrade，显示现有页面内容摘要
     - "生成内容" 按钮 → 跳转到博客生成页（预填 topic）
  
  4. 分页：limit=20，支持加载更多

// Hook：src/hooks/useStrategyAnalysis.ts
  - fetchStrategy()：GET /api/clients/[id]/strategy
  - generateStrategy()：POST /api/clients/[id]/strategy/generate
  - 支持刷新、错误提示、loading 状态

集成测试（E2E）：
  ✅ 页面加载显示策略列表
  ✅ 热力图渲染无报错
  ✅ 点击行项目展开详情
  ✅ "生成内容" 跳转到博客生成（携带 topic 参数）
  ✅ 分页加载更多
  
目标覆盖率：>= 80%
```

**依赖关系**：
- AI Tracker 数据（P7.1 完成）✅
- SEMrush API 集成（P8.9 完成）✅
- client_site_pages 表（P8.0 完成）✅

**时间估算**：6-8 工作日（含测试）
**交付物**：3 个库 + 2 个 API + 1 个前端页面 + 完整测试

---

### 🔥 P9.0.8-P9.0.14: Visual Queue UX 核心集成

**核心目标**：完成 Visual Queue 的 UI 组件集成、集成测试、边界场景验证。

**开发方案**：

#### P9.0.8-P9.0.9: 组件集成 + Tailwind 配置
```typescript
// P9.0.8：集成 GenerationProgress 到 visuals page
// 文件：src/app/dashboard/visuals/page.tsx

替换原有的进度展示：
// 旧代码：
{generating && <div>Generating...</div>}

// 新代码：
{queueItem && (
  <GenerationProgress 
    item={queueItem}
    onCancel={handleCancel}
  />
)}

实现细节：
  - 导入 GenerationProgress、useGenerationQueue
  - 绑定 queueItem = activeGenerations[0]（当前生成任务）
  - handleCancel → 调用 useGenerationQueue.cancelGeneration()

// P9.0.9：升级 Tailwind 配置
// 文件：tailwind.config.ts 或 globals.css

新增自定义动画：
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// tailwind.config.ts
extend: {
  animation: {
    'spin-slow': 'spin-slow 6s linear infinite',
    'pulse-soft': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  }
}

单元测试：
  ✅ 验证 GenerationProgress 组件可见
  ✅ 验证倒计时每秒更新
  ✅ 验证 cancel 按钮功能
  ✅ 验证 Tailwind 类应用生效（animate-spin-slow）
  
目标覆盖率：>= 80%
```

#### P9.0.10-P9.0.13: 集成测试 + 边界场景
```typescript
// 文件：src/components/visual/__tests__/GenerationProgress.test.tsx

测试用例：

✅ 进度环动画测试
  - 验证进度 0% 时环形初始状态
  - 验证进度 50% 时环形旋转 50%
  - 验证进度 95% 时环形旋转 95%（不超过 95%）
  - 验证 CSS 过渡平滑（transition 属性）

✅ 倒计时文本测试
  - 输入 120000ms → 显示 "2m 0s"
  - 输入 5400ms → 显示 "1m 30s"
  - 输入 500ms → 显示 "0s"
  - 倒计时每秒刷新（via timer）

✅ 取消按钮激活测试
  - 预期时间：180s，未超期时 disable
  - 预期时间：180s，经过 270s（1.5x）时 enable
  - 按钮点击触发 onCancel()

✅ 多提供商时间估算测试
  - Wavespeed（3min）→ 预期 180s，1.5x 阈值 270s
  - Seedance（4min）→ 预期 240s，1.5x 阈值 360s
  - HeyGen（2min）→ 预期 120s，1.5x 阈值 180s

✅ 网络延迟模拟测试
  - useGenerationQueue hook：
    - 每 100ms 本地递减 estimatedRemainingMs
    - 每 5s 网络轮询一次
  - 验证：本地倒数不受网络延迟影响（平滑）
  - 验证：网络轮询返回新数据时，平滑过渡

✅ 边界场景测试
  - 0ms 倒数：显示 "0s"，按钮 enable
  - NaN 估算：fallback 到默认时长
  - 提供商超时重分类：进度重置为 0%
  - 并发多生成：每个任务独立计时

集成测试（E2E）：
  ✅ 用户点击生成 → 显示 progress 组件
  ✅ 倒计时每秒更新可见
  ✅ 超时后取消按钮可点击
  ✅ 取消后回到初始状态

目标覆盖率：>= 80%
```

#### P9.0.14: 覆盖率验证 + 部署
```bash
// 执行测试覆盖率检查
npm test --coverage -- \
  src/lib/visual/progress-utils.ts \
  src/components/visual/

// 期望输出：
// ├─ progress-utils.ts  : 100% Statements | 100% Branches
// ├─ StageIndicator.tsx : 85% Statements | 80% Branches
// ├─ CountdownText.tsx  : 90% Statements | 85% Branches
// ├─ GenerationProgress.tsx : 88% Statements | 85% Branches
// └─ Overall : 88% Coverage ✅

验收标准：
  ✅ 整体覆盖率 >= 80%
  ✅ 所有分支覆盖
  ✅ 无 console.log 或 debugger
  ✅ 无浮动元素的视觉问题（z-index 冲突）
  ✅ 移动端 / 平板 / 桌面响应式设计验证
```

**依赖关系**：
- useGenerationQueue hook（P9.0.7 完成）✅
- progress-utils.ts（P9.0.1 完成）✅
- generation-config.ts（P9.0.2 完成）✅

**时间估算**：4-5 工作日（含测试）
**交付物**：3 个 UI 组件 + 3 类测试 + 覆盖率报告

---

