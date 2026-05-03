# HiBiz Option B: 模块开关系统 — Phase 3 实现（UI 改造）

**前置条件**：Phase 1-2 已完成（类型定义 + 编译逻辑），所有测试通过，已 git push。

---

## 🎯 Phase 3 目标

从 **Compile 面板的 Scene 单选** 改为 **Module 多选复选框**

当前 UI：
```
Industry → Scene (单选下拉) → 表单字段预览
```

目标 UI：
```
Industry → Module 多选 (复选框分组) → 表单字段预览
```

---

## 📋 Task 3.1：更新 src/components/project-compile-v2-card.tsx

### 步骤 1：移除 Scene 相关状态和 UI

**查找并移除**：
- 第 86 行：`const [pendingScene, setPendingScene] = useState<SceneV2 | null>(null);`
- 第 25-43 行：删除 REAL_SCENES、IMM_SCENES、scenesForIndustry()、defaultSceneForIndustry() 的所有定义
- 第 370-386 行：删除 Scene 单选下拉框 HTML（`<select id="hibiz-pending-scene">` 及其全部内容）
- 第 91-96 行：更新 previewFields useMemo（见步骤 4）
- 第 249-253 行：更新 onIndustryChange 函数（见步骤 3）
- 第 162-166 行：更新 cancelEdit 函数以重置 selectedModules（见步骤 2）
- 所有相关的 pendingScene 依赖项和引用（在 handleConfirm、useEffect 等处）

### 步骤 2：添加 Module 多选状态

在 `pendingIndustry` 状态声明之后添加：

```typescript
const [selectedModules, setSelectedModules] = useState<ModuleTypeV2[]>([]);
```

在 `editMode` 改变时同时重置 selectedModules，并在打开编辑模式时从保存的意图中初始化：

```typescript
// 在切换 editMode 或打开编辑模式时初始化 selectedModules
useEffect(() => {
  if (!editMode) {
    // 关闭编辑模式时清空临时选择
    setPendingIndustry(null);
    setSelectedModules([]);
  } else if (editMode && displayIntent) {
    // 打开编辑模式时从保存的 intent 初始化模块列表
    const savedModules = displayIntent.module_selection
      ? resolveActiveModulesForForm(displayIntent.scene, displayIntent.module_selection)
      : getDefaultModulesForScene(displayIntent.scene);
    setSelectedModules(savedModules);
  }
}, [editMode, displayIntent]);
```

**更新 cancelEdit 函数**（保留现有逻辑，selectModules 会由上面 useEffect 自动重置）：

```typescript
const cancelEdit = () => {
  setEditMode(false);
  // selectedModules 和 pendingIndustry 会通过 useEffect 自动重置
};
```

导入 `resolveActiveModulesForForm` 和 `getDefaultModulesForScene`：

```typescript
import {
  resolveActiveModulesForForm,
  getDefaultModulesForScene,
  // ... 其他现有导入
} from "@/types/compiled-intent-v2";
```

### 步骤 3：在 UI 中添加 Module 多选组件

在 `onIndustryChange` 之后更新以支持模块重置：

```typescript
const onIndustryChange = (value: IndustryV2) => {
  setPendingIndustry(value);
  // 切换 industry 时重置 selectedModules 为该行业的默认推荐
  const dummyScene = value === "real_estate" ? "property_listing" : "visa_consultation";
  setSelectedModules(getDefaultModulesForScene(dummyScene));
};
```

在 Industry 单选之后、表单字段预览之前，添加模块选择器：

**Module 多选 UI**：

```typescript
{editMode && pendingIndustry ? (
  <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
    <p className="mb-3 text-sm font-semibold text-stone-900">Module Selection</p>

    {/* Always Enabled (disabled) */}
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-stone-600 uppercase">Always Enabled (Cannot disable)</p>
      <div className="space-y-2">
        {["hero", "form", "footer"].map((mod) => (
          <label key={mod} className="flex items-center gap-2 cursor-not-allowed opacity-60">
            <input type="checkbox" checked disabled className="rounded" />
            <span className="text-sm text-stone-700 capitalize">{mod}</span>
          </label>
        ))}
      </div>
    </div>

    {/* Recommended Modules */}
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-stone-600 uppercase">Recommended</p>
      <div className="space-y-2">
        {(getSelectableModulesForIndustry(pendingIndustry) || []).map((mod) => (
          <label key={mod} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedModules.includes(mod)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedModules([...selectedModules, mod]);
                } else {
                  setSelectedModules(selectedModules.filter((m) => m !== mod));
                }
              }}
              className="rounded border-stone-300"
            />
            <span className="text-sm text-stone-700 capitalize">{mod}</span>
          </label>
        ))}
      </div>
    </div>
  </div>
) : null}
```

### 步骤 4：更新表单字段预览逻辑

**查找此行**：
```typescript
const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  return null;
}, [editMode, pendingIndustry, pendingScene]);
```

**替換為**：
```typescript
const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && selectedModules.length > 0) {
    // 保留原意图的 scene（用于 offer 字段和置信度），若无则用 dummy
    const sceneForForm = displayIntent?.scene ?? (pendingIndustry === "real_estate"
      ? "property_listing"
      : "visa_consultation");
    return buildFormFieldsFromModules(pendingIndustry, selectedModules, sceneForForm);
  }
  return null;
}, [editMode, pendingIndustry, selectedModules, displayIntent]);
```

**更新 pendingDirty 计算**（移除 pendingScene 条件）：

查找此行：
```typescript
const pendingDirty =
  editMode &&
  pendingIndustry &&
  pendingScene &&
  displayIntent &&
  (pendingIndustry !== displayIntent.industry || pendingScene !== displayIntent.scene);
```

**替換為**：
```typescript
const pendingDirty =
  editMode &&
  pendingIndustry &&
  selectedModules.length > 0 &&
  displayIntent &&
  (pendingIndustry !== displayIntent.industry ||
   JSON.stringify(selectedModules.sort()) !== JSON.stringify(
     resolveActiveModulesForForm(displayIntent.scene, displayIntent.module_selection).sort()
   ));
```

**更新 handleConfirm 函数**（确保 scene 不会被更改）：

查找此行：
```typescript
const sc = pendingScene ?? base.scene;
```

**替換為**（始终保留原 scene，不允许在 Phase 3 编辑）：
```typescript
const sc = base.scene;  // Scene 在 Phase 3 中保持不变，用户只编辑 industry 和 modules
```

**更新 handleCompile 和 openEdit 函数**（移除 setPendingScene 调用）：

在 `handleCompile()` 中，找到：
```typescript
setPendingIndustry(res.intent.industry);
setPendingScene(res.intent.scene);
```

改为：
```typescript
setPendingIndustry(res.intent.industry);
// 不再设置 pendingScene；selectedModules 由 useEffect 自动初始化
```

在 `openEdit()` 中，找到：
```typescript
setPendingIndustry(displayIntent.industry);
setPendingScene(displayIntent.scene);
```

改为：
```typescript
setPendingIndustry(displayIntent.industry);
// 不再设置 pendingScene；selectedModules 由 useEffect 自动初始化
```

### 步骤 0：更新文件顶部导入

**删除以下导入**：
```typescript
import type {
  // ... 删除这些，保留 IndustryV2, ModuleTypeV2, CompiledIntentV2 等核心类型
  ImmigrationSceneV2,
  RealEstateSceneV2,
  SceneV2,  // ← 删除此行
};
```

**添加以下导入**：
```typescript
import { buildFormFieldsFromModules } from "@/lib/generation/llm-form-builder";
import {
  resolveActiveModulesForForm,
  getDefaultModulesForScene,
  type ModuleTypeV2,
  type SelectableModuleType,
} from "@/types/compiled-intent-v2";
```

---

### 步骤 5：添加辅助函数（在组件外或文件底部）

```typescript
function getSelectableModulesForIndustry(industry: IndustryV2): SelectableModuleType[] {
  // 返回该 industry 的所有可选模块（不包括 hero/form/footer 强制模块）
  if (industry === "real_estate") {
    return ["offer", "faq", "about", "contact", "listings", "testimonials", "openHome", "services"];
  }
  if (industry === "immigration") {
    return ["offer", "faq", "about", "contact", "testimonials", "services"];
  }
  return [];
}
```

---

## 📋 Task 3.2：如果需要，创建独立的 Module 选择器组件（可选）

**可选创建**：`src/components/module-selector.tsx`

```typescript
"use client";

import type { IndustryV2, ModuleTypeV2, SelectableModuleType } from "@/types/compiled-intent-v2";

interface ModuleSelectorProps {
  industry: IndustryV2;
  selectedModules: ModuleTypeV2[];
  onChange: (modules: ModuleTypeV2[]) => void;
}

export function ModuleSelector({
  industry,
  selectedModules,
  onChange,
}: ModuleSelectorProps) {
  const selectableModules = getSelectableModulesForIndustry(industry);
  const alwaysEnabled: ModuleTypeV2[] = ["hero", "form", "footer"];

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <p className="mb-3 text-sm font-semibold text-stone-900">Select Modules</p>

      {/* Always Enabled Group */}
      <div className="mb-4">
        <p className="mb-2 text-xs font-medium text-stone-600 uppercase">Always Enabled</p>
        <div className="space-y-2">
          {alwaysEnabled.map((mod) => (
            <label key={mod} className="flex items-center gap-2 cursor-not-allowed opacity-60">
              <input type="checkbox" checked disabled className="rounded" />
              <span className="text-sm text-stone-700 capitalize">{mod}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Selectable Modules */}
      <div>
        <p className="mb-2 text-xs font-medium text-stone-600 uppercase">Optional</p>
        <div className="space-y-2">
          {selectableModules.map((mod) => (
            <label key={mod} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedModules.includes(mod)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange([...selectedModules, mod]);
                  } else {
                    onChange(selectedModules.filter((m) => m !== mod));
                  }
                }}
                className="rounded border-stone-300"
              />
              <span className="text-sm text-stone-700 capitalize">{mod}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function getSelectableModulesForIndustry(industry: IndustryV2): SelectableModuleType[] {
  if (industry === "real_estate") {
    return ["offer", "faq", "about", "contact", "listings", "testimonials", "openHome", "services"];
  }
  if (industry === "immigration") {
    return ["offer", "faq", "about", "contact", "testimonials", "services"];
  }
  return [];
}
```

如果创建了独立组件，则在 `project-compile-v2-card.tsx` 中改为：

```typescript
{editMode && pendingIndustry ? (
  <ModuleSelector
    industry={pendingIndustry}
    selectedModules={selectedModules}
    onChange={setSelectedModules}
  />
) : null}
```

---

## ✅ Phase 3 完成标志

- [ ] 删除 REAL_SCENES, IMM_SCENES, scenesForIndustry(), defaultSceneForIndustry() 常量和函数
- [ ] 删除 pendingScene 状态声明（第 86 行）
- [ ] 添加 selectedModules 状态声明和初始化 useEffect
- [ ] 更新 onIndustryChange 函数以重置 selectedModules
- [ ] 删除 Scene 单选下拉框 HTML
- [ ] 添加 Module 多选复选框 UI（Always Enabled / Optional 两组）
- [ ] 更新 previewFields useMemo 使用 buildFormFieldsFromModules
- [ ] 更新 pendingDirty 计算逻辑
- [ ] 更新 handleCompile、openEdit、handleConfirm 移除 pendingScene 相关操作
- [ ] 添加 getSelectableModulesForIndustry() 辅助函数
- [ ] 更新文件顶部导入（移除 SceneV2、ImmigrationSceneV2、RealEstateSceneV2；添加新导入）
- [ ] npm run build 通过
- [ ] npm test 通过（16/16）
- [ ] 在浏览器中测试：
  - [ ] 编辑已保存的 intent → selectedModules 正确从 module_selection 恢复
  - [ ] 切换 Industry → selectedModules 重置为新行业的默认推荐
  - [ ] 切换模块复选框 → 表单字段预览实时更新
  - [ ] 点「确认并保存」→ module_selection 正确保存到数据库
  - [ ] 表单字段分组正确（Contact / Property / Additional）

---

## 💡 设计注意事项

1. **Industry 依赖**：Module 列表随 industry 变化，需要 `getSelectableModulesForIndustry()`
2. **Always Enabled 常量**：["hero", "form", "footer"] 应被禁用且始终勾选
3. **初始化**：首次 editMode 切换时，selectedModules 应初始化为推荐模块（不包括 always_enabled）
4. **样式**：复选框分两组展示，always_enabled 组灰显（disabled 样式）

---

## 🚀 完成后

Phase 3 完成后，进入 Phase 4（装配逻辑）和 Phase 5（测试）

