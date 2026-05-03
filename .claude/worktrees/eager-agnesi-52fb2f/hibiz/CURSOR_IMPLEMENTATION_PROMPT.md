# HiBiz v0.4 Phase 3 + 后台重排版 实现指南

## 🎯 任务总览

**目标**：实现 v0.4 混合编译器 Phase 3（Form Builder）+ 后台页面重排版 + Server Actions 集成

**预期工作量**：12-17 小时
- Phase 3 Form Builder：4-6h
- 后台页面组件重排版：3-4h
- Server Actions 集成：3-4h
- E2E 测试 + 样式调整：2-3h

---

## 📋 项目背景

### 技术栈
- **Framework**: Next.js 14 App Router, TypeScript strict
- **UI**: React 18 + Tailwind CSS 3.4
- **Backend**: Supabase Auth + PostgreSQL + RLS
- **AI**: OpenAI gpt-4o-mini (structured output)
- **Deploy**: Render (hibiz-service.onrender.com)

### 架构现状（Phase 0-2 已完成）
```
用户 raw_prompt
  → Phase 1: Rule Guard（正则预过滤、城市/语言检测）✅
  → Phase 2: LLM Compiler V2（意图编译 → CompiledIntentV2）✅
  → Phase 3: Form Builder（智能表单字段生成）⏳ TODO
  → Server Actions（确认意图、保存到DB）
  → 用户确认
  → LLM Copy Generator + Form Builder
  → assembleRenderModel（确定性装配）
  → RenderModelV1 → 草稿预览 → 发布
```

### 当前问题
**后台页面** (`src/app/app/projects/[id]/page.tsx`)：
- ❌ 400 行单列长页面，所有内容垂直堆叠
- ❌ 逻辑混乱：Intent → Generate → Preview → Edit → Details 无清晰分组
- ❌ 无快速导航，用户不知道在流程的哪一步
- ❌ 表单碎片化散落各处

---

## 🔨 Part 1: Phase 3 - LLM Form Builder

### 目标
从 `CompiledIntentV2`（industry + scene）智能推荐表单字段。

### 新文件：`src/types/form-builder.ts`

```typescript
/**
 * Form Builder V2 — 基于 industry + scene 的表单字段推荐。
 * 零成本（无 LLM 调用），使用 FORM_FIELD_RULES 规则表。
 */

export type FormFieldTypeV2 = "text" | "email" | "phone" | "select" | "date" | "textarea" | "checkbox";

export interface FormFieldDefinitionV2 {
  id: string;
  label: string;
  type: FormFieldTypeV2;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface FormBuilderResultV2 {
  selected_fields: FormFieldDefinitionV2[];
  field_order: string[];
  groups: Array<{
    name: string;
    fields: string[];
  }>;
  confidence: number; // 0-100，规则匹配度
}

// ────────────────────────────────────────────────

/** 通用字段池 */
export const UNIVERSAL_FIELD_POOL: Record<string, FormFieldDefinitionV2> = {
  name: {
    id: "name",
    label: "Full Name",
    type: "text",
    required: true,
    placeholder: "Your full name",
  },
  email: {
    id: "email",
    label: "Email",
    type: "email",
    required: true,
    placeholder: "your.email@example.com",
  },
  phone: {
    id: "phone",
    label: "Phone",
    type: "phone",
    required: true,
    placeholder: "+64 (0)9 123 4567",
  },
  message: {
    id: "message",
    label: "Message",
    type: "textarea",
    required: false,
    placeholder: "Tell us more...",
  },
};

/** 房地产行业字段池 */
export const REAL_ESTATE_FIELD_POOL: Record<string, FormFieldDefinitionV2> = {
  ...UNIVERSAL_FIELD_POOL,
  property_address: {
    id: "property_address",
    label: "Property Address",
    type: "text",
    required: false,
    placeholder: "e.g., 123 Main Street, Auckland",
  },
  property_type: {
    id: "property_type",
    label: "Property Type",
    type: "select",
    required: false,
    options: [
      { value: "residential", label: "Residential" },
      { value: "commercial", label: "Commercial" },
      { value: "land", label: "Land" },
    ],
  },
  bedrooms: {
    id: "bedrooms",
    label: "Bedrooms",
    type: "select",
    required: false,
    options: [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4+", label: "4+" },
    ],
  },
  inspection_date: {
    id: "inspection_date",
    label: "Preferred Inspection Date",
    type: "date",
    required: false,
  },
  budget: {
    id: "budget",
    label: "Budget Range",
    type: "text",
    required: false,
    placeholder: "e.g., $500k - $700k",
  },
};

/** 留学移民行业字段池 */
export const IMMIGRATION_FIELD_POOL: Record<string, FormFieldDefinitionV2> = {
  ...UNIVERSAL_FIELD_POOL,
  visa_type: {
    id: "visa_type",
    label: "Visa Type",
    type: "select",
    required: false,
    options: [
      { value: "student", label: "Student Visa" },
      { value: "work", label: "Work Visa" },
      { value: "residence", label: "Residence" },
      { value: "business", label: "Business" },
    ],
  },
  current_location: {
    id: "current_location",
    label: "Current Location",
    type: "text",
    required: false,
    placeholder: "Country or City",
  },
  education_level: {
    id: "education_level",
    label: "Highest Education",
    type: "select",
    required: false,
    options: [
      { value: "high_school", label: "High School" },
      { value: "bachelor", label: "Bachelor's Degree" },
      { value: "master", label: "Master's Degree" },
      { value: "phd", label: "PhD" },
    ],
  },
  work_experience: {
    id: "work_experience",
    label: "Years of Work Experience",
    type: "text",
    required: false,
    placeholder: "e.g., 5 years",
  },
  english_proficiency: {
    id: "english_proficiency",
    label: "English Proficiency (IELTS/TOEFL)",
    type: "text",
    required: false,
    placeholder: "e.g., IELTS 6.5",
  },
};

// ────────────────────────────────────────────────

/** 规则表：industry + scene → 字段选择 */
export const FORM_FIELD_RULES = {
  real_estate: {
    property_listing: {
      // 房产列表：买家查询
      select: ["name", "email", "phone", "property_address", "property_type", "bedrooms", "budget", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Property Interest", fields: ["property_address", "property_type", "bedrooms", "budget"] },
        { name: "Additional", fields: ["message"] },
      ],
      confidence: 95,
    },
    open_home_event: {
      // Open Home 看房日期预约
      select: ["name", "email", "phone", "inspection_date", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Inspection", fields: ["inspection_date"] },
        { name: "Questions", fields: ["message"] },
      ],
      confidence: 90,
    },
    market_update: {
      // 市场周报订阅
      select: ["email", "name"],
      groups: [{ name: "Subscribe", fields: ["name", "email"] }],
      confidence: 85,
    },
  },
  immigration: {
    visa_consultation: {
      // 签证咨询预约
      select: ["name", "email", "phone", "visa_type", "current_location", "english_proficiency", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Visa Info", fields: ["visa_type", "current_location", "english_proficiency"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 92,
    },
    school_info: {
      // 学校信息申请
      select: ["name", "email", "phone", "education_level", "current_location", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Background", fields: ["education_level", "current_location"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 88,
    },
    program_enrollment: {
      // 课程申请
      select: ["name", "email", "phone", "education_level", "work_experience", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Background", fields: ["education_level", "work_experience"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 90,
    },
  },
} as const;

// ────────────────────────────────────────────────

export type IndustryV2 = "real_estate" | "immigration";
export type SceneV2 = keyof typeof FORM_FIELD_RULES[IndustryV2];
```

### 新文件：`src/lib/generation/llm-form-builder.ts`

```typescript
/**
 * Form Builder — 基于 industry + scene 规则的表单字段生成。
 * 零 LLM 成本（确定性规则），返回 FormBuilderResultV2。
 */

import type { FormBuilderResultV2, FormFieldDefinitionV2, IndustryV2, SceneV2 } from "@/types/form-builder";
import {
  FORM_FIELD_RULES,
  IMMIGRATION_FIELD_POOL,
  REAL_ESTATE_FIELD_POOL,
  UNIVERSAL_FIELD_POOL,
} from "@/types/form-builder";

export function getFieldPoolForIndustry(industry: IndustryV2): Record<string, FormFieldDefinitionV2> {
  if (industry === "real_estate") {
    return REAL_ESTATE_FIELD_POOL;
  }
  if (industry === "immigration") {
    return IMMIGRATION_FIELD_POOL;
  }
  return UNIVERSAL_FIELD_POOL;
}

export function buildFormFieldsFromRules(
  industry: IndustryV2,
  scene: SceneV2,
): FormBuilderResultV2 {
  const rules = FORM_FIELD_RULES[industry]?.[scene];

  if (!rules) {
    // Fallback: 仅通用字段
    return {
      selected_fields: Object.values(UNIVERSAL_FIELD_POOL),
      field_order: ["name", "email", "phone"],
      groups: [{ name: "Contact", fields: ["name", "email", "phone"] }],
      confidence: 50,
    };
  }

  const fieldPool = getFieldPoolForIndustry(industry);
  const selectedFields = rules.select
    .map((id) => fieldPool[id])
    .filter((f): f is FormFieldDefinitionV2 => !!f);

  return {
    selected_fields: selectedFields,
    field_order: rules.select,
    groups: rules.groups,
    confidence: rules.confidence,
  };
}

/**
 * Exported for Server Action integration
 */
export function buildFormFieldsAction(industry: IndustryV2, scene: SceneV2): FormBuilderResultV2 {
  return buildFormFieldsFromRules(industry, scene);
}
```

### 单元测试：`src/lib/generation/llm-form-builder.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { buildFormFieldsFromRules } from "./llm-form-builder";

describe("llm-form-builder", () => {
  it("should return property listing fields for real_estate property_listing", () => {
    const result = buildFormFieldsFromRules("real_estate", "property_listing");

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("name");
    expect(result.field_order).toContain("email");
    expect(result.field_order).toContain("property_address");
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it("should return visa consultation fields for immigration visa_consultation", () => {
    const result = buildFormFieldsFromRules("immigration", "visa_consultation");

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("visa_type");
    expect(result.field_order).toContain("current_location");
    expect(result.confidence).toBeGreaterThanOrEqual(88);
  });

  it("should fallback to universal fields for unknown scene", () => {
    const result = buildFormFieldsFromRules("real_estate", "unknown_scene" as any);

    expect(result.confidence).toBeLessThan(70);
    expect(result.field_order).toEqual(["name", "email", "phone"]);
  });
});
```

---

## 🎨 Part 2: 后台页面重排版

### 新布局结构

```
┌─────────────────────────────────────┐
│ Header: Project Name | Status       │
├─────────────────────────────────────┤
│ ┌────────────┐  ┌────────────────┐  │
│ │ 左侧导航   │  │   主内容区     │  │
│ │ • Intent   │  │ ┌ Intent Panel │  │
│ │ • Compile  │  │ ├ Compile Res  │  │
│ │ • Preview  │  │ ├ Preview      │  │
│ │ • Publish  │  │ ├ Publish      │  │
│ │ • Edit     │  │ ├ Edit         │  │
│ │ • Details  │  │ └ Details      │  │
│ └────────────┘  └────────────────┘  │
└─────────────────────────────────────┘
```

### 新文件：`src/app/app/projects/[id]/layout.tsx`

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "./components/sidebar";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: { id: string };
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status, compiled_intent")
    .eq("id", params.id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="flex h-screen bg-white">
      {/* Left Sidebar */}
      <Sidebar projectId={project.id} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-stone-200 bg-white px-6 py-4 sticky top-0 z-10">
          <h1 className="text-2xl font-bold text-stone-900">{project.name}</h1>
          <p className="text-sm text-stone-600 mt-1">
            Status: <span className="font-medium capitalize">{project.status}</span>
          </p>
        </div>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/sidebar.tsx`

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Zap, Eye, Rocket, Edit3, Settings } from "lucide-react";

interface SidebarProps {
  projectId: string;
}

const NAV_ITEMS = [
  { id: "intent", label: "Intent", icon: FileText, description: "Draft info" },
  { id: "compile", label: "Compile", icon: Zap, description: "v0.4 Compiler" },
  { id: "preview", label: "Preview", icon: Eye, description: "Live preview" },
  { id: "publish", label: "Publish", icon: Rocket, description: "Go live" },
  { id: "edit", label: "Edit", icon: Edit3, description: "Quick edit" },
  { id: "details", label: "Details", icon: Settings, description: "Settings" },
];

export default function Sidebar({ projectId }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-stone-200 bg-stone-50 flex flex-col">
      <div className="p-4 border-b border-stone-200">
        <h2 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">Workflow</h2>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.includes(`#${item.id}`);
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`block px-3 py-3 rounded-lg transition-colors text-sm ${
                isActive
                  ? "bg-white border border-stone-300 text-stone-900 font-medium"
                  : "text-stone-700 hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} />
                <span className="font-medium">{item.label}</span>
              </div>
              <p className="text-xs text-stone-500 ml-6">{item.description}</p>
            </a>
          );
        })}
      </nav>

      <div className="p-4 border-t border-stone-200">
        <div className="text-xs text-stone-600 space-y-1">
          <p>📊 Progress</p>
          <div className="w-full bg-stone-200 rounded-full h-2">
            <div className="bg-emerald-500 h-2 rounded-full" style={{ width: "65%" }}></div>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/intent-panel.tsx`

```typescript
"use client";

import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";

interface IntentPanelProps {
  compiledIntent: CompiledIntentV2 | null;
  rawPrompt: string;
}

export function IntentPanel({ compiledIntent, rawPrompt }: IntentPanelProps) {
  return (
    <section id="intent" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Intent Draft</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-stone-700 block mb-2">Raw Prompt</label>
            <p className="text-sm text-stone-700 bg-stone-50 p-3 rounded border border-stone-200 max-h-24 overflow-y-auto">
              {rawPrompt}
            </p>
          </div>

          {compiledIntent && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase">Industry</label>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.industry}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase">Scene</label>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.scene}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase">Language</label>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.language}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase">Status</label>
                <p className="text-sm font-medium text-emerald-600">Compiled</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/compile-panel.tsx`

```typescript
"use client";

import { useState } from "react";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import type { FormBuilderResultV2 } from "@/types/form-builder";
import { compileIntentV2Action, confirmIntentV2Action } from "@/app/app/projects/compile-intent-v2-action";
import { buildFormFieldsAction } from "@/lib/generation/llm-form-builder";

interface CompilePanelProps {
  projectId: string;
  rawPrompt: string;
  onCompileSuccess: (intent: CompiledIntentV2, fields: FormBuilderResultV2) => void;
}

type CompileState = "idle" | "compiling" | "compiled" | "confirming" | "confirmed";

export function CompilePanel({ projectId, rawPrompt, onCompileSuccess }: CompilePanelProps) {
  const [state, setState] = useState<CompileState>("idle");
  const [compiledIntent, setCompiledIntent] = useState<CompiledIntentV2 | null>(null);
  const [formFields, setFormFields] = useState<FormBuilderResultV2 | null>(null);
  const [cost, setCost] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleCompile = async () => {
    if (!rawPrompt.trim()) {
      setError("Please enter a prompt first");
      return;
    }

    setState("compiling");
    setError(null);

    try {
      const result = await compileIntentV2Action(projectId, rawPrompt);
      setCompiledIntent(result.intent);
      setCost(result.cost);

      // Auto-generate form fields
      const fields = buildFormFieldsAction(result.intent.industry, result.intent.scene);
      setFormFields(fields);

      setState("compiled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compilation failed");
      setState("idle");
    }
  };

  const handleConfirm = async () => {
    if (!compiledIntent) return;

    setState("confirming");
    try {
      await confirmIntentV2Action(projectId, compiledIntent);
      setState("confirmed");
      onCompileSuccess(compiledIntent, formFields!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
      setState("compiled");
    }
  };

  return (
    <section id="compile" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Compile (v0.4 Hybrid)</h2>

        {state === "idle" && (
          <button
            onClick={handleCompile}
            disabled={!rawPrompt.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
          >
            🚀 Compile with v0.4 Hybrid Engine
          </button>
        )}

        {state === "compiling" && <p className="text-sm text-stone-600">⏳ Compiling...</p>}

        {state === "compiled" && compiledIntent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-stone-50 p-4 rounded border border-stone-200">
              <div>
                <p className="text-xs font-semibold text-stone-600 uppercase">Industry</p>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.industry}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-600 uppercase">Scene</p>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.scene}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-600 uppercase">Language</p>
                <p className="text-sm font-medium text-stone-900">{compiledIntent.language}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-600 uppercase">Cost</p>
                <p className="text-sm font-medium text-emerald-600">${(cost / 100).toFixed(2)}</p>
              </div>
            </div>

            {formFields && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded">
                <p className="text-sm font-medium text-blue-900 mb-2">📋 Recommended Fields ({formFields.selected_fields.length})</p>
                <div className="flex flex-wrap gap-2">
                  {formFields.selected_fields.map((f) => (
                    <span key={f.id} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleConfirm}
              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              ✅ Confirm & Save
            </button>
          </div>
        )}

        {state === "confirmed" && <p className="text-sm text-emerald-600">✅ Intent confirmed and saved</p>}

        {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">{error}</p>}
      </div>
    </section>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/preview-panel.tsx`

```typescript
"use client";

import { useState } from "react";

interface PreviewPanelProps {
  projectId: string;
  publishedSlug?: string;
}

type DeviceType = "desktop" | "tablet" | "mobile";

export function PreviewPanel({ projectId, publishedSlug }: PreviewPanelProps) {
  const [device, setDevice] = useState<DeviceType>("desktop");
  const previewUrl = `/site/${publishedSlug || "draft"}?preview=1`;

  const getDeviceSize = () => {
    switch (device) {
      case "mobile":
        return { width: "375px", height: "667px" };
      case "tablet":
        return { width: "768px", height: "1024px" };
      default:
        return { width: "100%", height: "600px" };
    }
  };

  return (
    <section id="preview" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Preview</h2>

        <div className="flex gap-2 mb-4 bg-stone-100 p-1 rounded-lg w-fit">
          {(["mobile", "tablet", "desktop"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                device === d ? "bg-white text-stone-900 shadow-sm" : "text-stone-600"
              }`}
            >
              {d === "mobile" ? "📱" : d === "tablet" ? "📑" : "🖥️"} {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>

        <div className="bg-stone-100 p-4 rounded-lg flex justify-center overflow-x-auto">
          <iframe
            src={previewUrl}
            style={getDeviceSize()}
            className="border-8 border-gray-400 rounded-lg shadow-lg"
            title="Site Preview"
          />
        </div>
      </div>
    </section>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/publish-panel.tsx`

```typescript
"use client";

import { publishProjectAction } from "@/app/app/projects/generation-actions";
import { useState } from "react";

interface PublishPanelProps {
  projectId: string;
  status: "draft" | "published";
  liveUrl?: string;
}

export function PublishPanel({ projectId, status, liveUrl }: PublishPanelProps) {
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await publishProjectAction(projectId);
      // Component will re-render with new status
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <section id="publish" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Publish</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-stone-900">Status</p>
              <p className={`text-sm font-medium mt-1 ${status === "published" ? "text-emerald-600" : "text-amber-600"}`}>
                {status === "published" ? "🟢 Published" : "🟡 Draft"}
              </p>
            </div>
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {isPublishing ? "Publishing..." : "Publish Now"}
            </button>
          </div>

          {liveUrl && (
            <div>
              <p className="text-sm font-medium text-stone-900 mb-2">Live URL</p>
              <div className="flex gap-2">
                <code className="flex-1 bg-stone-50 px-3 py-2 rounded text-sm text-stone-700 border border-stone-200 truncate">
                  {liveUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(liveUrl)}
                  className="px-3 py-2 bg-stone-100 text-stone-700 rounded hover:bg-stone-200 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/edit-panel.tsx`

```typescript
"use client";

import { useState } from "react";
import type { MerchantProfile } from "@/types/merchant-profile";

interface EditPanelProps {
  projectId: string;
  merchantProfile: MerchantProfile | null;
}

type EditTab = "hero" | "merchant" | "property";

export function EditPanel({ projectId, merchantProfile }: EditPanelProps) {
  const [tab, setTab] = useState<EditTab>("hero");

  return (
    <section id="edit" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Quick Edit</h2>

        <div className="flex gap-2 mb-4 border-b border-stone-200">
          {(["hero", "merchant", "property"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              {t === "hero" ? "Hero" : t === "merchant" ? "Merchant Info" : "Property"}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {tab === "hero" && (
            <div>
              <label className="text-sm font-medium text-stone-900 block mb-2">Hero Title</label>
              <input
                type="text"
                placeholder="Enter hero title"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {tab === "merchant" && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-stone-900 block mb-2">Business Name</label>
                <input
                  type="text"
                  defaultValue={merchantProfile?.name || ""}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-stone-900 block mb-2">Phone</label>
                <input
                  type="tel"
                  defaultValue={merchantProfile?.phone || ""}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Save Changes
          </button>
        </div>
      </div>
    </section>
  );
}
```

### 新文件：`src/app/app/projects/[id]/components/panels/details-panel.tsx`

```typescript
"use client";

interface DetailsPanelProps {
  projectId: string;
}

export function DetailsPanel({ projectId }: DetailsPanelProps) {
  return (
    <section id="details" className="scroll-mt-20 mb-8">
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Details & Settings</h2>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-3">Business Information</h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Business Name"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
              <input
                type="email"
                placeholder="Email"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
              <input
                type="tel"
                placeholder="Phone"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Address"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-3">Form Fields</h3>
            <p className="text-sm text-stone-600 mb-3">Configured during compilation</p>
            <button className="px-3 py-2 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              View / Edit Fields
            </button>
          </div>

          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Save All Settings
          </button>
        </div>
      </div>
    </section>
  );
}
```

### 重构后的主页面：`src/app/app/projects/[id]/page.tsx`

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { IntentPanel } from "./components/panels/intent-panel";
import { CompilePanel } from "./components/panels/compile-panel";
import { PreviewPanel } from "./components/panels/preview-panel";
import { PublishPanel } from "./components/panels/publish-panel";
import { EditPanel } from "./components/panels/edit-panel";
import { DetailsPanel } from "./components/panels/details-panel";

interface ProjectPageProps {
  params: { id: string };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      `
      id,
      name,
      status,
      user_id,
      raw_intent,
      compiled_intent,
      rendered_model,
      published_slug,
      merchant_profile
    `,
    )
    .eq("id", params.id)
    .single();

  if (!project) {
    notFound();
  }

  const compiledIntent = project.compiled_intent as CompiledIntentV2 | null;
  const merchantProfile = project.merchant_profile;

  return (
    <div className="space-y-8 pb-12">
      <IntentPanel compiledIntent={compiledIntent} rawPrompt={project.raw_intent || ""} />

      <CompilePanel
        projectId={project.id}
        rawPrompt={project.raw_intent || ""}
        onCompileSuccess={(intent, fields) => {
          console.log("Compiled:", intent, fields);
          // Re-fetch or update UI
        }}
      />

      <PreviewPanel projectId={project.id} publishedSlug={project.published_slug} />

      <PublishPanel projectId={project.id} status={project.status as "draft" | "published"} liveUrl={project.published_slug ? `https://hibiz.com/site/${project.published_slug}` : undefined} />

      <EditPanel projectId={project.id} merchantProfile={merchantProfile} />

      <DetailsPanel projectId={project.id} />
    </div>
  );
}
```

---

## 🔗 Part 3: Server Actions 集成

### 新文件：`src/app/app/projects/compile-intent-v2-action.ts`

```typescript
"use server";

import { createClient } from "@/utils/supabase/server";
import { applyRuleGuard } from "@/lib/compiler/rule-guard";
import { compileLLMV2 } from "@/lib/compiler/llm-compiler-v2";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";

export interface CompileV2Result {
  intent: CompiledIntentV2;
  cost: number; // 成本（美分），LLM 调用为 $0.01
}

export async function compileIntentV2Action(projectId: string, rawPrompt: string): Promise<CompileV2Result> {
  const supabase = createClient();

  // 1. Rule Guard (零成本)
  const ruleGuardResult = await applyRuleGuard(rawPrompt);

  if (!ruleGuardResult.passed) {
    throw new Error(`Rule Guard failed: ${ruleGuardResult.reasons.join(", ")}`);
  }

  // 2. LLM Compiler V2 (成本: $0.01)
  const compiledIntent = await compileLLMV2(rawPrompt, ruleGuardResult, { maxRetries: 2 });

  return {
    intent: compiledIntent,
    cost: 1, // $0.01
  };
}

export async function confirmIntentV2Action(projectId: string, intent: CompiledIntentV2): Promise<void> {
  const supabase = createClient();

  // 保存确认后的 intent 到数据库
  const { error } = await supabase.from("projects").update({
    compiled_intent: intent,
    status: "compiled",
    updated_at: new Date().toISOString(),
  }).eq("id", projectId);

  if (error) {
    throw new Error(`Failed to save compiled intent: ${error.message}`);
  }
}
```

---

## ✅ 实现检查清单

### Phase 3 Form Builder
- [ ] 创建 `src/types/form-builder.ts` — 字段池 + 规则表
- [ ] 创建 `src/lib/generation/llm-form-builder.ts` — buildFormFieldsFromRules()
- [ ] 创建 `src/lib/generation/llm-form-builder.test.ts` — 3 个单元测试
- [ ] 运行 `npm test -- llm-form-builder.test` 验证所有测试通过
- [ ] TypeScript 编译无错误

### 后台页面重排版
- [ ] 创建 `src/app/app/projects/[id]/layout.tsx` — 新布局包装器
- [ ] 创建 `src/app/app/projects/[id]/components/sidebar.tsx` — 左侧导航
- [ ] 创建所有 6 个 Panel 组件（intent, compile, preview, publish, edit, details）
- [ ] 重构 `src/app/app/projects/[id]/page.tsx` — 仅数据获取 + panel 组装
- [ ] 所有导航链接（`#intent`, `#compile` 等）工作正常
- [ ] 响应式设计：桌面/平板/移动端测试

### Server Actions 集成
- [ ] 创建 `src/app/app/projects/compile-intent-v2-action.ts` — 两个 server actions
- [ ] CompilePanel 集成 `compileIntentV2Action`
- [ ] 显示成本、错误处理、加载状态
- [ ] 表单字段推荐显示
- [ ] 确认流程（compiled → confirmed）工作正常

### E2E 测试
- [ ] 完整流程：Intent → Compile → Confirm → Fields → Preview → Publish
- [ ] Rule Guard 失败处理
- [ ] LLM API 错误处理
- [ ] 表单字段正确推荐（房地产 vs 移民）
- [ ] 样式：Tailwind classes 正确应用，无重叠/布局问题

---

## 📊 工作估算

| 项目 | 时间 |
|------|------|
| Phase 3 Form Builder | 4-6h |
| 后台页面重排版 | 3-4h |
| Server Actions 集成 | 3-4h |
| E2E 测试 + 样式调整 | 2-3h |
| **总计** | **12-17h** |

---

## 🎓 关键点

1. **Form Builder 是零成本的**：使用规则表，没有 LLM 调用，即刻返回推荐字段
2. **侧边栏导航**：锚点链接 (`#intent`, `#compile` 等)，smooth scroll
3. **CompilePanel 核心流程**：
   - 点击 "Compile" → 调用 `compileIntentV2Action()`
   - 自动推荐字段（`buildFormFieldsAction()`）
   - 用户点击 "Confirm" → 调用 `confirmIntentV2Action()` 保存
4. **Error Handling**：Rule Guard 失败、API 错误都要显示友好提示
5. **成本透明**：显示 "$0.01 per LLM call"

---

## 📝 输出语言

所有代码注释用英文，UI 标签可中英混用（如 "Compile (v0.4 Hybrid)" 或 "编译 (v0.4 混合)")。

---

**祝编码愉快！** 🚀
