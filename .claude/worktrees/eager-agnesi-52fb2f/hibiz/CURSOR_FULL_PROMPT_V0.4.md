# HiBiz v0.4 — Cursor 完整工作提示词

## 项目简介

**项目**：HiBiz（Magic Lab 旗下产品）
**用途**：新西兰本地商家的 AI 微站 + 表单引擎
**当前版本**：v0.3.0（已发布，社媒内容营销 + 数据仪表盘）
**本次任务**：v0.4.0（AI 编译器升级 + 多行业扩展）

---

## 技术栈

| 层 | 技术 |
|----|------|
| **框架** | Next.js 14 (App Router), TypeScript 5.3+ (strict mode) |
| **UI** | React 18.2 + Tailwind CSS 3.4 |
| **认证** | Supabase Auth (Magic Link) |
| **数据库** | Supabase PostgreSQL + RLS |
| **AI** | OpenAI API (gpt-4o-mini), Structured Output (JSON Schema) |
| **海报生成** | html-to-image |
| **图表** | Recharts |
| **部署** | Render (生产环境, hibiz-service.onrender.com) |

---

## 架构核心

### 当前（v0.3）：Rule-Based 编译器

```
用户输入
  ↓
Rule Guard（正则预过滤）
  ↓
Rule-Based Compiler（确定性编译）
  ↓
CompiledIntentV1
  ↓
用户确认
  ↓
LLM Copy Generator + Skeleton Assembly
  ↓
RenderModelV1 → 预览 → 发布
```

**优点**：快速、零成本、确定性
**缺点**：规则难扩展、复杂场景覆盖不足

### v0.4：混合编译器（Rule + LLM）

```
用户输入
  ↓
Rule Guard（快速预过滤，成本=0）
  ↓
LLM Compiler V2（结构化意图，成本~0.01 USD）
  ↓
CompiledIntentV2（增强字段：industry, scene, page_type, module_selection, form_field_pool）
  ↓
用户确认意图
  ↓
LLM Form Builder（智能选表单字段，可选）
  ↓
LLM Copy Generator + Plugin-based Assembly（基于 industry plugin）
  ↓
RenderModelV1 → 预览 → 发布
```

**优点**：支持复杂意图、可扩展、industry-aware
**成本**：~0.01-0.05 USD per compilation

---

## v0.4 工作内容

### 概览：7 个 Phase

| Phase | 内容 | 关键文件 | 工作量 |
|-------|------|---------|--------|
| **0** | 类型定义 + 架构设计 | `compiled-intent-v2.ts`, `rule-guard.ts`, `form-builder.ts` | 4h |
| **1** | Rule Guard 升级 | `rule-guard.ts` | 6h |
| **2** | LLM Compiler V2 实现 | `llm-compiler-v2.ts` | 8h |
| **3** | LLM Form Builder | `llm-form-builder.ts` | 6h |
| **4** | 留学移民骨架 | `immigration-skeletons.ts`, `immigration-profile.ts` | 5h |
| **5** | Plugin 架构设计 | `industry-plugin.ts`, `registry.ts` | 8h |
| **6** | Server Actions 集成 | `generation-actions.ts` 修改 | 6h |
| **7** | 测试 + 文档同步 | Unit + Integration tests, ROADMAP, CHANGELOG | 10h |
| | **总计** | | **~53h** |

---

## Phase 0：类型定义与架构

### 0.1 新增文件：`src/types/compiled-intent-v2.ts`

```typescript
/**
 * CompiledIntentV2 — 增强版本的编译意图
 * 支持：多行业、模块选择权重、智能表单字段
 */

export type Industry = "real_estate" | "immigration";

export type RealEstateScene =
  | "property_listing"
  | "open_home_event"
  | "market_update";

export type ImmigrationScene =
  | "visa_consultation"
  | "school_info"
  | "program_enrollment";

export type Scene = RealEstateScene | ImmigrationScene;

export type Language = "en" | "zh" | "both";

export type PageType = "landing" | "showcase" | "form" | "multi_section";

export type Tone = "professional" | "friendly" | "urgent";

export type Goal =
  | "lead_generation"
  | "info_display"
  | "event_registration"
  | "consultation_booking";

export interface ModuleSelection {
  [moduleKey: string]: {
    enabled: boolean;
    priority?: "high" | "medium" | "low";
    weight?: number; // 0-1, for sorting/ranking
  };
}

export interface FormFieldDefinition {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "select" | "date" | "textarea" | "checkbox";
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface CompiledIntentV2 {
  // 基本信息
  id: string;
  project_id: string;

  // 核心编译结果
  industry: Industry;
  scene: Scene;
  language: Language;

  // LLM 编译结果
  page_type?: PageType;
  tone?: Tone;
  goal?: Goal;
  description?: string; // AI 理解的用户意图描述

  // 骨架选择（来自 industry plugin）
  skeleton_id?: string; // e.g., "classic-agent", "consultant-pro"

  // 模块选择权重
  module_selection?: ModuleSelection;

  // 表单字段池（来自 LLM Form Builder）
  form_field_pool?: {
    [fieldId: string]: FormFieldDefinition;
  };
  form_field_order?: string[]; // 字段 ID 的排序列表

  // 编译审计
  compiler_version: "rule_v1" | "hybrid_v2";
  rule_guard_result?: RuleGuardResult;
  user_confirmed: boolean; // 用户是否确认了这个意图

  // 元数据
  created_at: string;
  updated_at: string;
}
```

### 0.2 新增文件：`src/types/rule-guard.ts`

```typescript
/**
 * Rule Guard — 快速预过滤层
 * 成本：0
 * 用途：城市检测、行业检测、语言检测、垃圾过滤
 */

export interface RuleGuardResult {
  passed: boolean; // 输入是否通过了规则检查
  reasons: string[]; // 失败原因（如果 passed=false）

  // 提示信息（给 LLM Compiler 参考）
  industry_hint?: "real_estate" | "immigration";
  language_hint?: "en" | "zh" | "both";
  city?: string; // 检测到的城市

  // 其他元数据
  input_length: number;
  contains_keywords?: string[]; // 检测到的关键词
}

export interface RuleGuardConfig {
  min_input_length: number; // default: 5
  max_input_length: number; // default: 5000
  blacklist_words: string[];
  nz_cities: string[];
  immigration_keywords: string[];
  real_estate_keywords: string[];
}
```

### 0.3 新增文件：`src/types/form-builder.ts`

```typescript
/**
 * Form Builder — 表单字段生成器类型
 */

export interface FormBuilderRequest {
  industry: Industry;
  scene: Scene;
  goal?: Goal;
  language?: Language;
}

export interface FormBuilderResult {
  selected_fields: FormFieldDefinition[];
  field_order: string[];
  groups?: Array<{
    name: string;
    field_ids: string[];
  }>;
  reasoning?: string; // AI 的选择理由
}

export const UNIVERSAL_FIELD_POOL: Record<string, FormFieldDefinition> = {
  name: {
    id: "name",
    label: "Full Name",
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
    label: "Phone",
    type: "phone",
    required: true,
    placeholder: "+64 21 123 4567",
  },
  // ... 更多通用字段
};

export const INDUSTRY_FIELD_POOLS: Record<Industry, Record<string, FormFieldDefinition>> = {
  real_estate: {
    property_address: {
      id: "property_address",
      label: "Property Address",
      type: "text",
      required: false,
    },
    bedrooms: {
      id: "bedrooms",
      label: "Bedrooms",
      type: "select",
      required: false,
      options: ["1", "2", "3", "4", "5+"].map(v => ({ value: v, label: v })),
    },
    budget: {
      id: "budget",
      label: "Budget",
      type: "text",
      required: false,
    },
    timeline: {
      id: "timeline",
      label: "Timeline",
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
        // ... 更多国家
      ],
    },
    degree_level: {
      id: "degree_level",
      label: "Degree Level",
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
      label: "Test Scores (IELTS, TOEFL, etc.)",
      type: "textarea",
      required: false,
    },
    // ... 更多留学字段
  },
};
```

### 0.4 扩展现有类型

修改 `src/types/compiled-intent.ts`：

```typescript
// 添加到现有的 CompiledIntentV1
export interface CompiledIntentV1 {
  // ... 现有字段 ...

  // 新增：支持 v0.4
  compiler_version?: "rule_v1" | "hybrid_v2";
}
```

### 0.5 验证清单

- [ ] 所有新增类型文件创建
- [ ] `src/types/index.ts` 导出所有新类型
- [ ] TypeScript 编译无错：`npm run build`
- [ ] ESLint 通过：`npm run lint`

---

## Phase 1：Rule Guard 升级

### 1.1 新增文件：`src/lib/compiler/rule-guard.ts`

```typescript
/**
 * Rule Guard — 快速规则守卫
 * 成本：0（无 API 调用）
 *
 * 职责：
 * 1. 输入合法性检查（长度、字符）
 * 2. 城市检测（NZ cities）
 * 3. 行业关键词检测（房产 vs 留学）
 * 4. 语言检测（英文 vs 中文）
 * 5. 垃圾输入过滤
 */

import { RuleGuardResult, RuleGuardConfig } from "@/types/rule-guard";

const DEFAULT_CONFIG: RuleGuardConfig = {
  min_input_length: 5,
  max_input_length: 5000,
  blacklist_words: [
    "spam", "xxx", "click here", // ... 更多禁词
  ],
  nz_cities: [
    "Auckland", "Wellington", "Christchurch", "Hamilton",
    "Tauranga", "Dunedin", "Palmerston North", "Rotorua",
    // ... NZ 所有主要城市
  ],
  immigration_keywords: [
    "visa", "immigration", "migration", "study", "student", "qualify",
    "degree", "ielts", "toefl", "permanent resident", "pr",
    "签证", "移民", "留学", "学生", "考试", "雅思", "托福",
  ],
  real_estate_keywords: [
    "property", "house", "apartment", "flat", "bedroom", "bathroom",
    "price", "rent", "lease", "agent", "listing", "real estate",
    "房产", "房子", "公寓", "卧室", "浴室", "价格", "租", "中介",
  ],
};

export async function applyRuleGuard(
  rawPrompt: string,
  config: RuleGuardConfig = DEFAULT_CONFIG
): Promise<RuleGuardResult> {
  const trimmed = rawPrompt.trim();
  const reasons: string[] = [];

  // 1. 长度检查
  if (trimmed.length < config.min_input_length) {
    reasons.push(`Input too short (min ${config.min_input_length} characters)`);
  }
  if (trimmed.length > config.max_input_length) {
    reasons.push(`Input too long (max ${config.max_input_length} characters)`);
  }

  // 2. 垃圾词检查
  const lower = trimmed.toLowerCase();
  for (const word of config.blacklist_words) {
    if (lower.includes(word)) {
      reasons.push(`Blacklist word detected: ${word}`);
    }
  }

  // 3. 城市检测
  let detectedCity: string | undefined;
  for (const city of config.nz_cities) {
    if (trimmed.includes(city) || lower.includes(city.toLowerCase())) {
      detectedCity = city;
      break;
    }
  }

  // 4. 行业关键词检测
  let industry_hint: "real_estate" | "immigration" | undefined;
  let realEstateScore = 0;
  let immigrationScore = 0;

  for (const kw of config.real_estate_keywords) {
    if (lower.includes(kw)) realEstateScore++;
  }
  for (const kw of config.immigration_keywords) {
    if (lower.includes(kw)) immigrationScore++;
  }

  if (realEstateScore > immigrationScore && realEstateScore > 0) {
    industry_hint = "real_estate";
  } else if (immigrationScore > realEstateScore && immigrationScore > 0) {
    industry_hint = "immigration";
  }

  // 5. 语言检测（简化版）
  const chineseCharRegex = /[\u4e00-\u9fff]/g;
  const chineseMatches = trimmed.match(chineseCharRegex) || [];
  let language_hint: "en" | "zh" | "both" | undefined;

  if (chineseMatches.length > trimmed.length * 0.3) {
    language_hint = "zh";
  } else if (chineseMatches.length > 0) {
    language_hint = "both";
  } else {
    language_hint = "en";
  }

  // 6. 关键词检测（供调试）
  const detectedKeywords: string[] = [];
  for (const kw of [...config.real_estate_keywords, ...config.immigration_keywords]) {
    if (lower.includes(kw)) detectedKeywords.push(kw);
  }

  const passed = reasons.length === 0;

  return {
    passed,
    reasons,
    industry_hint,
    language_hint,
    city: detectedCity,
    input_length: trimmed.length,
    contains_keywords: detectedKeywords,
  };
}
```

### 1.2 单元测试：`src/lib/compiler/__tests__/rule-guard.test.ts`

```typescript
import { applyRuleGuard } from "../rule-guard";

describe("Rule Guard", () => {
  it("should reject short input", async () => {
    const result = await applyRuleGuard("hi");
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("too short");
  });

  it("should detect real_estate industry", async () => {
    const result = await applyRuleGuard("I want to list my apartment for rent");
    expect(result.passed).toBe(true);
    expect(result.industry_hint).toBe("real_estate");
  });

  it("should detect immigration industry", async () => {
    const result = await applyRuleGuard(
      "I'm a student looking for visa sponsorship for my master's degree"
    );
    expect(result.passed).toBe(true);
    expect(result.industry_hint).toBe("immigration");
  });

  it("should detect language hint (Chinese)", async () => {
    const result = await applyRuleGuard("我想要申请留学签证");
    expect(result.passed).toBe(true);
    expect(result.language_hint).toBe("zh");
  });

  it("should reject blacklist words", async () => {
    const result = await applyRuleGuard("Click here for spam content");
    expect(result.passed).toBe(false);
  });
});
```

### 1.3 验证清单

- [ ] `rule-guard.ts` 实现完整
- [ ] 单元测试覆盖 >80%
- [ ] 测试通过：`npm test -- rule-guard.test.ts`
- [ ] 成本验证：无 API 调用

---

## Phase 2：LLM Compiler V2

### 2.1 新增文件：`src/lib/compiler/llm-compiler-v2.ts`

```typescript
/**
 * LLM Compiler V2 — 混合编译器的 LLM 层
 * 成本：~0.01 USD per call
 *
 * 职责：
 * 1. 接收 raw_prompt + rule_guard_result
 * 2. 调用 OpenAI gpt-4o-mini，使用 JSON Schema
 * 3. 返回结构化 CompiledIntentV2
 * 4. 处理错误 + 重试
 */

import { OpenAI } from "openai";
import {
  CompiledIntentV2,
  Industry,
  Scene,
  Language,
  PageType,
  Tone,
  Goal,
} from "@/types/compiled-intent-v2";
import { RuleGuardResult } from "@/types/rule-guard";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// JSON Schema for OpenAI structured output
const INTENT_SCHEMA = {
  type: "object" as const,
  properties: {
    industry: {
      type: "string",
      enum: ["real_estate", "immigration"],
      description: "Industry type",
    },
    scene: {
      type: "string",
      description:
        "Specific use case (e.g., property_listing, visa_consultation)",
    },
    language: {
      type: "string",
      enum: ["en", "zh", "both"],
      description: "Language preference",
    },
    page_type: {
      type: "string",
      enum: ["landing", "showcase", "form", "multi_section"],
      description: "Recommended page layout type",
    },
    tone: {
      type: "string",
      enum: ["professional", "friendly", "urgent"],
      description: "Tone of content",
    },
    goal: {
      type: "string",
      enum: ["lead_generation", "info_display", "event_registration", "consultation_booking"],
      description: "Primary goal",
    },
    description: {
      type: "string",
      description: "AI understanding of user intent (Chinese or English)",
    },
  },
  required: ["industry", "scene", "language"],
};

export async function compileLLMV2(
  rawPrompt: string,
  ruleGuardResult: RuleGuardResult,
  options?: {
    maxRetries?: number;
    timeout?: number;
  }
): Promise<CompiledIntentV2> {
  const maxRetries = options?.maxRetries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an AI intent compiler for a microsite builder platform.
Your job is to understand user intent and structure it into a JSON format.

Rules:
- If the user mentions real estate (house, property, rent, etc.), set industry to "real_estate"
- If the user mentions education/immigration (visa, student, study, migration, etc.), set industry to "immigration"
- Language: detect if input is English (en), Chinese (zh), or mixed (both)
- page_type: choose the most appropriate layout (landing, showcase, form, multi_section)
- tone: infer from the user's writing style (professional, friendly, urgent)
- goal: what is the primary objective (lead generation, info display, etc.)

Respond with valid JSON only.`,

          },
          {
            role: "user",
            content: `User input: ${rawPrompt}

Additional context from rule analysis:
- Industry hint: ${ruleGuardResult.industry_hint || "none"}
- Language hint: ${ruleGuardResult.language_hint || "unknown"}
- Detected city: ${ruleGuardResult.city || "none"}
- Keywords: ${ruleGuardResult.contains_keywords?.join(", ") || "none"}

Analyze this input and return a JSON object with the structure I defined.`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from OpenAI");
      }

      const parsed = JSON.parse(content);

      // Validate required fields
      if (!parsed.industry || !parsed.scene || !parsed.language) {
        throw new Error("Missing required fields in LLM response");
      }

      // Build CompiledIntentV2
      const intent: CompiledIntentV2 = {
        id: `intent_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        project_id: "", // Will be set by caller
        industry: parsed.industry as Industry,
        scene: parsed.scene as Scene,
        language: parsed.language as Language,
        page_type: parsed.page_type as PageType | undefined,
        tone: parsed.tone as Tone | undefined,
        goal: parsed.goal as Goal | undefined,
        description: parsed.description,
        compiler_version: "hybrid_v2",
        rule_guard_result: ruleGuardResult,
        user_confirmed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return intent;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }
  }

  throw new Error(
    `Failed to compile intent after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}

/**
 * 装饰函数：处理 LLM 编译的完整流程
 * Rule Guard → LLM Compile → CompiledIntentV2
 */
export async function compileIntentHybrid(
  rawPrompt: string,
  ruleGuardResult: RuleGuardResult
): Promise<CompiledIntentV2> {
  if (!ruleGuardResult.passed) {
    throw new Error(
      `Rule Guard failed: ${ruleGuardResult.reasons.join("; ")}`
    );
  }

  return compileLLMV2(rawPrompt, ruleGuardResult);
}
```

### 2.2 单元测试：`src/lib/compiler/__tests__/llm-compiler-v2.test.ts`

```typescript
import { compileLLMV2 } from "../llm-compiler-v2";
import { RuleGuardResult } from "@/types/rule-guard";

// Mock OpenAI (使用 jest.mock 或 @testing-library/jest-dom)
jest.mock("openai");

describe("LLM Compiler V2", () => {
  it("should compile real estate intent", async () => {
    const mockResult: RuleGuardResult = {
      passed: true,
      reasons: [],
      industry_hint: "real_estate",
      language_hint: "en",
    };

    const result = await compileLLMV2(
      "I want to list a 3-bedroom apartment in Auckland",
      mockResult
    );

    expect(result.industry).toBe("real_estate");
    expect(result.language).toBe("en");
    expect(result.compiler_version).toBe("hybrid_v2");
  });

  it("should compile immigration intent", async () => {
    const mockResult: RuleGuardResult = {
      passed: true,
      reasons: [],
      industry_hint: "immigration",
      language_hint: "zh",
    };

    const result = await compileLLMV2(
      "我想申请澳洲学生签证",
      mockResult
    );

    expect(result.industry).toBe("immigration");
    expect(result.language).toBe("zh");
  });

  it("should retry on API failure", async () => {
    // Test retry logic
    // (Implementation depends on mocking setup)
  });
});
```

### 2.3 验证清单

- [ ] `llm-compiler-v2.ts` 实现完整
- [ ] JSON Schema 正确定义
- [ ] 错误处理完整（retry, timeout）
- [ ] 单元测试覆盖 >80%
- [ ] 测试通过：`npm test -- llm-compiler-v2.test.ts`
- [ ] 成本验证：~0.01 USD per call

---

## Phase 3：LLM Form Builder

### 3.1 新增文件：`src/lib/generation/llm-form-builder.ts`

```typescript
/**
 * LLM Form Builder — 智能表单字段生成
 *
 * 职责：
 * 1. 接收 industry + scene + goal
 * 2. 从字段池中选择相关字段
 * 3. 排序字段（常用字段优先）
 * 4. 返回 FormBuilderResult
 *
 * 实现方式：可用规则表驱动 or LLM 调用
 * 当前：规则表驱动（成本=0，快速）
 */

import {
  FormBuilderRequest,
  FormBuilderResult,
  UNIVERSAL_FIELD_POOL,
  INDUSTRY_FIELD_POOLS,
  FormFieldDefinition,
} from "@/types/form-builder";
import { Industry, Scene } from "@/types/compiled-intent-v2";

// 规则表：根据 industry+scene 选择字段
const FORM_FIELD_RULES: Record<
  Industry,
  Record<Scene, { universal: string[]; industry: string[]; groups?: string[] }>
> = {
  real_estate: {
    property_listing: {
      universal: ["name", "email", "phone"],
      industry: ["property_address", "bedrooms", "budget", "timeline"],
      groups: ["contact", "property"],
    },
    open_home_event: {
      universal: ["name", "email", "phone"],
      industry: ["property_address", "attendees", "availability"],
      groups: ["contact", "event"],
    },
    market_update: {
      universal: ["name", "email", "phone"],
      industry: ["interested_area", "property_type"],
      groups: ["contact", "interest"],
    },
  } as any, // 类型需扩展
  immigration: {
    visa_consultation: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "visa_type", "degree_level"],
      groups: ["contact", "visa"],
    },
    school_info: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "degree_level", "field_of_study"],
      groups: ["contact", "education"],
    },
    program_enrollment: {
      universal: ["name", "email", "phone"],
      industry: ["target_country", "program_name", "start_date"],
      groups: ["contact", "enrollment"],
    },
  } as any,
};

export function buildFormFieldPool(
  request: FormBuilderRequest
): FormBuilderResult {
  const rule =
    FORM_FIELD_RULES[request.industry]?.[request.scene as any];

  if (!rule) {
    // Fallback: use universal fields only
    const fields = Object.values(UNIVERSAL_FIELD_POOL);
    return {
      selected_fields: fields,
      field_order: Object.keys(UNIVERSAL_FIELD_POOL),
      reasoning: "No specific rule found, using universal fields",
    };
  }

  // Build field list
  const selectedFields: FormFieldDefinition[] = [];
  const fieldOrder: string[] = [];

  // 1. Add universal fields
  for (const fieldId of rule.universal) {
    if (UNIVERSAL_FIELD_POOL[fieldId]) {
      selectedFields.push(UNIVERSAL_FIELD_POOL[fieldId]);
      fieldOrder.push(fieldId);
    }
  }

  // 2. Add industry-specific fields
  const industryPool = INDUSTRY_FIELD_POOLS[request.industry];
  for (const fieldId of rule.industry) {
    if (industryPool?.[fieldId]) {
      selectedFields.push(industryPool[fieldId]);
      fieldOrder.push(fieldId);
    }
  }

  return {
    selected_fields: selectedFields,
    field_order: fieldOrder,
    groups: rule.groups,
    reasoning: `Selected ${selectedFields.length} fields for ${request.industry}/${request.scene}`,
  };
}

/**
 * LLM-based Form Builder (可选，高成本但更智能)
 */
export async function buildFormFieldPoolLLM(
  request: FormBuilderRequest
): Promise<FormBuilderResult> {
  // TODO: 可选的 LLM 版本，使用 OpenAI 选择字段
  // 成本：~0.01 USD per call
  // 优点：更智能、可处理复杂场景
  // 缺点：有延迟、需要 API 调用

  throw new Error("LLM form builder not yet implemented");
}
```

### 3.2 单元测试：`src/lib/generation/__tests__/form-builder.test.ts`

```typescript
import { buildFormFieldPool } from "../llm-form-builder";

describe("Form Builder", () => {
  it("should build fields for real estate property listing", () => {
    const result = buildFormFieldPool({
      industry: "real_estate",
      scene: "property_listing" as any,
    });

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("name");
    expect(result.field_order).toContain("email");
    expect(result.field_order).toContain("property_address");
  });

  it("should build fields for immigration visa consultation", () => {
    const result = buildFormFieldPool({
      industry: "immigration",
      scene: "visa_consultation" as any,
    });

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("target_country");
    expect(result.field_order).toContain("degree_level");
  });
});
```

### 3.3 验证清单

- [ ] `llm-form-builder.ts` 实现完整
- [ ] 规则表覆盖主要 industry+scene 组合
- [ ] 单元测试覆盖 >80%
- [ ] 测试通过：`npm test -- form-builder.test.ts`

---

## Phase 4：多行业扩展 — 留学移民骨架

### 4.1 新增文件：`src/types/immigration-profile.ts`

```typescript
/**
 * 留学移民商家资料扩展
 */

export interface ImmigrationProfileV1 {
  // 基本信息
  consultant_name: string; // 顾问名字
  qualification_ids?: string[]; // 资质 ID（PY, MARA 等）

  // 联系信息
  phone: string;
  email: string;
  wechat?: string;
  whatsapp?: string;
  linkedin?: string;

  // 专业信息
  specialization?: string[]; // ["visa_migration", "education", "business"]
  target_countries?: string[]; // ["australia", "canada", "nz"]
  years_of_experience?: number;
  success_count?: number; // 成功案例数

  // 商家品牌
  logo_url?: string;
  company_name?: string;
  company_bio_en?: string;
  company_bio_zh?: string;

  // 扩展
  [key: string]: any;
}
```

### 4.2 新增文件：`src/data/skeletons/immigration-skeletons.ts`

```typescript
/**
 * 留学移民骨架定义（3 套）
 * 格式与房产骨架一致，参考 src/data/skeletons/real-estate-skeletons.ts
 */

import { TemplateSkeleton } from "@/types/skeleton";

export const IMMIGRATION_SKELETONS: TemplateSkeleton[] = [
  {
    id: "consultant-pro",
    name: "Consultant Pro",
    description: "Professional consultant brand showcase",
    category: "immigration",
    defaultScene: "visa_consultation",

    defaultTheme: {
      primary: "#1a4d7a", // Deep blue (professional)
      secondary: "#f0ad4e", // Gold (trust)
      accent: "#5cb85c", // Green (success)
    },

    modules: [
      {
        type: "hero",
        variant: "consultant",
        content: {
          title: "{consultant_name}, Immigration Consultant",
          subtitle: "Specialist in {specialization.join(', ')}",
          cta_text: "Book Consultation",
          image_url: "{logo_url}",
        },
      },
      {
        type: "about",
        variant: "consultant",
        content: {
          title: "About Me",
          bio: "{company_bio_en}",
          qualifications: "{qualification_ids}",
          experience_years: "{years_of_experience}",
        },
      },
      {
        type: "services",
        variant: "grid",
        content: {
          items: [
            { title: "Visa Migration", description: "..." },
            { title: "Education Planning", description: "..." },
            { title: "Business Immigration", description: "..." },
          ],
        },
      },
      {
        type: "testimonials",
        variant: "carousel",
        content: {
          title: "Success Stories",
          items: [
            { author: "Client Name", quote: "...", rating: 5 },
          ],
        },
      },
      {
        type: "faq",
        variant: "accordion",
        content: {
          title: "Common Questions",
          items: [
            { q: "What visa should I apply for?", a: "..." },
          ],
        },
      },
      {
        type: "contact",
        variant: "full",
        content: {
          name: "{consultant_name}",
          phone: "{phone}",
          email: "{email}",
          wechat: "{wechat}",
          whatsapp: "{whatsapp}",
        },
      },
    ],

    defaultFormTemplate: "visa_consultation",
  },

  {
    id: "school-guide",
    name: "School Guide",
    description: "Education institution & program showcase",
    category: "immigration",
    defaultScene: "school_info",

    defaultTheme: {
      primary: "#2c3e50",
      secondary: "#3498db",
      accent: "#e74c3c",
    },

    modules: [
      {
        type: "hero",
        variant: "school",
        content: {
          title: "{company_name}",
          subtitle: "Your Gateway to Quality Education",
          image_url: "{logo_url}",
        },
      },
      {
        type: "school_info",
        variant: "full",
        content: {
          description: "{company_bio_en}",
          location: "Address",
          founded_year: 2010,
        },
      },
      {
        type: "services", // 改为 programs
        variant: "grid",
        content: {
          title: "Our Programs",
          items: [
            { title: "Bachelor Degree", description: "..." },
            { title: "Master Degree", description: "..." },
            { title: "Diploma", description: "..." },
          ],
        },
      },
      {
        type: "testimonials",
        variant: "carousel",
      },
      {
        type: "timeline",
        variant: "vertical",
        content: {
          title: "Application Timeline",
          items: [
            { month: "January", event: "Application Deadline" },
            { month: "March", event: "Admission Decision" },
            { month: "June", event: "Enrollment" },
          ],
        },
      },
      {
        type: "contact",
        variant: "simple",
      },
    ],

    defaultFormTemplate: "school_info",
  },

  {
    id: "immigration-hub",
    name: "Immigration Hub",
    description: "Full-service immigration center",
    category: "immigration",
    defaultScene: "visa_consultation",

    defaultTheme: {
      primary: "#16a085",
      secondary: "#27ae60",
      accent: "#f39c12",
    },

    modules: [
      {
        type: "hero",
        variant: "service_center",
      },
      {
        type: "services",
        variant: "grid",
        content: {
          title: "Our Services",
          items: [
            { title: "Visa Migration", icon: "passport" },
            { title: "Education Consulting", icon: "book" },
            { title: "Citizenship", icon: "award" },
            { title: "Business Immigration", icon: "briefcase" },
          ],
        },
      },
      {
        type: "timeline",
        variant: "process",
        content: {
          title: "Our Process",
          steps: [
            "Free Initial Consultation",
            "Assessment & Planning",
            "Application Preparation",
            "Submission & Follow-up",
            "Approval & Onboarding",
          ],
        },
      },
      {
        type: "faq",
        variant: "accordion",
      },
      {
        type: "blog", // News/updates
        variant: "recent_posts",
      },
      {
        type: "contact",
        variant: "full",
      },
    ],

    defaultFormTemplate: "visa_consultation",
  },
];
```

### 4.3 验证清单

- [ ] `immigration-profile.ts` 定义完整
- [ ] 3 套骨架 JSON 有效
- [ ] 所有 module type 在 RenderModuleType 枚举内
- [ ] 模块内容使用 {placeholder} 而非硬编码值

---

## Phase 5：Plugin 架构设计

### 5.1 新增文件：`src/lib/plugins/industry-plugin.ts`

```typescript
/**
 * Industry Plugin Interface
 * 定义可扩展的行业插件架构
 */

import { TemplateSkeleton } from "@/types/skeleton";
import {
  FormFieldDefinition,
  FormBuilderResult,
  FormBuilderRequest,
} from "@/types/form-builder";
import { CompiledIntentV2, Industry } from "@/types/compiled-intent-v2";

export interface ComplianceCheckResult {
  passed: boolean;
  issues: string[];
}

export interface IndustryPlugin {
  // 插件元信息
  industryId: Industry | string;
  name: string;
  description: string;
  version: string;

  // 场景定义
  scenes: Array<{
    id: string;
    label: string;
    description: string;
    defaultPageType?: string;
  }>;

  // 骨架库
  skeletons: TemplateSkeleton[];

  // 字段池
  fieldPool: Record<string, FormFieldDefinition>;

  // AI Prompt 模板（用于 Copy Generator）
  aiPromptTemplate?: string;

  // 表单构建函数
  buildFormFields?: (
    request: FormBuilderRequest
  ) => FormBuilderResult | Promise<FormBuilderResult>;

  // 合规检查函数
  complianceFilter?: (
    intent: CompiledIntentV2
  ) => ComplianceCheckResult | Promise<ComplianceCheckResult>;

  // 自定义编译规则（可选）
  compilationRules?: {
    [ruleId: string]: (intent: CompiledIntentV2) => boolean;
  };
}
```

### 5.2 新增文件：`src/lib/plugins/registry.ts`

```typescript
/**
 * Plugin Registry — 注册表管理
 */

import { IndustryPlugin } from "./industry-plugin";
import { realEstatePlugin } from "./real-estate-plugin";
import { immigrationPlugin } from "./immigration-plugin";

export const INDUSTRY_PLUGINS: Record<string, IndustryPlugin> = {
  real_estate: realEstatePlugin,
  immigration: immigrationPlugin,
};

export function getPlugin(industryId: string): IndustryPlugin {
  const plugin = INDUSTRY_PLUGINS[industryId];
  if (!plugin) {
    throw new Error(`No plugin found for industry: ${industryId}`);
  }
  return plugin;
}

export function listPlugins(): IndustryPlugin[] {
  return Object.values(INDUSTRY_PLUGINS);
}

export function registerPlugin(plugin: IndustryPlugin): void {
  INDUSTRY_PLUGINS[plugin.industryId] = plugin;
}
```

### 5.3 新增文件：`src/lib/plugins/real-estate-plugin.ts`

```typescript
/**
 * 房产行业插件
 * 重构现有 v0.3 房产相关逻辑
 */

import { IndustryPlugin } from "./industry-plugin";
import { REAL_ESTATE_SKELETONS } from "@/data/skeletons/real-estate-skeletons";
import {
  UNIVERSAL_FIELD_POOL,
  INDUSTRY_FIELD_POOLS,
} from "@/types/form-builder";

export const realEstatePlugin: IndustryPlugin = {
  industryId: "real_estate",
  name: "Real Estate",
  description: "Property listing, open home events, market updates",
  version: "1.0.0",

  scenes: [
    {
      id: "property_listing",
      label: "Property Listing",
      description: "List a property for sale or rent",
    },
    {
      id: "open_home_event",
      label: "Open Home Event",
      description: "Promote an open home viewing",
    },
    {
      id: "market_update",
      label: "Market Update",
      description: "Share market insights and trends",
    },
  ],

  skeletons: REAL_ESTATE_SKELETONS,

  fieldPool: {
    ...UNIVERSAL_FIELD_POOL,
    ...INDUSTRY_FIELD_POOLS.real_estate,
  },

  aiPromptTemplate: `You are a real estate content specialist.
Generate professional, engaging content for {scene}.
Style: {tone}
Language: {language}
Target audience: Property seekers in {city || 'New Zealand'}

Merchant info:
- Name: {merchant_name}
- Phone: {merchant_phone}
- Email: {merchant_email}

Content guidelines:
- Highlight key features (bedrooms, location, condition)
- Use persuasive but honest language
- Include clear call-to-action
- Adapt to platform (Facebook, Instagram, LinkedIn, WeChat)`,

  buildFormFields: async (request) => {
    // Use rule-based form builder from Phase 3
    const { buildFormFieldPool } = await import("@/lib/generation/llm-form-builder");
    return buildFormFieldPool(request);
  },

  complianceFilter: async (intent) => {
    // Real estate compliance checks
    const issues: string[] = [];

    if (!intent.description) {
      issues.push("Property description is required");
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  },
};
```

### 5.4 新增文件：`src/lib/plugins/immigration-plugin.ts`

```typescript
/**
 * 留学移民行业插件
 */

import { IndustryPlugin } from "./industry-plugin";
import { IMMIGRATION_SKELETONS } from "@/data/skeletons/immigration-skeletons";
import {
  UNIVERSAL_FIELD_POOL,
  INDUSTRY_FIELD_POOLS,
} from "@/types/form-builder";

export const immigrationPlugin: IndustryPlugin = {
  industryId: "immigration",
  name: "Immigration & Education",
  description: "Visa consulting, school info, program enrollment",
  version: "1.0.0",

  scenes: [
    {
      id: "visa_consultation",
      label: "Visa Consultation",
      description: "Offer visa consultation services",
    },
    {
      id: "school_info",
      label: "School Information",
      description: "Showcase educational institution",
    },
    {
      id: "program_enrollment",
      label: "Program Enrollment",
      description: "Manage program applications",
    },
  ],

  skeletons: IMMIGRATION_SKELETONS,

  fieldPool: {
    ...UNIVERSAL_FIELD_POOL,
    ...INDUSTRY_FIELD_POOLS.immigration,
  },

  aiPromptTemplate: `You are an immigration & education consultant.
Generate informative, trustworthy content for {scene}.
Style: {tone}
Language: {language}
Target countries: {target_countries || 'Australia, Canada, NZ'}

Consultant/Institution info:
- Name: {consultant_name || company_name}
- Specialization: {specialization}
- Phone: {phone}
- Email: {email}

Content guidelines:
- Build trust and credibility
- Provide clear information
- Highlight success rate / qualifications
- Include relevant compliance info
- Strong call-to-action for consultation/enrollment`,

  buildFormFields: async (request) => {
    const { buildFormFieldPool } = await import("@/lib/generation/llm-form-builder");
    return buildFormFieldPool(request);
  },

  complianceFilter: async (intent) => {
    // Immigration compliance checks
    const issues: string[] = [];

    if (!intent.description) {
      issues.push("Service description is required");
    }

    // Could add: MARA registration check, visa rules validation, etc.

    return {
      passed: issues.length === 0,
      issues,
    };
  },
};
```

### 5.5 验证清单

- [ ] `industry-plugin.ts` 接口完整
- [ ] `registry.ts` 实现完整
- [ ] 房产/留学两个 plugin 实例完整
- [ ] Plugin 可正常注册和检索

---

## Phase 6：Server Actions 集成

### 6.1 修改文件：`src/app/app/projects/generation-actions.ts`

```typescript
/**
 * 更新 Generation Server Actions 以支持 v0.4
 * 现有逻辑保留（向后兼容），新增 v0.4 流程
 */

"use server";

import { applyRuleGuard } from "@/lib/compiler/rule-guard";
import { compileIntentHybrid } from "@/lib/compiler/llm-compiler-v2";
import { buildFormFieldPool } from "@/lib/generation/llm-form-builder";
import { getPlugin } from "@/lib/plugins/registry";
import {
  CompiledIntentV2,
  CompiledIntentV1,
} from "@/types/compiled-intent";

/**
 * [v0.4 新增] Server Action: 编译意图 (Rule Guard → LLM Compiler)
 * 返回 CompiledIntentV2 供用户确认
 */
export async function compileIntentAction(
  projectId: string,
  rawPrompt: string
): Promise<{
  success: boolean;
  intent?: CompiledIntentV2;
  error?: string;
}> {
  try {
    // Step 1: Rule Guard
    const ruleGuardResult = await applyRuleGuard(rawPrompt);

    if (!ruleGuardResult.passed) {
      return {
        success: false,
        error: `Input validation failed: ${ruleGuardResult.reasons.join("; ")}`,
      };
    }

    // Step 2: LLM Compiler V2
    const intent = await compileIntentHybrid(rawPrompt, ruleGuardResult);
    intent.project_id = projectId;

    return {
      success: true,
      intent,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * [v0.4 新增] Server Action: 构建表单字段
 * 在用户确认意图后，构建推荐的表单字段
 */
export async function buildFormFieldsAction(
  intentId: string,
  industry: string,
  scene: string
): Promise<{
  success: boolean;
  fields?: any;
  error?: string;
}> {
  try {
    const plugin = getPlugin(industry);

    if (!plugin.buildFormFields) {
      // Fallback to default
      return {
        success: true,
        fields: { selected_fields: [], field_order: [] },
      };
    }

    const result = await plugin.buildFormFields({
      industry: industry as any,
      scene: scene as any,
    });

    return {
      success: true,
      fields: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * [v0.4 修改] Server Action: 生成草稿
 * 支持 CompiledIntentV2 + Plugin 架构
 */
export async function generateDraftFromIntentAction(
  projectId: string,
  intent: CompiledIntentV2 | CompiledIntentV1,
  merchantProfile: any
): Promise<{
  success: boolean;
  draftModel?: any;
  error?: string;
}> {
  try {
    // 检查是否是 v0.4 intent
    const isV2 = (intent as CompiledIntentV2).compiler_version === "hybrid_v2";

    if (isV2) {
      const v2Intent = intent as CompiledIntentV2;
      const plugin = getPlugin(v2Intent.industry);

      // 从 plugin 获取骨架
      let skeleton = null;
      if (v2Intent.skeleton_id) {
        skeleton = plugin.skeletons.find(
          (s) => s.id === v2Intent.skeleton_id
        );
      } else {
        skeleton = plugin.skeletons[0]; // 默认第一个骨架
      }

      if (!skeleton) {
        return {
          success: false,
          error: "Skeleton not found",
        };
      }

      // TODO: 调用 LLM 生成文案
      // TODO: 使用 plugin.aiPromptTemplate 和 assembleRenderModel
      // 代码类似现有的 generateCopyAction，但用 plugin 的模板
    } else {
      // 兼容 v0.3 流程（保持现有逻辑）
      // ... existing code ...
    }

    return {
      success: false,
      error: "Not yet implemented",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### 6.2 修改文件：`src/app/app/projects/[id]/page.tsx`

```typescript
/**
 * 项目详情页 — 支持 v0.4 编译流程
 *
 * v0.3 流程：
 * 1. 用户输入 raw_prompt
 * 2. 点击"生成"
 * 3. 调用 compileIntent（rule-based）
 * 4. 显示 CompiledIntent，用户确认
 * 5. 调用 generateCopy
 * 6. 显示 RenderModel 预览
 * 7. 发布
 *
 * v0.4 流程（扩展）：
 * 1. 用户输入 raw_prompt
 * 2. 点击"生成"
 * 3. 调用 compileIntentAction（hybrid_v2）
 * 4. 显示 CompiledIntentV2（industry, scene, page_type, tone, goal）
 * 5. 用户可以：a) 接受，b) 手动修改某些字段
 * 6. 用户点"确认"
 * 7. 调用 buildFormFieldsAction 获取推荐表单字段
 * 8. 显示字段选择 UI（可编辑）
 * 9. 用户确认字段
 * 10. 调用 generateDraftFromIntentAction（新版本，使用 plugin）
 * 11. 显示 RenderModel 预览
 * 12. 发布
 *
 * UI 组件需要：
 * - CompileIntentV2Display: 显示 industry, scene, page_type, tone, goal
 * - FormFieldBuilder: 选择/排序表单字段
 */

// 伪代码 (实际实现在 React 组件中)
// import { compileIntentAction, buildFormFieldsAction } from "./generation-actions";

// function ProjectDetailPage() {
//   const [step, setStep] = useState<'input' | 'confirm_intent' | 'form_fields' | 'preview' | 'publish'>('input');
//   const [rawPrompt, setRawPrompt] = useState('');
//   const [compiledIntent, setCompiledIntent] = useState<CompiledIntentV2 | null>(null);
//   const [selectedFields, setSelectedFields] = useState<FormFieldDefinition[]>([]);

//   const handleGenerateIntent = async () => {
//     const result = await compileIntentAction(projectId, rawPrompt);
//     if (result.success && result.intent) {
//       setCompiledIntent(result.intent);
//       setStep('confirm_intent');
//     }
//   };

//   const handleConfirmIntent = async () => {
//     // 构建表单字段
//     const result = await buildFormFieldsAction(
//       compiledIntent!.id,
//       compiledIntent!.industry,
//       compiledIntent!.scene
//     );
//     if (result.success && result.fields) {
//       setSelectedFields(result.fields.selected_fields);
//       setStep('form_fields');
//     }
//   };

//   // ... 更多步骤 ...
// }
```

### 6.3 验证清单

- [ ] `generation-actions.ts` 支持 v0.4 流程
- [ ] 新增 `compileIntentAction` Server Action
- [ ] 新增 `buildFormFieldsAction` Server Action
- [ ] 修改 `generateDraftFromIntentAction` 支持 plugin
- [ ] 房产流程测试通过（v0.3 兼容）
- [ ] 留学流程测试通过（新流程）

---

## Phase 7：测试与文档同步

### 7.1 单元测试覆盖清单

```bash
# Rule Guard
npm test -- src/lib/compiler/__tests__/rule-guard.test.ts
# Coverage: >80%

# LLM Compiler V2
npm test -- src/lib/compiler/__tests__/llm-compiler-v2.test.ts
# Coverage: >80%

# Form Builder
npm test -- src/lib/generation/__tests__/form-builder.test.ts
# Coverage: >80%

# Plugin Registry
npm test -- src/lib/plugins/__tests__/registry.test.ts
# Coverage: >80%

# 全部测试
npm test
# Overall coverage: >80%
```

### 7.2 集成测试（端到端流程）

```typescript
/**
 * 集成测试：房产流程（v0.4 兼容 v0.3）
 */
describe("Real Estate Flow (v0.4)", () => {
  it("should complete end-to-end real estate property listing flow", async () => {
    const prompt = "I want to list my 3-bedroom apartment in Auckland for rent";

    // Step 1: Rule Guard
    const guardResult = await applyRuleGuard(prompt);
    expect(guardResult.passed).toBe(true);
    expect(guardResult.industry_hint).toBe("real_estate");

    // Step 2: LLM Compile
    const intent = await compileIntentHybrid(prompt, guardResult);
    expect(intent.industry).toBe("real_estate");
    expect(intent.compiler_version).toBe("hybrid_v2");

    // Step 3: Form Builder
    const formResult = buildFormFieldPool({
      industry: "real_estate",
      scene: "property_listing" as any,
    });
    expect(formResult.selected_fields.length).toBeGreaterThan(0);

    // Step 4: Generate Draft (using plugin)
    const plugin = getPlugin("real_estate");
    const draft = await generateDraftFromIntentAction(
      "proj_123",
      intent,
      mockMerchantProfile
    );
    expect(draft.success).toBe(true);
    expect(draft.draftModel).toBeDefined();
  });
});

/**
 * 集成测试：留学流程（新行业）
 */
describe("Immigration Flow (v0.4)", () => {
  it("should complete end-to-end immigration visa consultation flow", async () => {
    const prompt = "我是一个留学顾问，想帮助学生申请澳洲大学";

    // 类似房产流程...
  });
});
```

### 7.3 文档更新

**更新文件：`ROADMAP.md`**
```markdown
## v0.4 — AI 编译器升级 + 多行业扩展 [已完成 2026-04-15]

### 编译器升级
- [x] 混合编译器（Rule + LLM）
- [x] CompiledIntentV2 + module_selection
- [x] LLM Form Builder（字段池选取）

### 多行业
- [x] 留学移民顾问骨架（Consultant Pro、School Guide、Immigration Hub）
- [x] 行业插件架构（新行业 = 新骨架 + 新字段池 + 新合规规则）
```

**更新文件：`CHANGELOG.md`**
```markdown
## [0.4.0] - 2026-04-15

### 新增

- **混合编译器**：Rule Guard → LLM Compiler V2（industry-aware）
- **CompiledIntentV2**：增强意图类型（module_selection, form_field_pool）
- **LLM Form Builder**：根据 industry+scene 智能选择表单字段
- **留学移民骨架**：3 套新骨架（Consultant Pro, School Guide, Immigration Hub）
- **行业插件架构**：IndustryPlugin 接口 + registry，支持无限扩展
- **Server Actions 更新**：compileIntentAction, buildFormFieldsAction

### 技术改进

- 新增 `compiled-intent-v2.ts`, `rule-guard.ts`, `form-builder.ts` 类型
- 新增 `llm-compiler-v2.ts` 混合编译器
- 新增 `llm-form-builder.ts` 表单生成器
- 新增 `industry-plugin.ts`, `registry.ts` 插件架构
- 新增 `immigration-skeletons.ts`, `immigration-profile.ts` 留学数据
- 修改 `generation-actions.ts` 支持 v0.4 流程
- 单元测试覆盖 >80%

### 向后兼容

- v0.3 房产流程完全兼容（CompiledIntentV1 仍支持）
- Rule-based 编译器仍可用（通过 fallback 机制）
- 现有骨架、Server Actions 无需修改
```

**更新文件：`10-开发进度.md` (Obsidian)**
```markdown
v0.4 进度：100% 完成 ✅

### 编译器升级（v0.4）— 100%
- [x] Rule Guard 升级
- [x] LLM Compiler V2
- [x] Form Builder

### 多行业扩展（v0.4）— 100%
- [x] 3 套留学骨架
- [x] Plugin 架构设计
- [x] 房产 + 留学 plugin 实现

### 测试与文档（v0.4）— 100%
- [x] 单元测试 >80% 覆盖
- [x] 集成测试端到端通过
- [x] 文档同步
```

### 7.4 验证清单

- [ ] 所有单元测试通过（npm test）
- [ ] 代码覆盖率 >80%（npm test -- --coverage）
- [ ] ESLint 通过（npm run lint）
- [ ] TypeScript 编译通过（npm run build）
- [ ] 集成测试通过（房产 + 留学端到端）
- [ ] ROADMAP.md 更新为 v0.4 完成
- [ ] CHANGELOG.md 添加 v0.4.0 entry
- [ ] Obsidian 文档同步

---

## 开发工作流

### 推荐顺序

1. **Phase 0** → 类型定义（4h）
2. **Phase 1** → Rule Guard（6h）
3. **Phase 2** → LLM Compiler V2（8h）
4. **Phase 3** → Form Builder（6h）
5. **Phase 4** → 留学骨架（5h）
6. **Phase 5** → Plugin 架构（8h）
7. **Phase 6** → Server Actions（6h）
8. **Phase 7** → 测试 + 文档（10h）

### 平行开发建议

- Phase 4（骨架设计）可与 Phase 2-3 平行
- Phase 5（Plugin 架构）可与 Phase 4 平行
- 测试（单元测试）应随代码编写同步进行

### 依赖关系

```
Phase 0 (types)
    ↓
Phase 1 (rule-guard) ← → Phase 2 (llm-compiler)
    ↓                        ↓
Phase 3 (form-builder)  Phase 4 (skeletons)
    ↓                        ↓
Phase 5 (plugin-arch) ←─────┘
    ↓
Phase 6 (server-actions)
    ↓
Phase 7 (testing + docs)
```

---

## 代码质量标准

### TypeScript
- ✅ `strict: true` 模式
- ✅ 所有函数签名有类型
- ✅ 无 `any` 类型（除非特殊理由）
- ✅ 接口 > 类型别名（优先）

### 代码风格
- ✅ 文件 < 400 行（建议）
- ✅ 函数 < 50 行（建议）
- ✅ 常量 UPPER_SNAKE_CASE
- ✅ 函数/变量 camelCase
- ✅ 类/接口 PascalCase
- ✅ 完整的 JSDoc 注释（关键函数）

### 错误处理
- ✅ 所有异步操作必须 try-catch
- ✅ 错误信息用户友好 + 上下文清晰
- ✅ 不静默吞掉错误
- ✅ 日志级别明确（warn, error）

### 测试
- ✅ 单元测试 >80% 覆盖
- ✅ Mock 外部 API（OpenAI）
- ✅ 测试命名：describe > it > expect
- ✅ 测试独立性（无 test 间依赖）

### 安全性
- ✅ LLM 输出必须 Schema 校验
- ✅ 用户输入经过 Rule Guard
- ✅ 敏感字段（API key）用环境变量
- ✅ RLS 策略检查（数据库操作）

---

## 禁止事项

❌ **绝对不得：**

1. 在 LLM 输出中直接渲染（必须通过 Schema 校验）
2. 使用不在枚举中的 industry/scene/page_type 值
3. 硬编码行业逻辑（必须使用 plugin 架构）
4. 在表单生成中引入未授权的字段（必须在字段池内）
5. 跳过 Rule Guard（所有输入必须先过 Rule Guard）
6. 未经授权调用 LLM（成本控制）
7. 修改现有 v0.3 流程（必须向后兼容）
8. 在 compiuldIntentV1/V2 中混用数据（clear separation）

---

## 交付清单

### Code Deliverables
- [x] Phase 0-7 所有源码文件
- [x] TypeScript 编译通过
- [x] ESLint 通过
- [x] 单元测试 >80%
- [x] 集成测试端到端

### Documentation
- [x] 代码注释完整（JSDoc）
- [x] ROADMAP.md 更新
- [x] CHANGELOG.md 更新
- [x] Obsidian 同步（10-开发进度.md）
- [x] 本 prompt 文档（CURSOR_FULL_PROMPT_V0.4.md）

### Quality
- [x] 代码审查通过
- [x] 安全审查通过
- [x] 性能基线合格
- [x] 向后兼容性验证

---

## 问题排除

### 问题：OpenAI API 超时
**解决**：增加超时时间 + 实现 retry 逻辑（见 Phase 2）

### 问题：JSON Schema 验证失败
**解决**：添加 fallback 字段映射 + 错误日志记录

### 问题：Plugin 注册顺序问题
**解决**：使用 registry 中央管理 + 初始化时检查

### 问题：字段池不完整
**解决**：检查 INDUSTRY_FIELD_POOLS 是否覆盖所有 scene

### 问题：骨架 JSON 格式不一致
**解决**：参考 real-estate-skeletons.ts 的格式，保持一致

---

## 持续集成

### Pre-commit Hooks (推荐)
```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run lint && npm run type-check",
      "pre-push": "npm test"
    }
  }
}
```

### CI/CD Pipeline (Render)
```yaml
# render.yaml
build: npm run build
test: npm test -- --coverage
deploy: npm run deploy
```

---

## 参考资源

- **前置版本**：v0.3.0 (CURSOR_TASK_SOCIAL.md)
- **骨架设计**：v0.2.2 (CURSOR_TASK_SKELETON.md)
- **项目结构**：PROJECT.md
- **路线图**：ROADMAP.md
- **进度追踪**：src/data/dev-progress.ts
- **Obsidian 文档**：Second-Brain → 01-Magiclab → Projects → HiBiz

---

## 联系方式

- **项目管理**：见 ROADMAP.md
- **技术问题**：参考本 prompt 的对应 Phase
- **文档同步**：见 Phase 7

---

**祝您编码顺利！🚀**

如有问题，参考本文档相应 Phase 的"验证清单"或"问题排除"部分。

