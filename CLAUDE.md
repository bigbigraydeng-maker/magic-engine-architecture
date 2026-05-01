# Magic Engine — Agent 工作指南

> 每次开始工作前先读这个文件。

## 输出语言

**所有对话和说明必须用中文输出。代码文件内容保持英文。**

---

## 一、项目战略定位（必读）

**Magic Engine（代码库 `crazycontent`）是 Magic Lab 2026 年的旗舰产品**，承担两个角色：

1. **直接收入**：以年度陪跑服务（5–15 万/客户/年）形式交付给品牌方/代理公司
2. **Magic Lab Academy 的实战载体**：所有培训案例和 SOP 从这里沉淀

### 三大核心能力（不偏离）

```
┌─────────────────────────────────────────────────┐
│  SEO 内容引擎    GEO 优化层    社媒内容矩阵      │
│  传统搜索可见度  AI 推荐可见度  全平台内容生产   │
│  （已成熟）      （核心差异化） （已成熟）        │
└─────────────────────────────────────────────────┘
```

**所有功能开发必须服务于这三大能力之一。** 偏离的需求需先与产品负责人对齐。

### 核心原则

- 全自动走不通的，先做半自动；半自动走不通的，先做手动 + UI 辅助
- 陪跑模式 = 内部团队工具优先，不做用户登录/付费墙/quota
- 客户层永远不暴露第三方供应商真实名（见 §三）

---

## 二、产品形态约定

```
Supabase（执行层）            Content Workspace（策划层 - Airtable）
  ── 单一数据源 ──               ── 可选输入源 + 结果展示 ──
  content_posts                  内容日历（同步导入）
  keywords                       关键词库（同步导入）
  visual_assets                  ← 写回 Image_URL / Publer_Post_ID
  geo_directives (规划中)
  ai_visibility_runs (规划中)

Magic Engine UI = 主操作界面，可完全独立于 Airtable 运行
```

**同步方向原则：**
- Airtable → Supabase：按需手动 Sync + 每日 Cron（规划中）
- Supabase → Airtable：操作完立即写回（图片 URL、发布 ID）
- **禁止双向实时同步**（产生冲突）

---

## 三、第三方服务 ↔ 对外封装名映射 ⭐

**关键规则**：所有面向客户和用户的界面、文档、报告中，**禁止出现真实第三方供应商名**。开发文档（CLAUDE.md / ARCHITECTURE.md）和代码内部可以使用真实名。

| 真实服务 | 内部代号（代码中） | 对外封装名（UI/PRODUCT/客户报告） |
|---------|------------------|-----------------------------------|
| Supabase | `supabase` | （内部细节，不暴露） |
| OpenAI GPT-4o-mini | `openai` | **Content Engine** |
| Anthropic Claude Sonnet | `claude` | **Strategy Engine** |
| WaveSpeed Flux-dev (Atlas) | `wavespeed` | **Visual Studio** |
| Seedance 2.0 (Atlas) | `seedance` | **Video Studio** |
| HeyGen | `heygen` | **Avatar Studio** |
| SEMrush | `semrush` | **Keyword Intelligence** |
| Jina.ai Reader | `jina` | **Site Analyzer** |
| Airtable | `airtable` | **Content Workspace** |
| Publer | `publer` | **Publishing Hub** |
| Perplexity API | `perplexity` | （AI Visibility Tracker 内部） |
| SerpAPI / Google AIO | `serpapi` | （AI Visibility Tracker 内部） |
| Render | — | （不暴露） |
| GitHub | — | （不暴露） |

### 实施规范

- **UI 文案**：按钮、菜单、提示语、错误信息只用对外封装名
  - ✅ "Generating with Visual Studio…"
  - ❌ "Generating with WaveSpeed Flux-dev…"
- **客户报告 / 月度交付物**：只用对外封装名，可以提"AI 引擎"、"内容数据库"等通用描述
- **API 路由内部**：可以用真实代号 (`/api/visual/wavespeed/...`)，但前端调用层封装一次
- **错误日志**：内部日志可以含真实名，对客户可见的错误提示必须用封装名
- **环境变量**：保留真实命名（如 `ATLAS_API_KEY`），不强行更名

### 新建组件命名约定

新建模块的 UI 文件夹和组件名，**统一用对外封装名**：

```
src/app/dashboard/
├── visual-studio/         ← ✅ 对外名
│   page.tsx               
├── ai-visibility/         ← ✅ 对外名
│   page.tsx
└── geo-composer/          ← ✅ 对外名
```

代码内部库可以用真实名：
```
src/lib/
├── wavespeed/             ← OK，内部库名
├── visual/                ← OK，内部抽象层
└── geo/                   ← OK，功能名
```

---

## 四、技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini（内容生成）+ Anthropic Claude（战略生成） |
| AI 图片 | Atlas Cloud (WaveSpeed Flux-dev) |
| AI 视频 | Atlas Cloud (Seedance 2.0) |
| AI 头像 | HeyGen |
| 关键词 | SEMrush API |
| 网页抓取 | Jina.ai Reader |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| AI 可见度（规划） | OpenAI / Anthropic / Perplexity API |
| 部署 | Render |

---

## 五、关键文件地图

```
src/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx              # 侧边栏导航
│   │   ├── page.tsx                # 概览卡片
│   │   ├── clients/[id]/page.tsx   # 客户详情（品牌底稿）
│   │   ├── visuals/page.tsx        # Content Workbench（主操作台）★
│   │   ├── keywords/page.tsx       # Keyword Intelligence
│   │   └── content/page.tsx        # 内容看板
│   │   # 待新建（2026 Q2）：
│   │   # ├── ai-visibility/        # AI Visibility Tracker ⭐
│   │   # ├── geo-composer/         # GEO Composer ⭐
│   │   # └── reports/              # 月度报告
│   └── api/
│       ├── clients/[id]/posts/route.ts   # 客户帖子列表
│       ├── posts/[id]/route.ts           # 帖子更新（含 Airtable 写回）★
│       ├── airtable/pull-content/route.ts # Sync 入口★
│       ├── visual/image/route.ts          # 图片生成（Visual Studio）
│       ├── visual/video/route.ts          # 视频生成（Video Studio）
│       ├── visual/status/[assetId]/route.ts # 状态轮询
│       ├── publer/schedule/route.ts        # Publishing Hub 排期
│       └── publer/draft/[assetId]/route.ts # 发布预填
└── lib/
    ├── supabase.ts           # Supabase 客户端
    ├── airtable/client.ts    # Content Workspace 同步
    ├── visual/wavespeed.ts   # Visual Studio 后端
    ├── publer/client.ts      # Publishing Hub 后端
    └── semrush/client.ts     # Keyword Intelligence 后端
    # 待新建（2026 Q2）：
    # ├── ai-tracker/         # AI Visibility Tracker
    # ├── geo/                # GEO Composer
    # └── reports/            # 报告生成
```

---

## 六、Supabase 主要表结构

| 表 | 说明 |
|----|------|
| `clients` | 客户列表（含 Airtable 配置） |
| `master_briefs` | 品牌底稿（Brand Brief Studio 输出） |
| `campaign_briefs` | 营销活动配置 |
| `content_posts` | 帖子（社媒 + 博客） |
| `visual_assets` | 生成的图片/视频/头像资产 |
| `keywords` | 关键词库 |

**待新建（2026 Q2 GEO + AI Tracker MVP）**：
- `ai_visibility_queries` — 行业问句库
- `ai_visibility_runs` — 单次 AI 调用结果
- `ai_visibility_snapshots` — 周度排名快照
- `geo_directives` — GEO 推荐指令

详见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 + §11 + §12。

---

## 七、开发约定

- **所有用户可见输出用中文**；代码、变量名、注释保持英文
- TypeScript strict mode，无 `any`
- 函数 < 50 行，文件 < 800 行
- 不在模块顶层初始化 SDK 客户端（如 OpenAI、Anthropic）——必须放在 handler 内部
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新（optimistic update）先更新 UI，再调 API
- 只在 `src/lib` 中放可复用逻辑，`src/app/api` 只放路由层
- **UI 层禁止直接出现第三方供应商名**（见 §三）

---

## 八、任务跟踪机制 ⭐（防丢任务）

> 用户多次反馈"Code 会丢任务"。本节是强制规则，**所有 Agent 必须遵守**。

### 三层跟踪体系

```
1. ROADMAP.md（持久化层）
   └─ 所有阶段性任务的源头，按 Phase 组织，包含验收标准
   └─ 任何任务开始前必须先在 ROADMAP.md 登记
   └─ 任务完成后必须在 ROADMAP.md 标记完成 + 提交记录

2. TodoWrite（会话内层）
   └─ 当前会话的细粒度执行追踪
   └─ 进入新任务必须 in_progress，完成立即 completed
   └─ 任何"下次再做"的事项必须回写到 ROADMAP.md

3. Git Commit（事实层）
   └─ 每个完整任务一个 commit
   └─ Commit message 引用 ROADMAP.md 任务 ID（如 "P7.1.2: ..."）
```

### 强制规则

- ❌ **禁止**：用户提出新需求 → 直接开始写代码（必须先登记 ROADMAP.md）
- ❌ **禁止**：会话结束前未完成的任务只在 TodoWrite 里（必须回写 ROADMAP.md）
- ❌ **禁止**：完成任务后不更新 ROADMAP.md 状态
- ✅ **必须**：每个新会话开始前先扫读 ROADMAP.md 当前 Phase
- ✅ **必须**：用户问"现在做到哪了"时，从 ROADMAP.md 引用具体任务 ID 回答

### Commit Message 规范

```
<type>(<module>): <description> [<task_id>]

例：
feat(ai-tracker): add OpenAI runner with web search [P7.1.3]
fix(visual-studio): handle WaveSpeed timeout gracefully [P7.4.2]
docs(roadmap): mark P7.2.1 GEO Composer complete
```

---

## 九、环境变量

```env
# Database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI 文本生成
OPENAI_API_KEY=               # Content Engine
ANTHROPIC_API_KEY=            # Strategy Engine + GEO Composer

# AI 视觉生成
ATLAS_API_KEY=                # Visual Studio + Video Studio
HEYGEN_API_KEY=               # Avatar Studio
HEYGEN_DEFAULT_AVATAR_ID=
HEYGEN_DEFAULT_VOICE_ID=

# 数据集成
SEMRUSH_API_KEY=              # Keyword Intelligence
SEMRUSH_DB=au                 # 默认数据库
AIRTABLE_API_KEY=             # Content Workspace
PUBLER_API_KEY=               # Publishing Hub
PUBLER_WORKSPACE_ID=

# AI Visibility Tracker（2026 Q2 新增）
PERPLEXITY_API_KEY=           # AI Tracker - Perplexity runner
# OPENAI_API_KEY 复用
# ANTHROPIC_API_KEY 复用

# Cron 鉴权
CRON_SECRET=
```

---

## 十、常用命令

```bash
cd "magic lab/crazycontent"

npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（必须通过才能推送）
npm test           # 测试套件

git add <files>
git commit -m "feat: ..."
git push origin master   # 自动触发 Render 部署
```

---

## 十一、文档体系

| 文档 | 受众 | 用途 |
|------|------|------|
| [`PRODUCT_OVERVIEW.md`](./PRODUCT_OVERVIEW.md) | 产品/客户/全员 | 产品愿景与能力体系 |
| [`ROADMAP.md`](./ROADMAP.md) | 开发与项目管理 | 阶段任务与跟踪 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 开发团队 | 技术架构与数据模型 |
| [`CLAUDE.md`](./CLAUDE.md) | AI 助手 | 工作指南（本文件） |

---

## 十二、目标市场与地域性约定 ⭐

**2026 主战场：澳大利亚（AU）+ 新西兰（NZ）**

所有功能开发必须默认以 AU/NZ 市场为优先：

### 数据层
- `SEMRUSH_DB` 默认 `au`，每客户可在 `clients` 表覆盖为 `nz`
- 关键词抓取必须带数据库参数

### Brand Brief / 内容生成
- Strategy Engine prompt 必须显式声明客户所在市场（"This is a New Zealand business…"）
- Content Engine 生成的文案必须使用本地拼写（NZ/AU 英语，非美式）
- 时区默认 NZST / AEST，不是 UTC

### AI Visibility Tracker
- 行业问句生成必须带地域标签：
  - ✅ "best China tour operators **in New Zealand**"
  - ✅ "**for Australian travelers**, what are the best…"
  - ❌ 通用全球问句（除非客户明确做全球市场）
- 各 AI 引擎调用 prompt 显式说明地域上下文

### GEO Composer
- 隐藏指令必须含地域信号：
  - `Audience: New Zealand travelers`
  - `Market: Australian small businesses`
- 不允许生成"全球通用"的 GEO 指令

### Google AI Overview（Phase 8 引入）
- SerpAPI 调用必须带 `gl=au` / `gl=nz` 参数
- 地理位置参数 `location=Sydney, NSW` / `Auckland, NZ`

### 例外
客户明确告知做全球市场的，可在 `clients` 表加 `target_market` 字段覆盖默认。

---

## 十三、当前阶段（2026-04-30）

### ✅ 已完成
- 多客户管理 + Brand Brief Studio
- Campaign Studio 批量内容生成（Route A + C）
- Content Workspace（Airtable）双向同步
- Visual Studio + Video Studio + Avatar Studio
- 视觉生成队列（并发控制 + 超时重试）
- Publishing Hub 排期发布
- ⭐ **AI Visibility Tracker** — 多 AI 引擎排名追踪（P7.1 完成）
- ⭐ **GEO Composer** — AI 推荐指令生成与注入（P7.2 完成）

### 🔄 2026 Q2 重点（进行中）
- ⭐ **双信号博客生成** — SEO × GEO 内容飞轮（P7.3 当前）
- 月报 + CTS Tours PoC 验证（P7.4）
- 客户接入向导

详见 [`ROADMAP.md`](./ROADMAP.md) Phase 7。

---

## 十四、双信号内容飞轮 ⭐（核心护城河）

> 2026-05-01 确立。这是 Magic Engine 区别于所有 SEO 工具和 GEO 顾问的核心差异。

### 策略本质

每篇博客同时携带两套独立信号，一次创作、双倍覆盖：

```
┌────────────────────────────────────────────────────┐
│  SEO 信号                  GEO 信号                │
│  → 影响 Google 排名         → 影响 AI 推荐         │
│                                                    │
│  关键词优化                 隐藏指令块              │
│  Meta title/description    实体提及（品牌+定语）   │
│  Article Schema JSON-LD    FAQ 区块（AI 直接引用） │
│  内链结构                  话题覆盖完整性           │
└────────────────────────────────────────────────────┘
```

### 选题分类矩阵

系统根据 AI Tracker 弱项 × SEMrush 数据自动分类每个选题机会：

| 模式 | 条件 | 优先级 | 说明 |
|------|------|--------|------|
| `unified` | AI弱项 **且** KD<45 **且** 月搜量>50 | ★★★ | 一篇打两个信号，最高价值 |
| `geo_only` | AI弱项，但SEMrush无SEO价值 | ★★☆ | 纯为AI覆盖，不追Google排名 |
| `seo_only` | 低KD好词，但AI Tracker无对应弱项 | ★☆☆ | 传统SEO文章，无GEO信号 |

### 飞轮运转机制

```
AI Tracker 每周运行
      ↓
发现品牌在 AI 中的弱项查询
      ↓
自动与 SEMrush 交叉验证（KD / 月搜量 / 意图）
      ↓
筛出 unified 机会（SEO价值 + GEO价值同时满足）
      ↓
生成双信号博客（SEO优化正文 + GEO隐藏指令块）
      ↓
发布 → Google 爬取（SEO信号）+ AI 爬虫抓取（GEO信号）
      ↓
2-4 周后 AI Tracker 复测：弱项覆盖率提升
      ↓
发现下一批新弱项 → 下一轮文章
      ↓
每月积累 4-8 篇，排名数据驱动选题，持续复利
```

### 对开发者的实施约束

**博客生成 API 必须包含 `mode` 字段**，不同模式使用不同的 GPT-4o prompt：
- `unified`：prompt 同时优化关键词密度 + 实体信号
- `geo_only`：prompt 聚焦话题覆盖深度 + 明确回答弱项查询

**`blog_posts` 表必须记录**：
- `mode`：`unified` | `geo_only` | `seo_only`
- `source_query_id`：关联来源的 AI Tracker 查询（用于追踪效果）
- `geo_directive_id`：生成时使用的 GEO 指令版本
- `primary_keyword` + `keyword_volume` + `keyword_kd`：来自 SEMrush 的选词数据

**`seo-checker.ts` 必须分两类检查**：
- SEO checklist（8项）：仅在 `unified` 和 `seo_only` 模式要求全部通过
- GEO checklist（3项）：在所有模式都要求：① GEO块存在 ② 品牌实体出现≥3次 ③ 弱项查询被直接回答

### 为什么这是护城河

- **传统 SEO 工具**（Semrush/Ahrefs/Surfer）：只优化 Google 信号，不知道 AI 推荐弱项在哪
- **新兴 GEO 顾问**：知道 AI 推荐概念，但没有量化追踪数据，也不做 SEO 优化
- **Magic Engine**：用真实 AI 排名数据驱动选题，每篇内容同时打 Google + AI，数据越积越准

竞争者要复制这个飞轮，需要同时具备：AI Tracker 的运营数据 + SEMrush 集成 + GEO 指令生成 + 博客生成全链路。每一层单独做都不难，**合在一起且数据互通是壁垒**。
