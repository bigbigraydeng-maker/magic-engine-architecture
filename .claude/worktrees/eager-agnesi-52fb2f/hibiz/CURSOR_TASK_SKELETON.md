# Cursor 任务：骨架模板系统 v0.2.2

> 本文件为 Cursor AI 编程助手的实施指南。请按 Phase 顺序执行，每个 Phase 完成后可独立验证。

## 总览

实现"预制骨架 + AI 填肉"模板系统，让用户 3 步创建专业微站：选骨架 → 填信息 → 发布。

**核心原则**：骨架不是新的渲染引擎。骨架 = CompiledIntent 的一组预设值，最终走现有 `assembleRenderModel()` 管线。

## 现有架构（必读）

- 类型：`src/types/render-model.ts`（RenderModelV1, RenderModuleType）
- 类型：`src/types/compiled-intent.ts`（CompiledIntentV1）
- 类型：`src/types/merchant-profile.ts`（MerchantProfileV1, PropertyPromoV1）
- 装配：`src/lib/generation/assemble.ts`（assembleRenderModel）
- 文案：`src/lib/generation/openai-copy.ts`（generateCopy）
- 表单：`src/lib/generation/form-presets.ts`（buildFormPreset）
- 预设：`src/data/template-presets.ts`（TEMPLATE_PRESETS_ALL）
- 新建页：`src/app/app/projects/new/page.tsx`
- Server Actions：`src/app/app/projects/actions.ts`
- 商家 Actions：`src/app/app/projects/merchant-profile-actions.ts`

---

## Phase 0: 类型与骨架数据（先做这个）

### 0.1 创建 `src/types/skeleton.ts`

```typescript
import type { RenderModuleType } from "@/types/render-model";

export interface ColorPalette {
  id: string;
  name: string;
  primary: string;
  accent: string;
  background: string;
}

export interface SkeletonTheme {
  primary: string;
  accent: string;
  background: string;
  fontFamily: string;
  palettes: ColorPalette[];
}

export interface SkeletonModule {
  type: RenderModuleType;
  variant: string;
  visible: boolean;
  defaultContent?: Record<string, unknown>;
}

export type SkeletonIndustry = "real_estate" | "immigration_education";

export interface TemplateSkeleton {
  id: string;
  name: string;
  nameEn: string;
  industry: SkeletonIndustry;
  description: string;
  thumbnail: string;
  modules: SkeletonModule[];
  theme: SkeletonTheme;
  defaultFormTemplate: string;
}
```

### 0.2 扩展 `RenderModuleType`

在 `src/types/render-model.ts` 中：

```typescript
// 当前：
export type RenderModuleType = "hero" | "offer" | "form" | "faq" | "about" | "contact" | "footer";

// 改为：
export type RenderModuleType = "hero" | "offer" | "form" | "faq" | "about" | "contact" | "footer" | "listings" | "testimonials" | "openHome" | "services";
```

同时为新模块类型添加 Content interface 和 RenderModuleV1 union member。

### 0.3 扩展 `MerchantProfileV1`

在 `src/types/merchant-profile.ts` 中：

```typescript
// 在 MerchantContactV1 中新增：
export interface MerchantContactV1 {
  phone?: string;
  email?: string;
  address?: string;
  // 新增：
  whatsapp?: string;         // WhatsApp 号码（如 6421xxxxxxx）
  wechat_qr_url?: string;    // 微信二维码图片 URL
  xiaohongshu_url?: string;  // 小红书链接
}

// 在 MerchantProfileV1 中新增：
export interface MerchantProfileV1 {
  schema_version: 1;
  contact?: MerchantContactV1;
  property_promo?: PropertyPromoV1;
  // 新增：
  display_name?: string;         // 显示名称
  company_name?: string;         // 公司名称
  logo_url?: string;             // Logo 图片 URL
  avatar_url?: string;           // 头像 URL
  bio_zh?: string;               // 中文简介（AI 可生成）
  bio_en?: string;               // 英文简介（AI 可生成）
  skeleton_id?: string;          // 选用的骨架 ID
  theme_overrides?: {            // 配色覆盖
    palette_id?: string;
    primary?: string;
    accent?: string;
    background?: string;
  };
  module_visibility?: Record<string, boolean>;  // 模块显示/隐藏
  property_listings?: PropertyListing[];        // 手动房源列表
}

// 新增：手动房源
export interface PropertyListing {
  id: string;                // 唯一 ID（nanoid）
  name: string;              // 房源名称
  address: string;           // 地址
  description: string;       // 介绍
  images: string[];          // 图片 URL（Supabase Storage）
  bedrooms?: number;
  bathrooms?: number;
  price_hint?: string;       // "Auction", "$850,000" 等
  trademe_url?: string;      // 可选 TradeMe 跳转链接
  sort_order: number;
}
```

更新 `parseMerchantProfile()` 函数以支持新字段。

### 0.4 创建骨架数据

创建 `src/data/skeletons/` 目录：

**`src/data/skeletons/classic-agent.ts`**
```typescript
import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_CLASSIC_AGENT: TemplateSkeleton = {
  id: "classic-agent",
  name: "经典中介",
  nameEn: "Classic Agent",
  industry: "real_estate",
  description: "专业稳重，突出个人品牌",
  thumbnail: "/skeletons/classic-agent.png",
  modules: [
    { type: "hero", variant: "agent-photo", visible: true },
    { type: "listings", variant: "card-grid", visible: true },
    { type: "about", variant: "side-by-side", visible: true },
    { type: "testimonials", variant: "quote-cards", visible: true },
    { type: "openHome", variant: "timeline", visible: true },
    { type: "form", variant: "default", visible: true },
    { type: "contact", variant: "full-channels", visible: true },
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#1e3a5f",
    accent: "#c9952c",
    background: "#ffffff",
    fontFamily: "inter",
    palettes: [
      { id: "navy-gold", name: "深蓝金", primary: "#1e3a5f", accent: "#c9952c", background: "#ffffff" },
      { id: "slate-emerald", name: "石板翠", primary: "#334155", accent: "#059669", background: "#f8fafc" },
      { id: "charcoal-coral", name: "炭灰珊瑚", primary: "#1f2937", accent: "#f43f5e", background: "#ffffff" },
    ],
  },
  defaultFormTemplate: "open_home_registration",
};
```

**`src/data/skeletons/property-showcase.ts`** — 图片驱动风格
**`src/data/skeletons/bilingual-pro.ts`** — 中英双语风格

**`src/data/skeletons/index.ts`**
```typescript
import { SKELETON_CLASSIC_AGENT } from "./classic-agent";
import { SKELETON_PROPERTY_SHOWCASE } from "./property-showcase";
import { SKELETON_BILINGUAL_PRO } from "./bilingual-pro";
import type { TemplateSkeleton, SkeletonIndustry } from "@/types/skeleton";

export const ALL_SKELETONS: readonly TemplateSkeleton[] = [
  SKELETON_CLASSIC_AGENT,
  SKELETON_PROPERTY_SHOWCASE,
  SKELETON_BILINGUAL_PRO,
] as const;

export function getSkeletonById(id: string): TemplateSkeleton | undefined {
  return ALL_SKELETONS.find((s) => s.id === id);
}

export function getSkeletonsByIndustry(industry: SkeletonIndustry): readonly TemplateSkeleton[] {
  return ALL_SKELETONS.filter((s) => s.industry === industry);
}
```

---

## Phase 1: 创建流程 UI

### 1.1 重构 `src/app/app/projects/new/page.tsx`

改为分步创建流程。用 `searchParams.step` 控制步骤（无需客户端状态库）：

```
/app/projects/new                → Step 1: 选创建方式（骨架 or 自然语言）
/app/projects/new?step=skeleton  → Step 2: 选骨架
/app/projects/new?step=info      → Step 3: 填基本信息
/app/projects/new?step=preview   → Step 4: 预览
```

保留原有自然语言入口作为"高级模式"。

### 1.2 新增组件

**`src/components/skeleton-picker.tsx`**
- 手机端 1 列、桌面端 2-3 列网格
- 每个骨架：预览图 + 名称 + 描述 + 选择按钮
- 选中状态：border-emerald-600 高亮

**`src/components/module-toggle-list.tsx`**
- 骨架模块列表，每个带 toggle switch
- hero 和 footer 不可关闭（灰色 toggle）
- 其余模块可自由开关

**`src/components/theme-palette-picker.tsx`**
- 3-5 个圆形色板预览
- 选中态：ring + scale

### 1.3 Step 3 表单字段

```
── 基本信息 ──────────────────
姓名 *           [text]
公司名称          [text]
手机号 *          [tel]
邮箱              [email]

── 品牌素材 ──────────────────
头像照片          [file upload → Supabase Storage]
公司 Logo         [file upload → Supabase Storage]
微信二维码        [file upload → Supabase Storage]
WhatsApp 号码     [tel]

── 可选 ──────────────────────
一句话 Slogan     [text, placeholder: AI 可自动生成]
服务区域          [text, placeholder: 如 Auckland Central, North Shore]
TradeMe 链接      [url, 可选：自动导入首个房源]
```

### 1.4 手动房源管理

在 Step 3 或项目详情页添加房源管理区块：

**`src/components/property-listing-editor.tsx`**
- 卡片列表，每张：缩略图 + 名称 + 地址 + 操作按钮
- 新增按钮 → 展开内联表单：
  - 名称 *（text）
  - 地址 *（text）
  - 介绍（textarea）
  - 图片上传（多选，上传到 Supabase Storage）
  - 卧室数（number）、浴室数（number）
  - 价格提示（text）
  - TradeMe 链接（url，可选，显示为"查看 TradeMe"跳转按钮）
- 删除需确认
- 拖拽排序不做，用 ↑↓ 按钮调整顺序

---

## Phase 2: AI 填充引擎

### 2.1 创建 `src/lib/generation/skeleton-fill.ts`

```typescript
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { TemplateSkeleton } from "@/types/skeleton";
import type { RenderModelV1 } from "@/types/render-model";

/**
 * 确定性填充：从 merchant_profile + skeleton 生成 RenderModel。
 * 不调用 LLM，纯映射。
 */
export function fillSkeletonDeterministic(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  formId: string;
  publicSlug: string;
}): RenderModelV1 {
  // 1. 遍历 skeleton.modules（仅 visible 的）
  // 2. 根据 module type 映射 profile 数据到 content
  // 3. 联系方式映射：
  //    - name → hero.title, about.heading
  //    - phone → contact.lines, hero CTA
  //    - email → contact.lines
  //    - whatsapp → contact.lines (wa.me/... 链接)
  //    - wechat_qr_url → contact 模块渲染 QR 图片
  //    - logo_url → footer.brand 区域
  // 4. 房源数据 → listings 模块
  // 5. 返回 RenderModelV1
}

/**
 * 海报数据自动填充：从 profile 提取联系方式。
 * 海报渲染时调用，确保 name/phone/email/logo/QR 自动出现。
 */
export function buildPosterContactFromProfile(profile: MerchantProfileV1): {
  name: string;
  phone: string;
  email: string;
  logo_url: string | null;
  wechat_qr_url: string | null;
  whatsapp_url: string | null;
} {
  // 映射 profile 字段到海报联系区域
}
```

### 2.2 修改 `src/lib/generation/assemble.ts`

添加骨架模式入口：

```typescript
export function assembleRenderModelFromSkeleton(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  copy?: GeneratedCopyV1;      // AI 生成的文案（可选）
  formId: string;
  publicSlug: string;
}): RenderModelV1 {
  // 1. 使用 fillSkeletonDeterministic 做基础填充
  // 2. 如果有 copy，用 AI 文案覆盖占位内容
  // 3. 应用 theme_overrides（配色覆盖）
  // 4. 应用 module_visibility（开关）
  // 5. 返回完整的 RenderModelV1
}
```

保留原有 `assembleRenderModel()` 不动，新增函数。

### 2.3 海报联系方式自动带入

修改海报渲染组件，从 `merchant_profile` 自动读取：

```
name     → 海报 agent 姓名区域
phone    → 海报电话区域
email    → 海报邮箱区域
logo_url → 海报 logo 区域
wechat_qr_url → 海报二维码区域
whatsapp → 海报 WhatsApp 区域
```

如果这些字段在 profile 中存在，海报必须自动显示，无需用户手动粘贴。

### 2.4 Server Action

在 `merchant-profile-actions.ts` 或新文件中：

```typescript
"use server";

export async function createProjectFromSkeleton(formData: FormData): Promise<void> {
  // 1. 验证用户已登录
  // 2. 从 formData 提取：skeleton_id, name, company, phone, email, ...
  // 3. 上传图片到 Supabase Storage（avatar, logo, wechat_qr）
  // 4. 创建 project（status: "ready_draft"）
  // 5. 构建 MerchantProfileV1
  // 6. 可选：调用 generateSkeletonCopy() 生成 AI 文案
  // 7. 调用 assembleRenderModelFromSkeleton() 装配
  // 8. 保存 draft_model + merchant_profile
  // 9. redirect 到预览页
}
```

---

## Phase 3: 微调编辑

### 3.1 模块开关

在预览页右侧（桌面）或底部（手机）添加编辑面板：

- Toggle switch 列表，每个模块一行
- 改变后立即调用 Server Action 更新 `module_visibility`
- 重新装配 RenderModel 并刷新预览

### 3.2 配色切换

- 骨架定义中的 `palettes` 数组渲染为色板选择器
- 选择后更新 `theme_overrides.palette_id`
- 预览立即更新

### 3.3 行内编辑

- 文字内容点击后变为 contentEditable
- blur 时保存到对应字段
- 用 `data-field-path` 属性标记可编辑位置

### 3.4 图片替换

- 图片点击后弹出文件选择
- 上传到 Supabase Storage
- 替换对应 URL

---

## Phase 4: 表单模板

### 4.1 修改 `src/lib/generation/form-presets.ts`

新增独立于 CompiledIntent 的表单预设函数：

```typescript
export type FormTemplateId = "open_home_registration" | "buyer_inquiry" | "property_valuation";

export function buildFormFromTemplate(templateId: FormTemplateId): FormFieldsFileV1 {
  switch (templateId) {
    case "open_home_registration":
      return {
        schema_version: 1, version: 1,
        fields: [
          { key: "full_name", label: "Full name", placeholder: "Your name", type: "text", required: true, max_length: 120 },
          { key: "phone", label: "Phone", placeholder: "NZ mobile", type: "phone", required: true, max_length: 40 },
          { key: "email", label: "Email", placeholder: "name@example.com", type: "email", required: true, max_length: 200 },
          { key: "attendee_count", label: "How many attending?", placeholder: "e.g. 2", type: "text", required: false, max_length: 20 },
          { key: "preferred_time", label: "Preferred time", placeholder: "", type: "select", required: false, options: ["Morning", "Afternoon", "Either"] },
          { key: "message", label: "Message", placeholder: "Any questions?", type: "textarea", required: false, max_length: 800 },
        ],
      };
    case "buyer_inquiry":
      // 预算范围、偏好区域、房型、时间线
    case "property_valuation":
      // 地址、房型、卧室数
  }
}
```

---

## 验证清单

Phase 0 完成后：
- [ ] `tsc --noEmit` 无类型错误
- [ ] `getSkeletonById("classic-agent")` 返回正确骨架

Phase 1 完成后：
- [ ] 手机端可正常浏览 4 步创建流程
- [ ] 骨架选择后能看到骨架名称和描述
- [ ] 基本信息表单含所有必填字段
- [ ] 可添加/编辑/删除手动房源
- [ ] 图片可上传到 Supabase Storage

Phase 2 完成后：
- [ ] 从骨架创建项目，生成完整 RenderModel
- [ ] 海报自动显示 name/phone/email/logo/QR
- [ ] AI 文案中英文可正确生成
- [ ] 手动房源显示在 listings 模块

Phase 3 完成后：
- [ ] 可开关模块（hero/footer 不可关闭）
- [ ] 可切换配色方案
- [ ] 可行内编辑文字
- [ ] 可替换图片

Phase 4 完成后：
- [ ] 3 种表单模板可选
- [ ] 表单提交正常写入 submissions 表

---

## 注意事项

1. **不要改现有 assembleRenderModel()**，新增 assembleRenderModelFromSkeleton()
2. **不新增数据库表**，所有数据存 merchant_profile JSON
3. **不做拖拽编辑器**，手机端用 toggle + contentEditable
4. **图片上传用现有 Supabase Storage bucket**（listing-images 或新建 merchant-assets）
5. **骨架预览图**：暂用空白占位，后续设计
6. **文件 < 400 行**，超出就拆分
