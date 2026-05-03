# HiBiz — Agent 工作指南

## 产品

- **HiBiz**（Magic Lab 旗下）：新西兰本地商家的 AI 微站 + 表单引擎。
- Phase 1 行业：**房地产**（获客工作台首期聚焦）；**留学移民**暂缓主推；无餐厅。工作台规划见 [WORKBENCH_PLAN.md](./WORKBENCH_PLAN.md)。
- 详细规格见 Obsidian：`01-Magiclab/Projects/HiBiz/`。
- 项目全景见 [PROJECT.md](./PROJECT.md)，路线图见 [ROADMAP.md](./ROADMAP.md)。
- **集成方向（工程）**：功能上优先 **建站 + 表单**；独立站侧封装 **Plasmic / Builder.io / 无头 CMS** 补可编辑块与多页，少接整站外链 SaaS。表单在自有引擎外可选 **Tally/Typeform 嵌入 + Webhook** 或 **Formbricks 自托管**。详见 [WORKBENCH_PLAN.md](./WORKBENCH_PLAN.md) §0。

## 技术栈

| 层 | 技术 |
|----|------|
| Framework | Next.js 14 App Router, TypeScript strict |
| UI | React 18 + Tailwind 3.4 |
| Backend | Supabase Auth + Postgres + RLS |
| AI | OpenAI API (gpt-4o-mini), Structured Output |
| URL 提取 | TradeMe API (OAuth 1.0a) / `__NEXT_DATA__` / Jina Reader + LLM（三层 fallback） |
| Deploy | Render（生产环境）；`Root Directory: hibiz/`；域名 `hibiz-service.onrender.com` |

## 核心架构

### 路径 A：自然语言创建（原有流程）

```
用户 raw_prompt
  → Rule Guard（正则预过滤、城市/语言检测）
  → LLM Compiler（意图编译 → CompiledIntentV1）
  → 用户确认
  → LLM Copy Generator + Form Builder（并行）
  → assembleRenderModel（确定性装配）
  → Schema 校验 + 合规过滤
  → RenderModelV1 → 草稿预览 → 发布
```

### 路径 B：骨架模板创建（v0.2.2 新增）

```
用户选行业 → 选骨架 → 填基本信息（name/phone/email/logo/QR）
  → AI 自动填充文案（中英文）
  → 联系方式自动带入海报
  → assembleRenderModel（骨架模式）
  → 预览 → 微调（开关模块、换配色、改文字）
  → 发布
```

**骨架不是新的渲染层**：骨架 = CompiledIntent 的预设值，最终走现有装配管线。

### 关键文件映射

| 功能 | 文件 |
|------|------|
| 意图编译（规则） | `src/lib/compiler/rule-based.ts` |
| 文案生成 | `src/lib/generation/openai-copy.ts` |
| 表单预设 | `src/lib/generation/form-presets.ts` |
| 模型装配 | `src/lib/generation/assemble.ts` |
| 类型定义 | `src/types/compiled-intent.ts`, `render-model.ts` |
| 模板预设 | `src/data/template-presets.ts` |
| Server Actions | `src/app/app/projects/intent-actions.ts`, `generation-actions.ts` |
| URL 提取（三层） | `src/lib/extraction/`（`trademe-api.ts`, `extract-next-data.ts`, `jina-reader.ts`, `extract-listing.ts`） |
| 提取编排 | `src/lib/extraction/extraction-layers.ts`（Layer 0→1→2 fallback） |
| 海报 LLM 提示词建议 | `src/lib/poster/poster-llm-prompt-suggestion.ts`（基于已写入 `property_promo`） |
| 图片代理 | `src/lib/extraction/image-proxy.ts`（→ Supabase Storage） |
| 读库 URL 兼容 | `src/lib/extraction/legacy-url.ts`（`coercePersistedTradeMeImageUrl`） |
| 商家信息 | `src/types/merchant-profile.ts`, `merchant-profile-actions.ts` |
| 骨架类型 | `src/types/skeleton.ts`（待创建） |
| 骨架数据 | `src/data/skeletons/`（待创建） |
| 骨架 AI 填充 | `src/lib/generation/skeleton-fill.ts`（待创建） |
| Builder.io 可选区块（公开微站） | `src/components/builder/BuilderMicrositeSection.tsx`；`merchant_profile.builder_section_*` |

## 约定

- 不在浏览器暴露 `service_role`。
- 匿名表单提交由 Server Action 写入 `submissions`（已实现，含蜜罐 + 限流）。
- **开放输入，封闭执行**：LLM 只做意图解析和文案填充，模块选择和渲染由代码控制。
- LLM 输出必须经过 Schema 校验，禁止直接渲染未校验的 LLM 输出。
- 所有枚举值（industry, scene, module type, field type）封闭定义在 TypeScript 类型中。
- **骨架原则**：骨架是预设配置，不是新的渲染引擎。模块 type 和 variant 必须在封闭枚举内。

## 编码规范

- TypeScript 严格模式，禁止 `any`
- 组件 props 必须有 interface
- 文件 < 400 行，函数 < 50 行
- 不可变数据模式：创建新对象，不修改已有对象
- 错误显式处理，不静默吞掉

## AI 工程约定

- **编译器分层**：Rule Guard（零成本、确定性） → LLM Compiler（需 API、有成本）
- **成本控制**：编译失败不触发生成；用户确认后才调 Copy Generator
- **可审计**：CompiledIntent 是中间层，用户确认的是"意图"而非"页面代码"
- **Structured Output**：LLM 调用必须使用 `response_format: { type: "json_object" }` 或 JSON Schema
- **Fallback**：LLM 输出字段缺失时使用 `coerceString()` 等函数提供默认值

## URL 提取管线（v0.2.1）

三层 fallback 架构：

```
Layer 0: TradeMe Official API（OAuth 1.0a，最可靠）
  → trademe-api.ts: fetchListingFromApi(url)
  → 自动检测 sandbox/production

Layer 1: __NEXT_DATA__ 解析（零 LLM 成本）
  → extract-next-data.ts: extractFromNextData(url)

Layer 2: Jina Reader Pro + OpenAI（最后手段）
  → jina-reader.ts → extract-listing.ts
  → 支持 X-Wait-For-Selector、X-Timeout

编排: extraction-layers.ts → extractTradeMeListingMultiLayer(url)
图片: image-proxy.ts → proxyImagesToStorage()
海报: poster-llm-prompt-suggestion.ts（导入成功后由海报页展示可复制提示词）
```

### 自动填充映射

| 提取字段 | 填充目标 |
|---------|---------|
| title | `merchant_profile.property_promo.headline` |
| description | `merchant_profile.property_promo.details` |
| images | `merchant_profile.property_promo.trademe_image_urls` |
| images[0] | `merchant_profile.property_promo.image_url` |
| title + images[0] | 微站 hero 模块 |
| 全部数据 | 海报 |

## 骨架模板系统（v0.2.2）

### 数据流

```
TemplateSkeleton（静态 JSON）
  + MerchantProfile（用户输入）
  + AI 文案（LLM 生成）
  → assembleRenderModel()（已有装配器）
  → RenderModelV1
```

### 联系方式 → 海报自动映射

| 用户输入 | 微站 | 海报 |
|---------|------|------|
| name | hero / about | agent 姓名 |
| phone | contact / hero CTA | 联系电话 |
| email | contact | 联系邮箱 |
| logo_url | navbar / footer | logo |
| wechat_qr_url | contact | 二维码 |
| whatsapp | contact | WhatsApp 链接 |

### 手动房源

存储在 `merchant_profile.property_listings[]`（JSON 数组），不新增数据库表。每个房源：name, address, description, images[], bedrooms?, bathrooms?, price_hint?, trademe_url?（跳转链接，非同步）。

## 禁止

- 勿将 HiBiz 与根目录 Magic Lab **静态 export** 站混为同一部署目标
- 禁止让 LLM 直接生成 RenderModel 或 HTML
- 禁止在表单中使用不在封闭字段类型枚举内的 type
- 禁止硬编码联系信息、API key
- 禁止「包过」「保证批签」等合规违规文案
- 禁止骨架模块使用不在 RenderModuleType 枚举内的 type
- 禁止实现拖拽编辑器（手机端体验差，用 toggle + contentEditable）

## Agent 使用指南

| 场景 | 推荐 Agent |
|------|-----------|
| 新功能开发 | `planner` → `tdd-guide` → `code-reviewer` |
| 编译器 / AI 管线改动 | `architect` → `security-reviewer` |
| 组件重构 | `refactor-cleaner` → `code-reviewer` |
| 构建失败 | `build-error-resolver` |

## 输出语言

所有对话用中文。
