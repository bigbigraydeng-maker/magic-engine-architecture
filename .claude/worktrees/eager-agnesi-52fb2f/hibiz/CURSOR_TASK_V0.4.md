# HiBiz v0.4 — AI 编译器升级 + 多行业扩展

## 概述

**v0.4 目标**：增强 AI 编译能力（Rule + LLM 混合），扩展至新行业（留学移民），建立行业插件架构。

**版本**：0.4.0
**发布时间**：2026-04 中旬（TBD）
**前置版本**：v0.3.0（已完成 ✅）

---

## 核心目标

### 1. 混合编译器（Hybrid Compiler）

当前（v0.3 及之前）：**Rule-based only**（rule-based.ts，确定性，零成本，但规则难扩展）

v0.4：**Rule Guard → LLM Compiler 混合**（cost-aware，可解析复杂自然语言）

- **Layer 1**：规则守卫（Rule Guard）— 基于正则、关键词预过滤
  - 城市检测（NZ 城市列表）
  - 行业检测（room / real_estate / immigration → enum）
  - 语言检测（en / zh）
  - 垃圾过滤（极短输入、禁用词）
  - **无成本**，快速失败

- **Layer 2**：LLM 编译器（LLM Compiler）— 意图结构化
  - 输入：raw_prompt + rule guard 结果（如 industry hint）
  - 输出：**CompiledIntentV2**（新类型）
  - 使用 OpenAI `gpt-4o-mini` + Structured Output（JSON Schema）
  - 字段：industry, scene, page_type, language, tone, goal 等

### 2. 增强的意图类型（CompiledIntentV2）

```typescript
export interface CompiledIntentV2 {
  id: string;
  // 核心信息
  industry: "real_estate" | "immigration";
  scene: string; // e.g., "property_listing", "visa_consultation"
  language: "en" | "zh" | "both";

  // AI 编译结果
  page_type?: "landing" | "showcase" | "form" | "multi_section";
  tone?: "professional" | "friendly" | "urgent";
  goal?: string; // e.g., "lead_generation", "info_display"

  // 骨架选择（v0.4 新增）
  skeleton_id?: string; // e.g., "classic-agent", "consultant-pro"
  module_selection?: {
    // 模块选择权重/开关
    [moduleKey: string]: {
      enabled: boolean;
      priority?: "high" | "medium" | "low";
    };
  };

  // 字段池（LLM Form Builder 结果）
  form_field_pool?: {
    [fieldId: string]: {
      label: string;
      type: "text" | "email" | "phone" | "select" | "date" | "textarea";
      required: boolean;
      options?: Array<{ value: string; label: string }>;
    };
  };

  // 审计与反馈
  compiler_version: "rule_v1" | "hybrid_v2";
  rule_guard_result?: {
    passed: boolean;
    reasons?: string[];
  };
  user_confirmed?: boolean;
  created_at: string;
  updated_at: string;
}
```

### 3. LLM Form Builder（智能表单字段选择）

- **输入**：industry, scene, goal, 通用字段池
- **输出**：选定的字段列表 + 排序 + 分组建议
- **示例**：
  - 房产场景 → name, email, phone, property_address, budget, timeline
  - 留学场景 → name, email, phone, target_country, degree_level, test_scores

---

## 分阶段实现（Phases）

### Phase 0：类型定义与架构（Foundation）

**文件**：
- `src/types/compiled-intent-v2.ts` — CompiledIntentV2 完整定义
- `src/types/rule-guard.ts` — Rule Guard 结果类型
- `src/types/form-builder.ts` — Form Builder 类型

**任务**：
- [ ] 定义 CompiledIntentV2 接口 + 枚举
- [ ] 定义 RuleGuardResult 类型
- [ ] 定义 FormFieldPool, FormFieldDefinition 等
- [ ] 新增行业枚举：`"immigration"` 到 `Industry` 类型
- [ ] 新增 scene 定义：房产 (property_listing, open_home_event) + 留学 (visa_consultation, school_info)

**验证**：
- ✅ TypeScript 编译无错
- ✅ 所有类型在编译器中可引用

---

### Phase 1：Rule Guard 升级（规则守卫强化）

**现有文件**：`src/lib/compiler/rule-based.ts`
**新文件**：`src/lib/compiler/rule-guard.ts`

**任务**：
- [ ] 提取现有规则成独立 Rule Guard 层
- [ ] 加强城市检测（NZ 全部城市列表）
- [ ] 加强行业检测正则（immigration 行业关键词）
- [ ] 加强语言检测（中文、英文、双语判断）
- [ ] 垃圾过滤（输入 < 5 字符，黑名单词汇）
- [ ] 返回 `RuleGuardResult` 结构（passed, reasons, hints）

**核心函数**：
```typescript
export async function applyRuleGuard(
  rawPrompt: string
): Promise<RuleGuardResult> {
  // 返回 { passed: boolean, industry_hint?, language_hint?, reasons? }
}
```

**验证**：
- ✅ 测试用例覆盖：正常输入、垃圾输入、边界用例
- ✅ 成本为 0（无 API 调用）

---

### Phase 2：LLM 编译器 V2（混合编译）

**新文件**：`src/lib/compiler/llm-compiler-v2.ts`

**任务**：
- [ ] 实现 `compileLLMV2()` 函数
  - 输入：rawPrompt, ruleGuardResult
  - 输出：CompiledIntentV2
- [ ] 使用 OpenAI gpt-4o-mini + JSON Schema
- [ ] Schema 约束输出字段：industry, scene, language, page_type, tone, goal
- [ ] 处理 LLM 输出缺失字段 → 默认值回退
- [ ] 错误处理：LLM 失败 → 返回错误或默认值

**Prompt 设计**：
```
You are an AI intent compiler for a microsite builder.

Given a user prompt and rule guard hints, structure the intent:
- Industry: real_estate | immigration
- Scene: (specific use case)
- Language: en | zh | both
- Page type: landing | showcase | form | multi_section
- Tone: professional | friendly | urgent
- Goal: lead_generation | info_display | booking

Input:
${rawPrompt}

Rule hints: ${JSON.stringify(ruleGuardResult.hints)}

Output JSON:
{ "industry": "...", "scene": "...", ... }
```

**验证**：
- ✅ JSON Schema 有效性测试
- ✅ 成本控制：每次调用 ~0.01 USD
- ✅ 错误重试逻辑（max 2 retries）

---

### Phase 3：LLM Form Builder（表单字段智能选择）

**新文件**：`src/lib/generation/llm-form-builder.ts`

**任务**：
- [ ] 定义通用字段池（20+ 常用字段）
  ```typescript
  const UNIVERSAL_FIELD_POOL = {
    name: { label: "Name", type: "text", ... },
    email: { label: "Email", type: "email", ... },
    phone: { label: "Phone", type: "phone", ... },
    // ... 更多字段
  };
  ```
- [ ] 行业特定字段池
  - 房产：property_address, bedrooms, budget, timeline
  - 留学：target_country, degree_level, test_scores, availability
- [ ] 实现 `buildFormFieldPool()` 函数
  - 输入：industry, scene, goal
  - 输出：选定字段列表 + 优先级排序
- [ ] 使用 LLM 智能选择（或规则表驱动）

**验证**：
- ✅ 单行业/场景的字段选择正确性
- ✅ 字段排序合理（常用字段优先）

---

### Phase 4：多行业扩展 — 留学移民骨架

**新文件**：
- `src/data/skeletons/immigration-skeletons.ts` — 2-3 套留学移民骨架
- `src/types/immigration-profile.ts` — 留学移民商家资料扩展

**骨架设计**（参考房产 3 套）：
1. **Consultant Pro** — 专业顾问形象
   - 模块：hero, about (consultant bio), services, faq, testimonials, contact
   - 推荐字段：名字、专长、资质、微信、LinkedIn

2. **School Guide** — 学校/项目展示
   - 模块：hero, school_info, programs, testimonials, timeline, cta
   - 推荐字段：学校名、地址、课程、报名截止

3. **Immigration Hub** — 移民服务中心
   - 模块：hero, services_grid, process_timeline, faq, news/blog, contact
   - 推荐字段：服务类型、处理时间、成功案例数

**任务**：
- [ ] 定义留学移民骨架 JSON（格式与房产骨架一致）
- [ ] 定义 MerchantProfileV2（扩展版本）
  - 新增字段：qualifications, specialization, target_countries
- [ ] 分步创建流程支持选择行业（房产 / 留学移民）
- [ ] AI 文案生成适配新行业（LLM prompt 调整）

**验证**：
- ✅ 骨架 JSON 有效性
- ✅ 模块类型在 RenderModuleType 枚举内

---

### Phase 5：行业插件架构（Plugin Architecture）

**目标**：未来支持第 3、4... N 个行业时，新增行业 = 新骨架 + 新字段池 + 新合规规则

**设计**：
```typescript
// src/lib/plugins/industry-plugin.ts
export interface IndustryPlugin {
  industryId: "real_estate" | "immigration" | string;
  name: string;
  scenes: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  skeletons: TemplateSkeleton[];
  fieldPool: FormFieldDefinition[];
  compilationRules?: {
    // 行业特定的编译规则
    // e.g., 移民需要合规检查
  };
  aiPromptTemplate?: string;
  complianceFilter?: (intent: CompiledIntentV2) => ComplianceCheckResult;
}

// src/lib/plugins/registry.ts
export const INDUSTRY_PLUGINS: Record<string, IndustryPlugin> = {
  real_estate: realEstatePlugin,
  immigration: immigrationPlugin,
  // 未来：restaurant, consulting, ...
};

export function getPlugin(industryId: string): IndustryPlugin {
  return INDUSTRY_PLUGINS[industryId] || throwNotFound();
}
```

**任务**：
- [ ] 定义 IndustryPlugin 接口
- [ ] 建立房产 plugin 实例（重构现有数据）
- [ ] 建立留学 plugin 实例（新增）
- [ ] Plugin registry & loader
- [ ] 在编译器/生成器中使用 plugin 替代硬编码

**验证**：
- ✅ Plugin 注册与加载正常
- ✅ 房产 plugin 功能与 v0.3 对等

---

### Phase 6：Server Actions 与集成

**修改文件**：
- `src/app/app/projects/generation-actions.ts` — 更新生成流程
- `src/app/app/projects/[id]/page.tsx` — UI 适配 v0.4 编译器

**任务**：
- [ ] 更新 `generateDraftFromIntent()` 支持 CompiledIntentV2
- [ ] 在用户确认前显示编译结果（industry, scene, page_type 等）
- [ ] 调用 LLM Form Builder 获取表单字段推荐
- [ ] 根据选定的骨架（来自 plugin）进行装配

**流程（Updated）**：
```
用户输入 → Rule Guard → LLM Compiler V2 → CompiledIntentV2
  ↓
用户确认意图
  ↓
LLM Form Builder → 字段推荐
  ↓
LLM Copy Generator + 骨架装配（来自 plugin）
  ↓
RenderModelV1 → 草稿预览 → 发布
```

**验证**：
- ✅ 房产流程与 v0.3 对等
- ✅ 留学新行业完整流程可用

---

### Phase 7：测试与文档

**数据库迁移**（如需）：
```sql
-- 如果需要存储 CompiledIntentV2（目前可选）
-- ALTER TABLE intents ADD COLUMN compiled_intent_v2 JSONB;
```

**单元测试**：
- [ ] `rule-guard.test.ts` — 规则守卫逻辑
- [ ] `llm-compiler-v2.test.ts` — LLM 编译（mock OpenAI）
- [ ] `form-builder.test.ts` — 表单字段选择
- [ ] `industry-plugin.test.ts` — plugin 注册与加载

**集成测试**：
- [ ] 房产端到端流程（rule guard → llm compile → form builder → render）
- [ ] 留学端到端流程

**文档更新**：
- [ ] ROADMAP.md — 标记 v0.4 完成
- [ ] CHANGELOG.md — v0.4.0 release notes
- [ ] 10-开发进度.md (Obsidian) — 更新进度条

---

## 数据库

### 表结构（现有基础）

无需新增表。可选扩展：

```sql
-- 可选：存储编译历史（用于调试/监控）
CREATE TABLE intent_compilations (
  id UUID PRIMARY KEY,
  intent_id UUID REFERENCES intents(id),
  compiler_version TEXT,
  rule_guard_result JSONB,
  compiled_intent_v2 JSONB,
  cost_cents NUMERIC,
  created_at TIMESTAMP
);
```

### RLS 策略

无需新增（继承现有）。

---

## 关键文件清单

| 文件 | 类型 | 用途 |
|------|------|------|
| `src/types/compiled-intent-v2.ts` | 新增 | CompiledIntentV2 定义 |
| `src/types/rule-guard.ts` | 新增 | Rule Guard 类型 |
| `src/types/form-builder.ts` | 新增 | Form Builder 类型 |
| `src/lib/compiler/rule-guard.ts` | 新增 | Rule Guard 层 |
| `src/lib/compiler/llm-compiler-v2.ts` | 新增 | LLM 编译器 V2 |
| `src/lib/generation/llm-form-builder.ts` | 新增 | LLM 表单生成器 |
| `src/lib/plugins/industry-plugin.ts` | 新增 | 行业插件接口 |
| `src/lib/plugins/registry.ts` | 新增 | 插件注册表 |
| `src/data/skeletons/immigration-skeletons.ts` | 新增 | 留学移民骨架 |
| `src/types/immigration-profile.ts` | 新增 | 留学移民资料 |
| `src/app/app/projects/generation-actions.ts` | 修改 | Server Actions 集成 |
| `src/app/app/projects/[id]/page.tsx` | 修改 | UI 流程更新 |
| `ROADMAP.md` | 修改 | 更新进度 |
| `CHANGELOG.md` | 修改 | 新增 v0.4.0 entry |

---

## 开发检查清单

- [ ] Phase 0：类型定义完整 + TS 编译通过
- [ ] Phase 1：Rule Guard 单元测试通过（>80% 覆盖）
- [ ] Phase 2：LLM 编译器可调用 + 错误处理完整
- [ ] Phase 3：Form Builder 逻辑正确 + 字段池完整
- [ ] Phase 4：2-3 套留学骨架定义完整 + JSON 有效
- [ ] Phase 5：Plugin 架构可扩展 + 房产/留学两个 plugin 注册
- [ ] Phase 6：Server Actions 集成 + UI 流程测试通过
- [ ] Phase 7：单元 + 集成测试覆盖 >80%
- [ ] 文档同步（ROADMAP, CHANGELOG, Obsidian）
- [ ] 代码审查通过（linting, security check）
- [ ] 本地测试通过（端到端房产/留学流程）

---

## 定义清单（确保一致性）

### Industry 枚举
```typescript
export type Industry = "real_estate" | "immigration";
```

### Scene 定义
```typescript
// 房产
type RealEstateSceene = "property_listing" | "open_home_event" | "market_update";

// 留学
type ImmigrationScene = "visa_consultation" | "school_info" | "program_enrollment";

export type Scene = RealEstateScene | ImmigrationScene;
```

### PageType 枚举
```typescript
export type PageType = "landing" | "showcase" | "form" | "multi_section";
```

### Tone 枚举
```typescript
export type Tone = "professional" | "friendly" | "urgent";
```

---

## 禁止事项

- ❌ 不得在 LLM 输出中直接渲染（必须通过 Schema 校验）
- ❌ 不得使用不在枚举中的 industry/scene/page_type 值
- ❌ 不得硬编码行业逻辑（必须使用 plugin 架构）
- ❌ 不得在表单生成中引入未授权的字段（必须在字段池内）
- ❌ 不得跳过 Rule Guard（所有输入必须先过 Rule Guard）

---

## 交付成果

### Code
- ✅ 所有代码文件已完成
- ✅ TypeScript 编译通过，无错误
- ✅ ESLint 通过
- ✅ 单元测试 >80% 覆盖
- ✅ 集成测试端到端通过

### Documentation
- ✅ 代码注释完整
- ✅ ROADMAP.md 标记 v0.4 完成
- ✅ CHANGELOG.md 新增 v0.4.0 entry
- ✅ Obsidian 同步（10-开发进度.md）

### Testing
- ✅ 房产行业：rule guard → llm compile → form builder → render 完整流程验证
- ✅ 留学行业：同上流程验证
- ✅ 错误场景：垃圾输入、API 失败、字段缺失

---

## 参考

- **前置版本**：v0.3.0 (CURSOR_TASK_SOCIAL.md)
- **骨架设计**：v0.2.2 (CURSOR_TASK_SKELETON.md)
- **路线图**：ROADMAP.md
- **当前进度**：src/data/dev-progress.ts
- **Obsidian 文档**：01-Magiclab/Projects/HiBiz/10-开发进度.md
