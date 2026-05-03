# HiBiz Phase 4 — Assembly Logic（骨架裝配邏輯）實現指南

**前置條件**：Phase 1-3 已完成，線上驗證通過。

**目標**：更新 Skeleton 裝配邏輯，優先讀取編譯意圖中的 `module_selection`（用戶選中的模組），而非場景預設模組。

---

## 📋 Task 4.1：修改 `resolveActiveSkeletonModuleEntries()`

**文件**：`src/lib/generation/assemble-skeleton.ts` 第 11-31 行

### 步驟 1：擴展函數簽名，添加 `compiledIntent` 參數

**查找此函數**：
```typescript
export function resolveActiveSkeletonModuleEntries(
  skeleton: TemplateSkeleton,
  profile: MerchantProfileV1,
): { mod: TemplateSkeleton["modules"][number]; index: number }[] {
```

**替換為**：
```typescript
export function resolveActiveSkeletonModuleEntries(
  skeleton: TemplateSkeleton,
  profile: MerchantProfileV1,
  compiledIntent?: CompiledIntentV2,
): { mod: TemplateSkeleton["modules"][number]; index: number }[] {
```

### 步驟 2：新增導入

**在文件頂部（第 1-9 行）添加**：
```typescript
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { resolveActiveModulesForForm } from "@/types/compiled-intent-v2";
```

### 步驟 3：實現新邏輯

**替換整個函數體（第 15-31 行）為**：
```typescript
  // 優先：使用編譯意圖中的 module_selection（新 Option B 系統）
  if (compiledIntent?.module_selection) {
    const activeModules = resolveActiveModulesForForm(
      compiledIntent.scene,
      compiledIntent.module_selection
    );
    const activeModuleSet = new Set(activeModules);

    return skeleton.modules
      .map((mod, index) => ({ mod, index }))
      .filter(({ mod }) => {
        // 模組名稱從骨架 mod.type 映射到 ModuleTypeV2
        // 例：skeleton 中 "offer" 對應 ModuleTypeV2 中的 "offer"
        const moduleName = mod.type as string;
        return activeModuleSet.has(moduleName);
      });
  }

  // 回退：使用舊邏輯（兼容場景預設 + module_visibility 覆蓋）
  return skeleton.modules
    .map((mod, index) => ({ mod, index }))
    .filter(({ mod, index }) => {
      if (mod.type === "hero" || mod.type === "footer") {
        return true;
      }
      const key = skeletonModuleVisibilityKey(skeleton.id, index);
      const v = profile.module_visibility?.[key];
      if (v === false) {
        return false;
      }
      if (v === true) {
        return true;
      }
      return mod.visible;
    });
}
```

---

## 📋 Task 4.2：修改 `assembleRenderModelFromSkeleton()`

**文件**：`src/lib/generation/assemble-skeleton.ts` 第 70-102 行

### 步驟 1：擴展函數簽名

**查找此函數**：
```typescript
export function assembleRenderModelFromSkeleton(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  copy?: GeneratedCopyV1;
  formId: string;
  publicSlug: string;
  projectName: string;
}): RenderModelV1 {
```

**替換為**：
```typescript
export function assembleRenderModelFromSkeleton(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  copy?: GeneratedCopyV1;
  compiledIntent?: CompiledIntentV2;
  formId: string;
  publicSlug: string;
  projectName: string;
}): RenderModelV1 {
```

### 步驟 2：傳遞 compiledIntent 給 resolveActiveSkeletonModuleEntries()

**查找此行（第 79 行）**：
```typescript
  const activeModuleEntries = resolveActiveSkeletonModuleEntries(skeleton, profile);
```

**替換為**：
```typescript
  const { compiledIntent } = input;
  const activeModuleEntries = resolveActiveSkeletonModuleEntries(
    skeleton,
    profile,
    compiledIntent
  );
```

---

## 📋 Task 4.3：修改調用地點 — `skeleton-edit-actions.ts`

**文件**：`src/app/app/projects/skeleton-edit-actions.ts`

### 步驟 1：導入 CompiledIntentV2 和相關函數

**在文件頂部（第 1-11 行）添加**：
```typescript
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { parseCompiledIntentV2 } from "@/types/compiled-intent-v2";
```

### 步驟 2：修改 `reapplySkeletonDraft()` 函數

**查找此函數的開始（約第 17 行）**。函數需要在調用 `assembleRenderModelFromSkeleton()` 前，先查詢 `compiledIntent`。

**在第 42-43 行之後（取得 project 之後），添加查詢 compiledIntent**：

```typescript
  // 查詢最新的 CompiledIntentV2（如果存在）
  const { data: compiledIntentRaw } = await supabase
    .from("projects")
    .select("compiled_intent_v2")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  const compiledIntent = compiledIntentRaw?.compiled_intent_v2
    ? parseCompiledIntentV2(compiledIntentRaw.compiled_intent_v2)
    : undefined;
```

**修改第 52-58 行的調用**：
```typescript
  const nextModel = assembleRenderModelFromSkeleton({
    skeleton,
    profile,
    compiledIntent,  // ← 新增此行
    formId: formRow.id,
    publicSlug: formRow.public_slug,
    projectName: proj.name,
  });
```

### 步驟 3：修改 `updateSkeletonDraftField()` 等函數

**查找所有調用 `assembleRenderModelFromSkeleton()` 的地點**（在此文件中可能有多個），確保都傳入 `compiledIntent`。

**模板**：每個調用都應該有類似的查詢邏輯：
```typescript
// 查詢 compiledIntent
const { data: projData } = await supabase
  .from("projects")
  .select("compiled_intent_v2")
  .eq("id", projectId)
  .eq("user_id", userId)
  .maybeSingle();

const compiledIntent = projData?.compiled_intent_v2
  ? parseCompiledIntentV2(projData.compiled_intent_v2)
  : undefined;

// 傳入 assembleRenderModelFromSkeleton
const nextModel = assembleRenderModelFromSkeleton({
  skeleton,
  profile,
  compiledIntent,  // ← 新增
  // ... 其他參數
});
```

---

## 📋 Task 4.4：修改調用地點 — `skeleton-create-actions.ts`

**文件**：`src/app/app/projects/skeleton-create-actions.ts`

**操作同 Task 4.3**：

1. **導入** `CompiledIntentV2` 和 `parseCompiledIntentV2`
2. **查詢** compiledIntent（從 projects 表）
3. **傳入** `assembleRenderModelFromSkeleton()` 調用

---

## 📋 Task 4.5：類型對應驗證

**關鍵檢查**：確保骨架模組 type 與 ModuleTypeV2 匹配

骨架中的 `mod.type` 應與 `ModuleTypeV2` 對齊：

| 骨架 mod.type | ModuleTypeV2 | 可選？ |
|---------------|-------------|-------|
| `hero` | `hero` | ❌ Always enabled |
| `form` | `form` | ❌ Always enabled |
| `footer` | `footer` | ❌ Always enabled |
| `offer` | `offer` | ✅ Optional |
| `faq` | `faq` | ✅ Optional |
| `about` | `about` | ✅ Optional |
| `contact` | `contact` | ✅ Optional |
| `listings` | `listings` | ✅ Optional |
| `testimonials` | `testimonials` | ✅ Optional |
| `openHome` | `openHome` | ✅ Optional |
| `services` | `services` | ✅ Optional |

**驗證**：在 `resolveActiveSkeletonModuleEntries()` 中，檢查是否有骨架模組 type 不在此列表中。

---

## ✅ Phase 4 完成檢查清單

- [ ] 修改 `resolveActiveSkeletonModuleEntries()` 簽名，添加 `compiledIntent` 參數
- [ ] 實現 `compiledIntent?.module_selection` 優先邏輯
- [ ] 修改 `assembleRenderModelFromSkeleton()` 簽名
- [ ] 修改 `skeleton-edit-actions.ts` 的所有調用地點
- [ ] 修改 `skeleton-create-actions.ts` 的所有調用地點
- [ ] 驗證 module type 對應關係
- [ ] npm run build 通過
- [ ] npm run test 通過（16/16）
- [ ] 本地測試：
  - [ ] 進入骨架模式（Skeleton Mode）
  - [ ] 修改 CompiledIntentV2 的 module_selection
  - [ ] 驗證網站裝配後只顯示選中的模組

---

## 🎯 Phase 4 核心邏輯

```
用戶選模組（UI） → 保存 CompiledIntentV2.module_selection
                 ↓
          Compile → Confirm → Save
                 ↓
    assembleRenderModelFromSkeleton() 呼叫
                 ↓
  resolveActiveSkeletonModuleEntries()
    └─ 檢查 compiledIntent.module_selection
       └─ 如果存在：使用用戶選中的模組
       └─ 如果不存在：回退到場景預設 (module_visibility)
                 ↓
      RenderModelV1（含選中模組）
                 ↓
      Draft Preview / Publish
```

---

## 🚀 後續步驟

Phase 4 完成後，進入 **Phase 5：測試與驗證**

- 單元測試：module_selection 邏輯
- 集成測試：Compile → Confirm → Assemble → Publish
- 兼容性測試：舊數據（無 module_selection）是否仍能裝配

---

## 💡 常見問題

### Q: 如果骨架中的 module type 不在 ModuleTypeV2 列表？
A: 目前應該不會發生（都被定義在 `types/skeleton.ts`）。但如有未知 module type，過濾邏輯會自動忽略它（不在 activeModuleSet 中）。

### Q: 舊項目（無 module_selection）是否還能工作？
A: 是的，回退邏輯會使用 `profile.module_visibility`，行為與 Phase 3 前完全相同。

### Q: module_selection 為空時會發生什麼？
A: `resolveActiveModulesForForm()` 會返回場景的默認推薦模組（always_enabled + recommended_enabled），詳見 `compiled-intent-v2.ts` 第 122-134 行。

