# HiBiz v0.4 — Phase 3 + 后台重排版 & 集成

## 概述

本任务包含 3 个部分：
1. **Phase 3：LLM Form Builder**（4-6h）— 智能表单字段生成
2. **后台页面重排版**（3-4h）— 从单列到逻辑分区的侧边栏设计
3. **Server Actions 集成**（3-4h）— 接上 Rule Guard → LLM Compiler V2

**总工作量**：~12-14 小时

---

## 问题诊断：当前后台页面

**当前文件**：`src/app/app/projects/[id]/page.tsx`（~400 行）

**问题：**
1. ❌ **单列长页面** — 所有内容垂直堆叠，用户需要不断向下滚动
2. ❌ **逻辑混乱** — Intent → Generate → Publish → Hero Edit → Merchant Profile → Preview 没有清晰分组
3. ❌ **表单碎片化** — 多个独立表单（生成、编辑、merchant、trademark）散落各处
4. ❌ **信息过载** — 没有优先级，所有信息平行显示
5. ❌ **缺少快速导航** — 用户不知道当前在流程的哪个步骤

**用户工作流：**
```
1. 查看 Intent draft（了解当前状态）
2. 点击"生成" → 等待 AI
3. 向下滚动到"Preview"看效果
4. 修改 Hero / Merchant 信息
5. Publish
6. 分享 Live link
```

---

## 解决方案：新设计

### 新布局结构

```
┌─────────────────────────────────────────────────────────┐
│ Header: {Project Name} | Status | Links                  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ ┌──────────┐  ┌──────────────────────────────────────┐  │
│ │          │  │                                      │  │
│ │ 左侧导航  │  │         主内容区                      │  │
│ │          │  │                                      │  │
│ │ • Intent │  │ ┌─ Intent Panel ─────────────────┐  │  │
│ │ • Compile│  │ │ Draft info                      │  │  │
│ │ • Preview│  │ │ Compile status                  │  │  │
│ │ • Publish│  │ │ [Generate Button]               │  │  │
│ │ • Edit   │  │ └─────────────────────────────────┘  │  │
│ │ • Details│  │                                      │  │
│ │          │  │ ┌─ Preview Panel ─────────────────┐  │  │
│ │          │  │ │ Draft microsite preview         │  │  │
│ │          │  │ │ [3D 模拟视图]                    │  │  │
│ │          │  │ └─────────────────────────────────┘  │  │
│ │          │  │                                      │  │
│ │          │  │ ┌─ Publish Panel ──────────────────┐  │  │
│ │          │  │ │ Status / Links                  │  │  │
│ │          │  │ │ [Publish Button]                │  │  │
│ │          │  │ └─────────────────────────────────┘  │  │
│ │          │  │                                      │  │
│ └──────────┘  └──────────────────────────────────────┘  │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### 导航标签说明

| 标签 | 内容 | 用途 |
|------|------|------|
| **Intent** | Raw prompt, Industry hint, Compile status | 查看当前 intent 信息 |
| **Compile** | [v0.4] Rule Guard → LLM Compiler 结果 + 用户确认 | 使用新混合编译器 |
| **Preview** | 草稿微站预览（iframe 或 mobile view） | 实时看效果 |
| **Publish** | 发布状态 + Live links + Publish button | 一键上线 |
| **Edit** | Hero / Merchant 快速编辑表单 | 修改内容 |
| **Details** | 商家信息、房产导入、TradeMe 链接等 | 详细配置 |

### 页面组件分解

**Header（保持不变）：**
```
← Projects | {Project Name} | {Status} | [Submissions →]
[Notice Bar if exists]
```

**Left Sidebar（新增）：**
```tsx
<nav className="w-56 border-r border-stone-200 bg-stone-50 p-4">
  <div className="space-y-1">
    <NavItem icon="file" label="Intent" href="#intent" />
    <NavItem icon="zap" label="Compile" href="#compile" />
    <NavItem icon="eye" label="Preview" href="#preview" />
    <NavItem icon="rocket" label="Publish" href="#publish" />
    <NavItem icon="edit" label="Edit" href="#edit" />
    <NavItem icon="settings" label="Details" href="#details" />
  </div>

  {/* Progress indicator */}
  <div className="mt-8 rounded-lg bg-white p-3 text-xs">
    <div className="font-semibold text-stone-700">Progress</div>
    <div className="mt-2 h-2 rounded bg-stone-200">
      <div
        className="h-2 rounded bg-emerald-500"
        style={{ width: `${progress}%` }}
      />
    </div>
    <div className="mt-1 text-stone-500">{currentStep} of 6</div>
  </div>
</nav>
```

**Main Content（按导航标签分区）：**

#### 1. Intent Panel（id="intent"）
```
标题：Intent Draft
内容：
  - Raw prompt（可复制）
  - Industry hint
  - Compile status
  - Compiler version
  - Created at

Action:
  [Skip] — 保留旧编译结果，跳到 Compile
  [Re-analyze] — 新 Rule Guard + LLM Compiler V2
```

#### 2. Compile Panel（id="compile"）— **v0.4 新增**
```
标题：Compilation & Approval
副标题：Using hybrid compiler (Rule Guard + LLM)

当前状态：
  ✓ Rule Guard passed (industry_hint: real_estate, language_hint: en)
  ✓ LLM Compiled (industry: real_estate, scene: property_listing, page_type: landing)

编译结果展示（可编辑）：
  Industry: [real_estate] (dropdown)
  Scene: [property_listing] (dropdown, 根据 industry 动态)
  Language: [both] (dropdown)
  Page type: [landing] (dropdown)
  Tone: [professional] (dropdown)
  Goal: [lead_generation] (dropdown)

字段推荐（来自 Form Builder）：
  推荐选中字段：
  ☑ name ☑ email ☑ phone
  ☑ property_address ☑ bedrooms ☑ budget ☑ timeline
  [Customize Fields →]

Actions:
  [Back to Intent] [Confirm & Continue →]
```

#### 3. Preview Panel（id="preview"）
```
标题：Microsite Preview
副标题：Live draft (changes shown in real-time)

Content:
  <div className="grid grid-cols-3 gap-4">
    {/* Device previews: Desktop, Tablet, Mobile */}
    <iframe src={`/app/projects/${id}/preview?device=desktop`} />
    <iframe src={`/app/projects/${id}/preview?device=tablet`} />
    <iframe src={`/app/projects/${id}/preview?device=mobile`} />
  </div>

Actions:
  [Open Full Screen] [Download PDF] [Test Form Submission]
```

#### 4. Publish Panel（id="publish"）
```
标题：Live Publication
副标题：Manage your public site & lead form

状态指示器：
  Draft status: ✓ Ready
  Published: [Yes/No]
  Published at: [date or "—"]

Public Links：
  Microsite: /site/{slug}
  Lead Form: /forms/{form_slug}
  QR Code: [生成二维码图标]

Actions:
  {isPublished ? (
    <>
      [Update Live] — 覆盖已发布版本
      [View Live →] — 新标签打开
      [Unpublish] — 下线（谨慎操作）
    </>
  ) : (
    <>
      [Publish (Go Live)] — 首次发布
    </>
  )}

Share:
  WhatsApp | Email | Copy Link | WeChat
```

#### 5. Edit Panel（id="edit"）
```
标题：Quick Edit
副标题：修改 Hero、商家信息（不需要重新生成）

Tabs:
  • Hero（Hero 文案）
  • Merchant（商家信息）
  • Property（房产导入）

### Hero Tab
表单：
  Eyebrow: [text field]
  Title: [text field] *
  Subtitle: [textarea]
  CTA Text: [text field]
  CTA URL: [text field]

### Merchant Tab
表单：
  Name: [text field] *
  Email: [email field] *
  Phone: [phone field] *
  Address: [text field]
  Website: [url field]
  WeChat: [text field]
  WhatsApp: [text field]

### Property Tab
  Property Address: [text]
  Bedrooms: [select]
  Bathrooms: [select]
  Price: [text]
  Description: [textarea]
  [+ Add Photo] [Import from TradeMe →]

Actions:
  [Save Draft] [Preview Changes]
```

#### 6. Details Panel（id="details"）
```
标题：Project Details & Configuration
副标题：商家资料、房产管理、高级设置

Sections:
  • Business Info（联系电话、邮箱、地址等）
  • Property Listings（手动房产列表）
  • TradeMe Integration（OAuth、自动导入设置）
  • Form Fields（选择、排序表单字段）
  • Advanced（skeleton 选择、主题色等）

Actions:
  各 section 内的编辑按钮
```

---

## Part 1：Phase 3 LLM Form Builder

### 1.1 新增文件：`src/lib/generation/llm-form-builder.ts`

```typescript
/**
 * LLM Form Builder — 智能表单字段生成
 * 根据 industry + scene 从字段池选择合适的字段
 *
 * 实现方式：规则表驱动（成本=0，快速）
 * 可选升级：LLM 驱动（成本=$0.01，更智能）
 */

import type {
  FormFieldDefinitionV2,
  FormBuilderRequestV2,
  FormBuilderResultV2,
} from "@/types/form-builder";
import type { IndustryV2, SceneV2 } from "@/types/compiled-intent-v2";
import {
  UNIVERSAL_FIELD_POOL,
  INDUSTRY_FIELD_POOLS,
  FORM_FIELD_RULES,
} from "@/types/form-builder";

/**
 * 规则表驱动的表单字段生成
 * 根据 industry + scene 从 FORM_FIELD_RULES 查表选择字段
 */
export function buildFormFieldsFromRules(request: FormBuilderRequestV2): FormBuilderResultV2 {
  const { industry, scene } = request;

  // 1. 从规则表查询
  const rule = FORM_FIELD_RULES[industry]?.[scene as any];
  if (!rule) {
    // Fallback：只用通用字段
    const universalFields = Object.values(UNIVERSAL_FIELD_POOL);
    return {
      selected_fields: universalFields,
      field_order: Object.keys(UNIVERSAL_FIELD_POOL),
      reasoning: `No rule found for ${industry}/${scene}; using universal fields`,
    };
  }

  // 2. 收集字段
  const selectedFields: FormFieldDefinitionV2[] = [];
  const fieldOrder: string[] = [];

  // 先加 universal
  for (const fieldId of rule.universal) {
    if (UNIVERSAL_FIELD_POOL[fieldId]) {
      selectedFields.push(UNIVERSAL_FIELD_POOL[fieldId]);
      fieldOrder.push(fieldId);
    }
  }

  // 再加 industry-specific
  const industryPool = INDUSTRY_FIELD_POOLS[industry];
  for (const fieldId of rule.industry) {
    if (industryPool?.[fieldId]) {
      selectedFields.push(industryPool[fieldId]);
      fieldOrder.push(fieldId);
    }
  }

  // 3. 分组（可选）
  const groups = rule.groups
    ? rule.groups.map((groupName) => ({
        name: groupName,
        field_ids: fieldOrder.filter(
          (fid) => rule.groups?.includes(groupName)
        ),
      }))
    : undefined;

  return {
    selected_fields: selectedFields,
    field_order: fieldOrder,
    groups,
    reasoning: `Selected ${selectedFields.length} fields for ${industry}/${scene}`,
  };
}

/**
 * Server Action：在 UI 中调用
 * 获取推荐的表单字段列表
 */
export async function buildFormFieldsAction(
  industry: IndustryV2,
  scene: SceneV2
): Promise<FormBuilderResultV2> {
  return buildFormFieldsFromRules({ industry, scene });
}
```

### 1.2 扩展 `src/types/form-builder.ts`

```typescript
/**
 * 表单构建器的完整类型定义与字段池
 */

import type { IndustryV2, SceneV2 } from "@/types/compiled-intent-v2";

export type FormFieldTypeV2 = "text" | "email" | "phone" | "select" | "date" | "textarea" | "checkbox";

export interface FormFieldDefinitionV2 {
  id: string;
  label: string;
  type: FormFieldTypeV2;
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface FormBuilderRequestV2 {
  industry: IndustryV2;
  scene: SceneV2;
  language?: "en" | "zh" | "both";
}

export interface FormBuilderResultV2 {
  selected_fields: FormFieldDefinitionV2[];
  field_order: string[];
  groups?: Array<{
    name: string;
    field_ids: string[];
  }>;
  reasoning?: string;
}

// 通用字段池
export const UNIVERSAL_FIELD_POOL: Record<string, FormFieldDefinitionV2> = {
  name: {
    id: "name",
    label: "Full Name / Business Name",
    type: "text",
    required: true,
    placeholder: "John Doe",
  },
  email: {
    id: "email",
    label: "Email",
    type: "email",
    required: true,
    placeholder: "john@example.com",
  },
  phone: {
    id: "phone",
    label: "Phone / WhatsApp",
    type: "phone",
    required: true,
    placeholder: "+64 21 123 4567",
  },
  // ... 更多通用字段
};

// 行业特定字段池
export const INDUSTRY_FIELD_POOLS: Record<IndustryV2, Record<string, FormFieldDefinitionV2>> = {
  real_estate: {
    property_address: {
      id: "property_address",
      label: "Property Address",
      type: "text",
      required: false,
    },
    bedrooms: {
      id: "bedrooms",
      label: "Number of Bedrooms",
      type: "select",
      required: false,
      options: ["1", "2", "3", "4", "5+"].map(v => ({ value: v, label: v })),
    },
    budget: {
      id: "budget",
      label: "Budget Range",
      type: "select",
      required: false,
      options: [
        { value: "0-300", label: "Under $300k" },
        { value: "300-500", label: "$300k - $500k" },
        { value: "500-750", label: "$500k - $750k" },
        { value: "750+", label: "$750k+" },
      ],
    },
    timeline: {
      id: "timeline",
      label: "Purchase Timeline",
      type: "select",
      required: false,
      options: [
        { value: "urgent", label: "Urgent (0-2 weeks)" },
        { value: "soon", label: "Soon (1-3 months)" },
        { value: "flexible", label: "Flexible" },
      ],
    },
    // ... 更多房产字段
  },
  immigration: {
    target_country: {
      id: "target_country",
      label: "Target Country",
      type: "select",
      required: false,
      options: [
        { value: "australia", label: "Australia" },
        { value: "canada", label: "Canada" },
        { value: "nz", label: "New Zealand" },
        { value: "usa", label: "USA" },
        { value: "uk", label: "UK" },
      ],
    },
    degree_level: {
      id: "degree_level",
      label: "Education Level",
      type: "select",
      required: false,
      options: [
        { value: "high_school", label: "High School" },
        { value: "diploma", label: "Diploma" },
        { value: "bachelor", label: "Bachelor" },
        { value: "master", label: "Master" },
        { value: "phd", label: "PhD" },
      ],
    },
    test_scores: {
      id: "test_scores",
      label: "Test Scores (IELTS/TOEFL/GRE)",
      type: "textarea",
      required: false,
      placeholder: "e.g., IELTS 7.5, TOEFL 100",
    },
    // ... 更多留学字段
  },
};

// 规则表：industry + scene → [universal] + [industry-specific]
export const FORM_FIELD_RULES: Record<
  IndustryV2,
  Record<SceneV2 | string, { universal: string[]; industry: string[]; groups?: string[] }>
> = {
  real_estate: {
    property_listing: {
      universal: ["name", "email", "phone"],
      industry: ["property_address", "bedrooms", "budget", "timeline"],
      groups: ["Contact Info", "Property Details"],
    },
    open_home_event: {
      universal: ["name", "email", "phone"],
      industry: ["property_address", "attendees", "availability"],
      groups: ["Contact Info", "Event Details"],
    },
    market_update: {
      universal: ["name", "email", "phone"],
      industry: ["interested_area", "property_type"],
      groups: ["Contact Info", "Interest"],
    },
  } as any,
  immigration: {
    visa_consultation: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "visa_type", "degree_level"],
      groups: ["Contact Info", "Visa Details"],
    },
    school_info: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "degree_level", "field_of_study"],
      groups: ["Contact Info", "Education Details"],
    },
    program_enrollment: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "program_name", "start_date"],
      groups: ["Contact Info", "Program Details"],
    },
  } as any,
};
```

### 1.3 单元测试：`src/lib/generation/__tests__/form-builder.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { buildFormFieldsFromRules } from "../llm-form-builder";

describe("Form Builder", () => {
  it("should build fields for real estate property listing", () => {
    const result = buildFormFieldsFromRules({
      industry: "real_estate",
      scene: "property_listing",
    });

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("name");
    expect(result.field_order).toContain("email");
    expect(result.field_order).toContain("property_address");
  });

  it("should build fields for immigration visa consultation", () => {
    const result = buildFormFieldsFromRules({
      industry: "immigration",
      scene: "visa_consultation",
    });

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("target_country");
    expect(result.field_order).toContain("degree_level");
  });

  it("should fallback to universal fields for unknown scene", () => {
    const result = buildFormFieldsFromRules({
      industry: "real_estate" as any,
      scene: "unknown_scene" as any,
    });

    expect(result.field_order).toContain("name");
    expect(result.field_order).toContain("email");
  });
});
```

---

## Part 2：后台页面重排版

### 2.1 重构文件结构

**新建 Component 分解：**

```
src/app/app/projects/[id]/
├── page.tsx (重构，只负责布局)
├── layout.tsx (侧边栏布局)
├── components/
│   ├── sidebar.tsx (左侧导航)
│   ├── panels/
│   │   ├── intent-panel.tsx
│   │   ├── compile-panel.tsx (v0.4 新增)
│   │   ├── preview-panel.tsx
│   │   ├── publish-panel.tsx
│   │   ├── edit-panel.tsx
│   │   └── details-panel.tsx
│   └── nav-item.tsx
```

### 2.2 新建 `src/app/app/projects/[id]/layout.tsx`

```typescript
/**
 * 项目详情页布局 - 侧边栏 + 主内容两列
 */

export default function ProjectDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      {/* Header fixed at top */}
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        {/* Header content from page.tsx */}
      </header>

      {/* Main content: sidebar + panels */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 border-r border-stone-200 bg-stone-50 overflow-y-auto">
          <Sidebar />
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
```

### 2.3 新建 `src/app/app/projects/[id]/components/sidebar.tsx`

```typescript
"use client";

import Link from "next/link";
import { useHash } from "@/lib/hooks/useHash";

const NAV_ITEMS = [
  { icon: "📋", label: "Intent", id: "intent" },
  { icon: "⚡", label: "Compile", id: "compile" },
  { icon: "👁️", label: "Preview", id: "preview" },
  { icon: "🚀", label: "Publish", id: "publish" },
  { icon: "✏️", label: "Edit", id: "edit" },
  { icon: "⚙️", label: "Details", id: "details" },
];

export function Sidebar() {
  const currentHash = useHash();

  return (
    <nav className="space-y-1 p-4">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`block rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            currentHash === item.id
              ? "bg-white text-emerald-900 shadow-sm"
              : "text-stone-700 hover:bg-white/50"
          }`}
        >
          <span className="mr-2">{item.icon}</span>
          {item.label}
        </a>
      ))}

      {/* Progress indicator */}
      <div className="mt-8 rounded-lg bg-white p-3 text-xs">
        <div className="font-semibold text-stone-700">Progress</div>
        <div className="mt-2 h-2 rounded bg-stone-200">
          <div
            className="h-2 rounded bg-emerald-500"
            style={{ width: "60%" }}
          />
        </div>
        <div className="mt-1 text-stone-500">3 of 6 steps</div>
      </div>
    </nav>
  );
}
```

### 2.4 新建 Panel 组件

**`src/app/app/projects/[id]/components/panels/intent-panel.tsx`**

```typescript
/**
 * Intent 面板 - 展示编译结果
 */

export function IntentPanel({ intent }: { intent: CompiledIntentV1 | null }) {
  return (
    <section id="intent" className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-stone-800">Intent Draft</h2>

      {intent ? (
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-stone-600">Raw prompt</dt>
            <dd className="mt-1 whitespace-pre-wrap text-stone-800">{intent.raw_prompt}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-600">Industry hint</dt>
            <dd className="mt-1 text-stone-800">{intent.industry_hint ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-600">Status</dt>
            <dd className="mt-1">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                ✓ {intent.compile_status}
              </span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-stone-600">No intent saved yet.</p>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        <button className="text-sm font-medium text-emerald-800 hover:underline">
          ← Skip to Compile
        </button>
        <button className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Re-analyze
        </button>
      </div>
    </section>
  );
}
```

**`src/app/app/projects/[id]/components/panels/compile-panel.tsx`**（v0.4 新增）

```typescript
/**
 * Compile 面板 - v0.4 混合编译器结果展示与确认
 *
 * 流程：
 * 1. 用户在 Intent Panel 点 "Re-analyze"
 * 2. Server Action: applyRuleGuard() + compileLLMV2() → CompiledIntentV2
 * 3. 显示编译结果（industry, scene, page_type, tone, goal）
 * 4. 用户可编辑字段
 * 5. 点"确认"保存，调用 buildFormFieldsAction() 获取字段推荐
 * 6. 显示推荐字段列表（可定制）
 * 7. 点"继续"跳到 Preview Panel
 */

"use client";

import { useState } from "react";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { buildFormFieldsAction } from "@/lib/generation/llm-form-builder";

export function CompilePanel({
  intent,
  onContinue,
}: {
  intent: CompiledIntentV2 | null;
  onContinue: () => void;
}) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [selectedFields, setSelectedFields] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    if (!intent) return;

    setIsLoading(true);
    try {
      const result = await buildFormFieldsAction(intent.industry, intent.scene);
      setSelectedFields(result.selected_fields);
      setIsConfirmed(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section id="compile" className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-stone-800">Compilation & Approval</h2>
      <p className="mt-1 text-sm text-stone-600">
        Using hybrid compiler (Rule Guard + LLM)
      </p>

      {intent ? (
        <div className="mt-6 space-y-6">
          {/* Compilation result */}
          <div className="rounded-lg bg-stone-50 p-4">
            <h3 className="font-medium text-stone-800">Compilation Result</h3>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="font-medium text-stone-600">Industry</dt>
                <dd className="mt-1">
                  <select
                    defaultValue={intent.industry}
                    className="rounded border border-stone-300 px-2 py-1"
                  >
                    <option value="real_estate">Real Estate</option>
                    <option value="immigration">Immigration & Education</option>
                  </select>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-stone-600">Scene</dt>
                <dd className="mt-1">
                  <select
                    defaultValue={intent.scene}
                    className="rounded border border-stone-300 px-2 py-1"
                  >
                    <option value="property_listing">Property Listing</option>
                    <option value="open_home_event">Open Home Event</option>
                    {/* ... 更多选项 */}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-stone-600">Language</dt>
                <dd className="mt-1">
                  <select
                    defaultValue={intent.language}
                    className="rounded border border-stone-300 px-2 py-1"
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                    <option value="both">Both</option>
                  </select>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-stone-600">Page Type</dt>
                <dd className="mt-1">
                  <select
                    defaultValue={intent.page_type || "landing"}
                    className="rounded border border-stone-300 px-2 py-1"
                  >
                    <option value="landing">Landing</option>
                    <option value="showcase">Showcase</option>
                    <option value="form">Form</option>
                    <option value="multi_section">Multi-section</option>
                  </select>
                </dd>
              </div>
            </dl>
          </div>

          {/* Form fields recommendation */}
          {isConfirmed && selectedFields.length > 0 && (
            <div className="rounded-lg bg-emerald-50 p-4">
              <h3 className="font-medium text-emerald-900">
                Recommended Form Fields ({selectedFields.length})
              </h3>
              <div className="mt-3 space-y-2">
                {selectedFields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <span className="text-sm text-emerald-900">
                      {field.label}
                      {field.required && <span className="text-red-600"> *</span>}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-emerald-700">
                ✓ Fields are automatically selected for {intent.industry}/{intent.scene}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-stone-200">
            <button
              onClick={handleConfirm}
              disabled={isLoading || isConfirmed}
              className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {isLoading ? "Loading..." : isConfirmed ? "✓ Confirmed" : "Confirm & Continue"}
            </button>
            {isConfirmed && (
              <button
                onClick={onContinue}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-50"
              >
                Next: Preview →
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-stone-600">No compilation available. Go to Intent Panel to analyze.</p>
      )}
    </section>
  );
}
```

**`src/app/app/projects/[id]/components/panels/preview-panel.tsx`**

```typescript
/**
 * Preview 面板 - 三设备响应式预览
 */

export function PreviewPanel({ projectId }: { projectId: string }) {
  return (
    <section id="preview" className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-stone-800">Microsite Preview</h2>
      <p className="mt-1 text-sm text-stone-600">Live draft (changes shown in real-time)</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {[
          { name: "Desktop", width: "100%" },
          { name: "Tablet", width: "768px" },
          { name: "Mobile", width: "375px" },
        ].map((device) => (
          <div key={device.name}>
            <p className="mb-2 text-xs font-semibold text-stone-600">{device.name}</p>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-2">
              <iframe
                src={`/app/projects/${projectId}/preview?device=${device.name.toLowerCase()}`}
                className="aspect-video w-full rounded bg-white"
                style={{ width: device.width, margin: "0 auto" }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
          Open Full Screen
        </button>
        <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
          Download PDF
        </button>
        <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
          Test Form
        </button>
      </div>
    </section>
  );
}
```

**`src/app/app/projects/[id]/components/panels/publish-panel.tsx`**

```typescript
/**
 * Publish 面板 - 发布状态 & Live links
 */

export function PublishPanel({
  projectId,
  isPublished,
  liveUrl,
  formUrl,
}: {
  projectId: string;
  isPublished: boolean;
  liveUrl?: string;
  formUrl?: string;
}) {
  return (
    <section id="publish" className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-stone-800">Live Publication</h2>
      <p className="mt-1 text-sm text-stone-600">Manage your public site & lead form</p>

      {/* Status indicator */}
      <div className="mt-6 rounded-lg bg-blue-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-blue-600 uppercase">Published Status</p>
            <p className="mt-1 text-lg font-semibold text-blue-900">
              {isPublished ? "✓ Live" : "○ Draft"}
            </p>
          </div>
          <div className="text-right text-xs text-blue-600">
            {isPublished ? "Published on 2026-04-07" : "Ready to publish"}
          </div>
        </div>
      </div>

      {/* Public links */}
      {isPublished && (
        <div className="mt-6 space-y-3 rounded-lg bg-stone-50 p-4">
          <p className="text-sm font-semibold text-stone-700">Public Links</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded bg-white p-2">
              <span className="text-stone-700">
                <strong>Microsite:</strong> {liveUrl || "/site/{slug}"}
              </span>
              <button className="text-xs font-medium text-emerald-800 hover:underline">Copy</button>
            </div>
            <div className="flex items-center justify-between rounded bg-white p-2">
              <span className="text-stone-700">
                <strong>Lead Form:</strong> {formUrl || "/forms/{slug}"}
              </span>
              <button className="text-xs font-medium text-emerald-800 hover:underline">Copy</button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3 pt-4 border-t border-stone-200">
        {isPublished ? (
          <>
            <button className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800">
              Update Live
            </button>
            <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
              View Live →
            </button>
            <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
              Unpublish
            </button>
          </>
        ) : (
          <button className="rounded-lg bg-emerald-900 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            🚀 Publish (Go Live)
          </button>
        )}
      </div>

      {/* Share section */}
      <div className="mt-6 rounded-lg bg-stone-50 p-4">
        <p className="text-sm font-semibold text-stone-700">Share Link</p>
        <div className="mt-3 flex gap-2">
          {["WhatsApp", "Email", "WeChat", "Copy"].map((action) => (
            <button
              key={action}
              className="text-xs rounded bg-white px-3 py-1 font-medium text-stone-700 hover:bg-stone-100"
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
```

### 2.5 重新组织 `src/app/app/projects/[id]/page.tsx`

```typescript
/**
 * 项目详情页 - 重构为模块化 Panel 组件
 *
 * 之前：400 行单文件，所有逻辑和 UI 混在一起
 * 之后：主文件只负责数据获取 + Panel 组合，具体 UI 在各 Panel 组件
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { IntentPanel } from "./components/panels/intent-panel";
import { CompilePanel } from "./components/panels/compile-panel";
import { PreviewPanel } from "./components/panels/preview-panel";
import { PublishPanel } from "./components/panels/publish-panel";
import { EditPanel } from "./components/panels/edit-panel";
import { DetailsPanel } from "./components/panels/details-panel";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

interface ProjectDetailPageProps {
  params: { id: string };
  searchParams: { notice?: string; preview?: string; missing?: string };
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const supabase = createClient();

  // 1. 获取项目信息
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, status, updated_at")
    .eq("id", params.id)
    .maybeSingle();

  if (projectError || !project) notFound();

  // 2. 获取最新 intent
  const { data: latestIntent } = await supabase
    .from("intents")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. 获取草稿 microsite
  const { data: draftMicrosite } = await supabase
    .from("microsites")
    .select("*")
    .eq("project_id", params.id)
    .eq("status", "draft")
    .maybeSingle();

  // 4. 获取已发布 microsite
  const { data: publishedMicrosite } = await supabase
    .from("microsites")
    .select("*")
    .eq("project_id", params.id)
    .eq("status", "published")
    .maybeSingle();

  // 5. 渲染 Panel 序列
  return (
    <div className="space-y-6 pb-12">
      {/* Header 提示信息 */}
      {/* ... */}

      {/* Panel 序列 */}
      <IntentPanel intent={latestIntent} />
      <CompilePanel intent={latestIntent} onContinue={() => {}} />
      <PreviewPanel projectId={params.id} />
      <PublishPanel
        projectId={params.id}
        isPublished={!!publishedMicrosite}
        liveUrl={publishedMicrosite?.public_slug ? `/site/${publishedMicrosite.public_slug}` : undefined}
      />
      <EditPanel projectId={params.id} draftMicrosite={draftMicrosite} />
      <DetailsPanel projectId={params.id} />
    </div>
  );
}
```

---

## Part 3：Server Actions 集成 (Phase 0-2)

### 3.1 新增 `src/app/app/projects/compile-intent-v2-action.ts`

```typescript
/**
 * Server Action：v0.4 混合编译器集成
 *
 * 流程：
 * 1. 用户点"Re-analyze"或"Compile"
 * 2. applyRuleGuard(raw_prompt) → RuleGuardResult
 * 3. 如果 passed=false，返回错误；否则继续
 * 4. compileLLMV2(raw_prompt, rule_guard_result) → CompiledIntentV2
 * 5. 保存到 DB（或仅返回给 UI 供确认）
 * 6. 返回 CompiledIntentV2 + 编译成本
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { applyRuleGuard } from "@/lib/compiler/rule-guard";
import { compileLLMV2 } from "@/lib/compiler/llm-compiler-v2";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";

export interface CompileIntentV2Result {
  success: boolean;
  intent?: CompiledIntentV2;
  error?: string;
  cost?: number; // 单位：USD cents (e.g., 1 = $0.01)
}

/**
 * Server Action：调用 v0.4 混合编译器
 */
export async function compileIntentV2Action(
  projectId: string,
  rawPrompt: string
): Promise<CompileIntentV2Result> {
  const supabase = createClient();

  try {
    // Step 1：Rule Guard（成本=0）
    const ruleGuardResult = await applyRuleGuard(rawPrompt);

    if (!ruleGuardResult.passed) {
      return {
        success: false,
        error: `Rule Guard failed: ${ruleGuardResult.reasons.join("; ")}`,
      };
    }

    // Step 2：LLM Compiler V2（成本~$0.01）
    const intent = await compileLLMV2(rawPrompt, ruleGuardResult);
    intent.project_id = projectId;

    // Step 3：保存到 DB（可选，目前仅返回给 UI 供确认）
    // 用户确认后再真正保存到 intents 表
    // const { error } = await supabase
    //   .from("intents")
    //   .insert({ ...intent, compiled_intent_v2: intent });

    return {
      success: true,
      intent,
      cost: 1, // ~$0.01 for gpt-4o-mini
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Server Action：用户确认编译结果后，保存到 DB
 */
export async function confirmIntentV2Action(
  projectId: string,
  intent: CompiledIntentV2
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();

  try {
    const { error } = await supabase
      .from("intents")
      .insert({
        project_id: projectId,
        raw_prompt: intent.id, // 或从 intent.description 取
        compiled_intent_v2: intent,
        compiler_version: "hybrid_v2",
        compile_status: "succeeded",
      });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### 3.2 更新 `src/app/app/projects/[id]/components/panels/compile-panel.tsx`

```typescript
"use client";

import { useState } from "react";
import { compileIntentV2Action, confirmIntentV2Action } from "../../compile-intent-v2-action";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { buildFormFieldsAction } from "@/lib/generation/llm-form-builder";

export function CompilePanel({
  projectId,
  rawPrompt,
  onSuccess,
}: {
  projectId: string;
  rawPrompt: string;
  onSuccess: (intent: CompiledIntentV2) => void;
}) {
  const [intent, setIntent] = useState<CompiledIntentV2 | null>(null);
  const [selectedFields, setSelectedFields] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<"initial" | "compiled" | "fields_selected">("initial");
  const [error, setError] = useState<string | null>(null);

  const handleCompile = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await compileIntentV2Action(projectId, rawPrompt);

      if (!result.success || !result.intent) {
        setError(result.error || "Compilation failed");
        return;
      }

      setIntent(result.intent);
      setStep("compiled");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!intent) return;

    setIsLoading(true);
    setError(null);

    try {
      // 获取推荐字段
      const result = await buildFormFieldsAction(intent.industry, intent.scene);
      setSelectedFields(result.selected_fields);

      // 保存 intent 到 DB
      const saveResult = await confirmIntentV2Action(projectId, intent);
      if (!saveResult.success) {
        setError(saveResult.error || "Failed to save intent");
        return;
      }

      setStep("fields_selected");
      onSuccess(intent);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section id="compile" className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-stone-800">Compilation & Approval</h2>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          ❌ {error}
        </div>
      )}

      {step === "initial" && (
        <div className="mt-6">
          <p className="text-sm text-stone-600">
            Analyze the prompt with hybrid compiler (Rule Guard + LLM)
          </p>
          <button
            onClick={handleCompile}
            disabled={isLoading}
            className="mt-4 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isLoading ? "Compiling..." : "⚡ Compile with AI"}
          </button>
        </div>
      )}

      {step === "compiled" && intent && (
        <div className="mt-6 space-y-6">
          {/* ... compilation result display ... */}
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isLoading ? "Saving..." : "✓ Confirm & Continue"}
          </button>
        </div>
      )}

      {step === "fields_selected" && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          ✓ Compilation saved. Form fields recommended.
        </div>
      )}
    </section>
  );
}
```

---

## 开发检查清单

### Phase 3（Form Builder）
- [ ] `llm-form-builder.ts` 实现完整
- [ ] `form-builder.ts` 类型和字段池完整
- [ ] 单元测试 3/3 通过
- [ ] 规则表覆盖所有主要 industry+scene

### 后台重排版
- [ ] `layout.tsx` 侧边栏布局
- [ ] `sidebar.tsx` 导航组件
- [ ] 6 个 Panel 组件完整
- [ ] 样式美观（圆角、阴影、颜色一致）
- [ ] 响应式布局测试（desktop/tablet/mobile）

### Server Actions 集成
- [ ] `compile-intent-v2-action.ts` 实现
- [ ] `CompilePanel` 组件与 Server Action 连接
- [ ] 错误处理完善
- [ ] 成本提示（显示 $0.01 per call）
- [ ] 流程端到端测试（intent → compile → fields → next）

---

## 总工作量估算

| 部分 | 任务 | 预估时间 |
|------|------|---------|
| **Phase 3** | Form Builder + 单元测试 | 4-6h |
| **后台重排版** | 6 Panel + Sidebar + Layout | 3-4h |
| **集成** | Server Actions + 流程连接 | 3-4h |
| **测试** | E2E 测试 + 样式调整 | 2-3h |
| **总计** | | **12-17h** |

---

希望这份提示词足够清晰。现在可以发给 Cursor 开始实现了！

**建议工作顺序：**
1. Phase 3 Form Builder（完成测试）
2. 后台页面 Component 分解（Panel + Sidebar）
3. Server Actions 集成
4. E2E 测试 + 样式调整

有任何问题或调整需求，随时告诉我！
