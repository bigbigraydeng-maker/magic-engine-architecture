# HiBiz — 产品与技术全景

> 最后更新：2026-04-15

## 一句话

HiBiz 面向 **澳大利亚与新西兰** 本地商家：用一句话生成可发布的留资微站与独立表单；登录后还可 **一键生成最小建站草稿**，并用 **Builder.io** 增加可选可视化区块（不把整站托管到外链 SaaS）。同期推进 **获客工作台**（战役编排、任务与社媒/SEO 执行面），**首期垂直主推房产中介**；**留学移民模板仍在产品中，对外营销与投放暂缓**。

## 产品定位

| 维度 | 定义 |
|------|------|
| 目标用户 | 澳大利亚与新西兰本地中小商家；**GTM / 工作台首期：房产中介**（留学移民：模板可用，市场主推暂缓） |
| 核心价值 | 自然语言输入 → 可发布留资微站；可选 Builder 封装增强页面；**工作台** → 可验收的获客战役与落地页联动 |
| 竞品差异 | 不是 Wix/Webflow 式自由建站；是行业垂直的 AI 填槽 + 模板渲染；可插第三方可视化块；工作台不是通用 AI OS，而是 **获客交付与执行清单** |
| 商业模式 | 免费生成 + 付费增值（自定义域名、数据导出、通知等，预留） |

## 对外首页叙事（与 `src/app/page.tsx` 一致）

- **地域**：首屏与脚注均表述为 **Australia & New Zealand**（澳新本地商家），合规提示为 **澳新取向**（非仅新西兰）。
- **行业**：两个 Phase 1 垂直（无餐饮）——**房地产**为 **Current focus**；**留学移民**为 **Templates · limited promotion**（预设仍可用，不作为当前对外主推行业）。
- **能力**：保留「一句话 → 确认意图 → 发布链接与留资」主线；并说明登录后可 **一键草稿 + 可选 Builder.io 区块**。

工作台与 **第三方集成优先级**（建站/表单封装）见 [WORKBENCH_PLAN.md](./WORKBENCH_PLAN.md)（§0）。

## 核心对象模型

```
User 1──* Project
Project 1──1 ProjectIntent（版本化，raw_prompt → compiled）
Project 1──1 Microsite（draft_model / published_model）
Project 1──* Form（MVP 通常 1 个）
Form 1──* Submission
IndustryPreset / TemplatePreset：配置数据，非用户实例
```

## 技术架构

### 整体流程

```
┌─────────────────────────────────────────────────────────────┐
│  用户输入（自然语言）                                        │
│  "I want an open home registration page for my Auckland     │
│   3-bed listing this Sunday 2-3pm"                          │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Stage 1: 意图编译                                           │
│  Rule Guard → LLM Compiler → CompiledIntent                 │
│  输出: industry, scene, city, language, module_selection,    │
│        form_field_hints, business_context                    │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  用户确认（Understanding Summary UI）                        │
│  可修改行业、场景、城市、语言、是否需要表单                   │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Stage 2: 并行生成                                           │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ Copy Generator   │  │ Form Builder     │                  │
│  │ (LLM → 文案)     │  │ (LLM → 字段选取) │                  │
│  └────────┬────────┘  └────────┬────────┘                   │
│           └────────┬───────────┘                             │
│                    ▼                                          │
│  Stage 3: 装配 + 校验                                        │
│  assembleRenderModel → Schema Validate → Compliance Filter   │
│  → RenderModel + FormFields                                  │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  草稿预览 → 用户编辑槽位 → 发布                              │
│  → /site/{slug}（微站）                                      │
│  → /forms/{public_slug}（独立表单）                          │
└──────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| Frontend | Next.js 14 App Router + React 18 + Tailwind | SSR + Server Actions |
| Auth | Supabase Auth (Magic Link) | 极简登录 |
| Database | Supabase Postgres + RLS | 行级安全 |
| AI | OpenAI API (gpt-4o-mini) | Structured Output |
| 可选可视化建站 | Builder.io（`@builder.io/sdk-react-nextjs`） | 公开微站可选区块；`merchant_profile` 开关与 urlPath 定向 |
| URL 提取 | TradeMe API (OAuth 1.0a) + Jina Reader + OpenAI | 三层 fallback 提取 |
| Deploy | Render Web Service | SSR, Root Directory: `hibiz/` |
| 安全 | 蜜罐字段 + 限流函数 + RLS | 防滥用 |

### 目录结构

```
src/
├── app/                     → Pages & Server Actions
│   ├── app/projects/        → 商家工作台（列表/新建/详情/编辑/提交记录）
│   ├── site/[slug]/         → 公开微站渲染
│   ├── forms/[public_slug]/ → 独立表单页
│   ├── auth/                → Magic Link callback
│   ├── login/               → 登录页
│   └── progress/            → 开发进度看板
├── components/              → UI 组件
├── data/                    → 配置数据（模板预设等）
├── lib/
│   ├── compiler/            → 意图编译器（rule-based, guards）
│   ├── extraction/          → URL 提取管线（Jina Reader + LLM；legacy-url 读库兼容）
│   ├── generation/          → 生成管线（OpenAI, assemble, form-presets, slugs, compliance）
│   └── supabase/            → Supabase 客户端
└── types/                   → TypeScript 类型（CompiledIntent, RenderModel, etc.）
```

## AI 工程设计原则

### 1. 开放输入，封闭执行

用户可以用任何自然语言描述需求，但系统的输出收敛在预设的封闭空间内：
- **行业**：封闭枚举（`immigration_education` | `real_estate`）
- **场景**：封闭枚举（8 种）
- **模块**：封闭池（hero, offer, form, faq, about, contact, footer）
- **表单字段类型**：封闭枚举（text, email, phone, textarea, select, multiselect）

### 2. LLM 填槽，不自由排版

LLM 的职责是：
- 理解用户意图 → 映射到封闭枚举
- 生成文案 → 填入模块的 content 槽位
- 选择表单字段 → 从字段池中选取并定制 label

LLM 不负责：
- 页面布局、模块排序（由模板决定）
- HTML/CSS 生成（由 React 组件决定）
- 数据库操作（由 Server Actions 决定）

### 3. 三层校验

| 层 | 校验内容 |
|----|---------|
| Schema 校验 | JSON 结构、枚举值、字段类型 |
| 合规过滤 | 禁用词（包过、保证批签等）、外链白名单 |
| Fallback | LLM 输出缺失时的默认值 |

### 4. 成本分层

| 操作 | 是否调 LLM | 何时触发 |
|------|-----------|---------|
| 行业/城市检测 | 否（正则） | 用户输入后立即 |
| 意图编译 | 视复杂度（规则优先） | 用户提交 prompt |
| 文案生成 | 是 | 用户确认意图后 |
| 表单生成 | 是（V2） | 用户确认意图后 |
| URL 提取 | 是（API / Jina + LLM） | 用户粘贴外部链接时 |

### 5. URL 提取管线（三层 fallback）

用户粘贴外部 URL 时，按优先级依次尝试：

```
Layer 0: TradeMe Official API（OAuth 1.0a，最可靠）
  ↓ 未配置 / 失败
Layer 1: __NEXT_DATA__ HTML 解析（零 LLM 成本）
  ↓ 无数据
Layer 2: Jina Reader Pro → Markdown → OpenAI Structured Output
  ↓
→ 质量门评分（0-100，good/partial/failed）
→ 自动填充 merchant_profile + 微站模块 + 海报
→ 图片代理到 Supabase Storage
→ 用户事后编辑
```

**设计决策**：
- **TradeMe API 为首选**：TradeMe 封锁非浏览器请求（Jina/fetch 均返回 500）
- **旧 HTML 正则管线已移除**：统一使用 `src/lib/extraction/`
- **直接填充**：不需用户确认提取结果，通过现有编辑界面事后修改
- **统一管线**：`extraction-layers.ts` 编排所有层

### 6. 骨架模板系统（v0.2.2）

预制骨架 + AI 填肉模式：

```
用户选行业 → 选骨架 → 填基本信息（name/phone/email/logo/QR）
  → AI 自动填充文案（中英文）
  → assembleRenderModel()（已有装配器）
  → 联系方式自动带入海报
  → 预览 → 微调（开关模块、换配色、改文字）→ 发布
```

**核心原则**：骨架不是新的渲染层，是 CompiledIntent 的预设值，走现有装配管线。

**手动房源**：用户可上传房源（名称、地址、图片、介绍），可选附 TradeMe 跳转链接。存储在 `merchant_profile.property_listings[]`。

## 状态机

### Project 状态

```
draft → intent_drafting → intent_ready → generating → ready_draft → published
                                      ↘ generation_failed ↗
```

### 其他状态

- `IntentCompilation`: pending | succeeded | failed | needs_clarification
- `GenerationRun`: queued | running | succeeded | failed
- `Microsite`: draft → published
- `Form`: draft | active

## 数据库迁移历史

| 迁移 | 说明 |
|------|------|
| `20260404120000_hibiz_public_rls.sql` | 公开读 + 匿名写策略 |
| `20260404200000_hibiz_lead_rate_limit_fn.sql` | `check_lead_rate_limit` 函数 |
| `20260405120000_merchant_profile.sql` | `merchant_profile` + 更新视图 |

## 行业预设（Phase 1）

**GTM 说明**：以下为产品与模板能力清单。对外营销与产品迭代当前以 **房地产** 为主；**留学移民** 场景仍可在应用内选择，但不作为首要获客行业宣传。

### 房地产 (real_estate)

| 场景 | 模块重点 | CTA |
|------|---------|-----|
| Open Home 报名 | Hero（时间地点）+ Form | Register for Open Home |
| 房源推广 | Hero（图片）+ Offer + Form | Enquire Now |
| 免费估价 | Hero + Form（地址字段） | Get Free Appraisal |
| 买家登记 | Hero + Offer + Form | Join Buyers List |

### 留学移民 (immigration_education)

| 场景 | 模块重点 | CTA |
|------|---------|-----|
| 免费评估 | Hero + Form（签证状态字段） | Get Free Assessment |
| 咨询预约 | Hero + About + Form | Book Consultation |
| 讲座报名 | Hero（日期）+ Form | Register for Seminar |
| 项目留资 | Hero + Offer + Form | Learn More |
