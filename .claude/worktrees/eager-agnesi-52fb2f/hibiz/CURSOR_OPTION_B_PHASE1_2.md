# HiBiz Option B: 模块开关系统 — Phase 1 & 2 实现

## 🎯 目标

从 **Scene 单选** 改为 **Module 多选**，用户在 Compile 面板选择开启哪些网站模块，系统根据选中模块推荐表单字段。

---

## 📋 Phase 1：类型定义 & 规则映射

### Task 1.1：更新 src/types/compiled-intent-v2.ts

**位置**：在现有 SceneV2 定义下方添加以下内容

```typescript
// ═══ 新增：模块选择系统 ═══

// 可选择的模块类型（可以启用/禁用）
export type SelectableModuleType =
  | "offer"
  | "faq"
  | "about"
  | "contact"
  | "listings"
  | "testimonials"
  | "openHome"
  | "services";

// 强制启用的模块类型（不可关闭）
export type AlwaysEnabledModuleType = "hero" | "footer" | "form";

// 完整的模块类型并集
export type ModuleTypeV2 = SelectableModuleType | AlwaysEnabledModuleType;

// 每个场景的模块推荐配置
export const MODULE_DEFAULTS_BY_SCENE: Record<
  SceneV2,
  {
    always_enabled: AlwaysEnabledModuleType[];
    recommended_enabled: SelectableModuleType[];
    optional_modules: SelectableModuleType[];
  }
> = {
  // ─ 房地产场景 ─
  property_listing: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["testimonials", "openHome", "services", "listings"],
  },
  open_home_event: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["openHome", "contact"],
    optional_modules: ["offer", "faq", "testimonials", "services", "listings"],
  },
  market_update: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["testimonials", "openHome", "services", "listings"],
  },
  // ─ 移民教育场景 ─
  visa_consultation: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact"],
    optional_modules: ["faq", "testimonials", "openHome", "services", "listings"],
  },
  school_info: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["testimonials", "openHome", "services", "listings"],
  },
  program_enrollment: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact"],
    optional_modules: ["faq", "testimonials", "openHome", "services", "listings"],
  },
};

// 迁移辅助函数：从 scene 转换为模块列表
export function getDefaultModulesForScene(scene: SceneV2): ModuleTypeV2[] {
  const defaults = MODULE_DEFAULTS_BY_SCENE[scene];
  return [...defaults.always_enabled, ...defaults.recommended_enabled];
}

// 获取指定场景的所有可选模块
export function getAllSelectableModulesForScene(scene: SceneV2): SelectableModuleType[] {
  const defaults = MODULE_DEFAULTS_BY_SCENE[scene];
  return [...defaults.recommended_enabled, ...defaults.optional_modules];
}
```

**验证**：
- 检查所有 SceneV2 类型都在 MODULE_DEFAULTS_BY_SCENE 中有定义
- 确保 always_enabled 始终包含 ["hero", "form", "footer"]

---

### Task 1.2：更新 src/types/form-builder.ts

**位置**：在现有 FORM_FIELD_RULES 定义下方添加

```typescript
// ═══ 新增：模块到表单字段的规则映射 ═══

import type { SelectableModuleType } from "./compiled-intent-v2";

// 模块 → 表单字段需求的规则表
export const FORM_FIELD_RULES_BY_MODULE: Record<
  SelectableModuleType,
  {
    real_estate?: readonly string[];
    immigration?: readonly string[];
  }
> = {
  offer: {
    real_estate: [],
    immigration: [],
  },
  faq: {
    real_estate: [],
    immigration: [],
  },
  about: {
    real_estate: [],
    immigration: [],
  },
  contact: {
    real_estate: [],
    immigration: [],
  },
  listings: {
    real_estate: ["property_address", "property_type", "bedrooms", "budget"],
    immigration: [],
  },
  testimonials: {
    real_estate: [],
    immigration: [],
  },
  openHome: {
    real_estate: ["inspection_date"],
    immigration: [],
  },
  services: {
    real_estate: [],
    immigration: [],
  },
};

// 必需字段（所有场景必须）
export const MANDATORY_FORM_FIELDS: Record<IndustryV2, readonly string[]> = {
  real_estate: ["name", "email", "phone"],
  immigration: ["name", "email", "phone"],
};

// 新函数：基于模块列表推荐表单字段
export function buildFormFieldsFromModules(
  industry: IndustryV2,
  selectedModules: (import("./compiled-intent-v2").ModuleTypeV2)[]
): FormBuilderResultV2 {
  const fieldPool = getFieldPoolForIndustry(industry);
  const selectedFieldIds = new Set(MANDATORY_FORM_FIELDS[industry]);

  // 根据选中的模块添加推荐字段
  selectedModules.forEach((mod) => {
    // hero / form / footer 不需要额外字段
    if (mod === "hero" || mod === "form" || mod === "footer") {
      return;
    }

    const moduleFields = FORM_FIELD_RULES_BY_MODULE[mod as SelectableModuleType];
    if (!moduleFields) {
      return;
    }

    const industryFields = moduleFields[industry] ?? [];
    industryFields.forEach((fieldId) => {
      selectedFieldIds.add(fieldId);
    });
  });

  // 构建选中的字段对象
  const selected_fields = Array.from(selectedFieldIds)
    .map((id) => fieldPool[id])
    .filter((f): f is FormFieldDefinitionV2 => f != null);

  // 分组表单字段
  const groups = groupFormFieldsByCategory(Array.from(selectedFieldIds), industry);

  return {
    selected_fields,
    field_order: Array.from(selectedFieldIds),
    groups,
    confidence: 85,
    reasoning: `Based on ${selectedModules.length} selected modules for ${industry}.`,
  };
}

// 辅助函数：根据类别对表单字段分组
function groupFormFieldsByCategory(
  fieldIds: string[],
  industry: IndustryV2
): Array<{ name: string; fields: string[] }> {
  const contactFields = ["name", "email", "phone", "message"];
  const propertyFields = ["property_address", "property_type", "bedrooms", "inspection_date", "budget"];
  const visaFields = ["visa_type", "current_location", "education_level", "work_experience", "english_proficiency"];

  const groups: Array<{ name: string; fields: string[] }> = [];

  const contactGroup = fieldIds.filter((id) => contactFields.includes(id));
  if (contactGroup.length > 0) {
    groups.push({ name: "Contact Information", fields: contactGroup });
  }

  const propertyGroup = fieldIds.filter((id) => propertyFields.includes(id));
  if (propertyGroup.length > 0) {
    groups.push({ name: "Property Details", fields: propertyGroup });
  }

  const visaGroup = fieldIds.filter((id) => visaFields.includes(id));
  if (visaGroup.length > 0) {
    groups.push({ name: "Visa & Background", fields: visaGroup });
  }

  const otherGroup = fieldIds.filter(
    (id) =>
      !contactFields.includes(id) &&
      !propertyFields.includes(id) &&
      !visaFields.includes(id)
  );
  if (otherGroup.length > 0) {
    groups.push({ name: "Additional Information", fields: otherGroup });
  }

  return groups;
}

// 保留现有函数兼容性
export function buildFormFieldsFromRules(
  industry: IndustryV2,
  scene: SceneV2
): FormBuilderResultV2 {
  // 转换：从 scene 推导默认模块列表
  const { getDefaultModulesForScene } = require("./compiled-intent-v2");
  const modules = getDefaultModulesForScene(scene);
  return buildFormFieldsFromModules(industry, modules);
}
```

**验证**：
- 确保所有 SelectableModuleType 都在 FORM_FIELD_RULES_BY_MODULE 中有条目
- MANDATORY_FORM_FIELDS 包含所有 IndustryV2

---

## 📋 Phase 2：编译逻辑更新

### Task 2.1：更新 src/app/app/projects/compile-intent-v2-action.ts

**修改 1**：在 `compileIntentV2Action()` 函数中初始化 module_selection

查找此行：
```typescript
const formFields = buildFormFieldsFromRules(withProject.industry, withProject.scene);
```

替换为：
```typescript
// 初始化 module_selection（从 scene 默认推荐）
if (!withProject.module_selection) {
  const { getDefaultModulesForScene } = require("@/types/compiled-intent-v2");
  const defaultModules = getDefaultModulesForScene(withProject.scene);
  withProject.module_selection = {};

  // 填充 module_selection 对象
  defaultModules.forEach((mod) => {
    if (mod !== "hero" && mod !== "form" && mod !== "footer") {
      withProject.module_selection![mod as import("@/types/compiled-intent-v2").SelectableModuleType] = {
        enabled: true,
      };
    }
  });
}

const { buildFormFieldsFromModules } = require("@/lib/generation/llm-form-builder");
const formFields = buildFormFieldsFromModules(withProject.industry, defaultModules);
```

**修改 2**：在 `confirmIntentV2Action()` 中保存 module_selection

查找此行：
```typescript
const { revisions: priorRevisions, currentVersion } = collectPriorRevisionsForConfirm(row?.compiled_intent_v2);
```

在下方添加：
```typescript
// 确保 module_selection 被正确保存
if (!merged.module_selection) {
  const { getDefaultModulesForScene } = require("@/types/compiled-intent-v2");
  const defaultModules = getDefaultModulesForScene(merged.scene);
  merged.module_selection = {};

  defaultModules.forEach((mod) => {
    if (mod !== "hero" && mod !== "form" && mod !== "footer") {
      merged.module_selection![mod as import("@/types/compiled-intent-v2").SelectableModuleType] = {
        enabled: true,
      };
    }
  });
}
```

**验证**：
- 构建应通过（npm run build）
- 编译意图时 module_selection 应正确初始化

---

## ✅ Phase 1-2 完成标志

- [ ] src/types/compiled-intent-v2.ts：MODULE_DEFAULTS_BY_SCENE 和辅助函数添加
- [ ] src/types/form-builder.ts：FORM_FIELD_RULES_BY_MODULE 和 buildFormFieldsFromModules() 添加
- [ ] src/app/app/projects/compile-intent-v2-action.ts：模块初始化逻辑添加
- [ ] npm run build 通过
- [ ] npm test 通过（16/16）

---

## 📝 注意事项

1. **Import 路径**：确保所有 import 使用 `@/` 别名
2. **类型安全**：使用类型断言时添加 `as` 关键字，避免 TypeScript 错误
3. **向后兼容**：保留 buildFormFieldsFromRules()，内部转换为 modules 方式
4. **数据库**：CompiledIntentV2 是 JSONB，module_selection 会自动序列化

---

## 🚀 完成后

Phase 1-2 完成后，我将：
1. 用 code-reviewer 审查代码
2. 确认构建 + 测试通过
3. 为 Phase 3（UI 改造）生成提示文档

**预计完成时间**：2-3 小时

