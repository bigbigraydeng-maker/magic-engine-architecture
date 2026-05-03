# HiBiz Phase 3 — 代碼審查修復指南

**狀態**：Phase 3 UI 實現完成（tests 16/16✓, build ✓），但代碼審查發現 7 個需修復的問題。

---

## 修復優先級

### 🔴 HIGH-1：useEffect 依賴 displayIntent 導致用戶選擇被覆蓋

**文件**：`src/components/project-compile-v2-card.tsx` 第 122–132 行

**問題**：useEffect 對 displayIntent 依賴導致用戶編輯中途若父組件傳入新 savedIntent（如 router.refresh() 後），selectedModules 會被無警告地重置。

**修復方案**：

1. 簡化 useEffect（只處理 editMode 的清理）
2. 在 `openEdit()` 中同步初始化 selectedModules（在 setEditMode(true) 之前）
3. `cancelEdit()` 保持簡單 setEditMode(false)

```typescript
// 替換現有 useEffect（第 122–132 行）為：
useEffect(() => {
  if (!editMode) {
    setPendingIndustry(null);
    setSelectedModules([]);
  }
}, [editMode]);  // ← 移除 displayIntent 依賴

// 更新 openEdit() 函數（第 152–160 行）：
const openEdit = () => {
  if (!displayIntent) {
    return;
  }
  setSaveMessage(null);
  setPendingIndustry(displayIntent.industry);

  // 同步初始化 selectedModules（在 setEditMode 之前）
  const savedModules = displayIntent.module_selection
    ? resolveActiveModulesForForm(displayIntent.scene, displayIntent.module_selection)
    : getDefaultModulesForScene(displayIntent.scene);
  setSelectedModules(savedModules);

  setEditMode(true);  // 最後觸發 useEffect
};

// 簡化 cancelEdit()（第 162–166 行）：
const cancelEdit = () => {
  setEditMode(false);
};
```

---

### 🔴 HIGH-3：場景解析邏輯重複（handleConfirm vs previewScene）

**文件**：`src/components/project-compile-v2-card.tsx` 第 254–255 行 vs 第 83–94 行

**問題**：兩處各自實現場景規則，未來修改其中一處會導致預覽和保存值不同。

**修復方案**：

1. 提取 `previewScene` 函數（已存在，第 83–94 行）
2. 在 `handleConfirm` 中調用 `previewScene` 代替內聯邏輯

```typescript
// 在 handleConfirm() 中（第 254–255 行）找到：
const sc = ind !== base.industry ? defaultSceneForIndustry(ind) : base.scene;

// 替換為：
const sc = previewScene(pendingIndustry ?? base.industry, intent ?? savedIntent);
```

確保 `previewScene` 函數在文件中存在（應在輔助函數區段）：
```typescript
function previewScene(ind: IndustryV2, disp: CompiledIntentV2 | null): SceneV2 {
  if (!ind || !disp) return disp?.scene ?? "property_listing";
  if (ind === disp.industry) return disp.scene;
  return defaultSceneForIndustry(ind);
}
```

---

### 🔴 HIGH-5：Always-Enabled 模組列表硬編碼

**文件**：`src/components/project-compile-v2-card.tsx` 第 420–435 行和第 427 行

**問題**：UI 硬編碼 `["hero", "form", "footer"]`，未來若場景數據變更不會同步更新。

**修復方案**：

在 Always-Enabled 模組渲染處，派生自場景配置：

```typescript
// 替換現有的硬編碼 ["hero", "form", "footer"] 為：

{editMode && pendingIndustry ? (
  <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
    <p className="mb-3 text-sm font-semibold text-stone-900">Module Selection</p>

    {/* Always Enabled (disabled) - 派生自場景數據 */}
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-stone-600 uppercase">Always Enabled (Cannot disable)</p>
      <div className="space-y-2">
        {(() => {
          const scene = previewScene(pendingIndustry, displayIntent);
          const alwaysEnabled = MODULE_DEFAULTS_BY_SCENE[scene]?.always_enabled ?? ["hero", "form", "footer"];
          return alwaysEnabled.map((mod) => (
            <label key={mod} className="flex items-center gap-2 cursor-not-allowed opacity-60">
              <input type="checkbox" checked disabled className="rounded" />
              <span className="text-sm text-stone-700 capitalize">{mod}</span>
            </label>
          ));
        })()}
      </div>
    </div>

    {/* 可選模組... */}
  </div>
) : null}
```

需確保導入 `MODULE_DEFAULTS_BY_SCENE`：
```typescript
import {
  MODULE_DEFAULTS_BY_SCENE,
  // ... 其他現有導入
} from "@/types/compiled-intent-v2";
```

---

### 🔴 HIGH-2：getSelectableModulesForIndustry 與場景數據不同步

**文件**：`src/components/project-compile-v2-card.tsx` 第 629–637 行

**問題**：UI 列表與 `getAllSelectableModulesForScene` 各自維護，無編譯時同步保障。

**修復方案**：

派生 UI 列表自場景配置，而非硬編碼：

```typescript
// 替換現有 getSelectableModulesForIndustry() 為：
function getSelectableModulesForIndustry(industry: IndustryV2): SelectableModuleType[] {
  // 從 MODULE_DEFAULTS_BY_SCENE 匯集該行業所有場景的可選模組
  const allModules = new Set<SelectableModuleType>();

  for (const sceneKey of Object.keys(MODULE_DEFAULTS_BY_SCENE) as SceneV2[]) {
    const defaults = MODULE_DEFAULTS_BY_SCENE[sceneKey];

    // 只匯集相符行業的場景
    const isRealEstateScene = ["property_listing", "open_home_event", "market_update"].includes(sceneKey);
    const isImmigrationScene = ["visa_consultation", "school_info", "program_enrollment"].includes(sceneKey);

    if ((industry === "real_estate" && isRealEstateScene) ||
        (industry === "immigration" && isImmigrationScene)) {
      defaults.recommended_enabled.forEach(m => allModules.add(m));
      defaults.optional_modules.forEach(m => allModules.add(m));
    }
  }

  return Array.from(allModules).sort();
}
```

---

### 🔴 HIGH-4：樂觀更新與 DB 版本號不同步

**文件**：`src/components/project-compile-v2-card.tsx` 第 216–243 行（mergeConfirmLocalState）

**問題**：客戶端 `collectPriorRevisionsForConfirm` 使用本地 React 狀態，而非 DB 狀態。若多標籤寫入，版本號會錯誤。

**修復方案**：簡化邏輯，依賴 `router.refresh()` 後的伺服器狀態：

```typescript
// 簡化 mergeConfirmLocalState() 函數（第 216–243 行）：
const mergeConfirmLocalState = (mergedInput: CompiledIntentV2) => {
  // 不再嘗試合併歷史版本——依賴 router.refresh() 返回最新狀態
  setIntent(mergedInput);
  router.refresh();
};

// 簡化 handleConfirm() 流程（第 246–276 行）：
const handleConfirm = () => {
  const base = intent ?? savedIntent;
  if (!base) {
    return;
  }
  setError(null);
  setSaveMessage(null);
  startTransition(async () => {
    try {
      const ind = pendingIndustry ?? base.industry;
      const sc = previewScene(pendingIndustry ?? base.industry, intent ?? savedIntent);
      const mergedInput: CompiledIntentV2 = {
        ...stripIntentForRevision(base),
        industry: ind,
        scene: sc,
      };
      await confirmIntentV2Action(projectId, mergedInput);

      // 簡化：設定合併狀態但依賴 router.refresh() 返回正確版本
      setIntent(mergedInput);

      const sceneForForm = sc;
      const modules = resolveActiveModulesForForm(sceneForForm, mergedInput.module_selection);
      setFormFields(buildFormFieldsFromModules(ind, modules, sceneForForm));

      setEditMode(false);
      setPendingIndustry(null);
      setSelectedModules([]);
      setSaveMessage("已保存到項目。可在下方使用「生成網站草稿」。");

      router.refresh();  // 伺服器會返回正確的版本歷史
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  });
};
```

---

### 🟡 MEDIUM-1：文件 637 行超過 400 行限制

**文件**：`src/components/project-compile-v2-card.tsx`

**修復方案**：拆分組件

1. **提取歷史模態框**：創建 `src/components/ProjectIntentHistoryModal.tsx`
   - 移動 historyOpen 相關狀態和模態框 JSX（現在 495–550 行）

2. **提取模組選擇面板**：創建 `src/components/ModuleSelectionPanel.tsx`
   - 接收 props：industry, selectedModules, onChange, scene, displayIntent
   - 包含 Always-Enabled 和 Optional 兩組複選框

3. **提取輔助函數**：創建 `src/lib/compile-v2-helpers.ts`
   - `modulesSignature(modules, scene, displayIntent)`
   - `baselineModulesForIntent(intent)`
   - `moduleSelectionFromModules(scene, modules)`
   - `previewScene(industry, displayIntent)`
   - `filterModulesForScene(selectedModules, scene)`
   - `getSelectableModulesForIndustry(industry)`
   - `defaultSceneForIndustry(industry)`

目標：`project-compile-v2-card.tsx` < 400 行

---

### 🟡 MEDIUM-2：空模組預覽檢查邏輯有誤

**文件**：`src/components/project-compile-v2-card.tsx` 第 139–143 行

**問題**：若只有 always-enabled 模組，previewFields 會因 `mods.length === 0` 檢查失敗而顯示只有 3 個必需字段的預覽（看起來跟無預覽一樣）。

**修復方案**：檢查是否有可選模組被激活

```typescript
// 找到現有的 previewFields useMemo（第 135–151 行）
// 添加額外的檢查：

const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && selectedModules.length > 0) {
    const sceneForForm = previewScene(pendingIndustry, displayIntent);
    const mods = filterModulesForScene(selectedModules, sceneForForm);

    // 檢查是否有非 always-enabled 的模組
    const hasSelectableModules = mods.some(m => !["hero", "form", "footer"].includes(m));
    if (!hasSelectableModules) {
      // 只有 always-enabled，不顯示預覽
      return null;
    }

    return buildFormFieldsFromModules(pendingIndustry, mods, sceneForForm);
  }
  return null;
}, [editMode, pendingIndustry, selectedModules, displayIntent]);
```

---

## 修復檢查清單

- [ ] HIGH-1：移除 useEffect displayIntent 依賴，openEdit() 同步初始化
- [ ] HIGH-3：handleConfirm 使用 previewScene 派生場景值
- [ ] HIGH-5：Always-Enabled 列表派生自 MODULE_DEFAULTS_BY_SCENE
- [ ] HIGH-2：getSelectableModulesForIndustry 從場景配置聚集模組
- [ ] HIGH-4：簡化 mergeConfirmLocalState，依賴 router.refresh()
- [ ] MEDIUM-1：拆分組件至 < 400 行
- [ ] MEDIUM-2：previewFields 檢查可選模組計數
- [ ] npm run build 通過
- [ ] npm run test 通過（16/16）
- [ ] 浏览器手動測試（edit → toggle modules → confirm → refresh）

---

## 修復後驗證

1. **編輯已保存意圖** → selectedModules 正確從 module_selection 恢復 ✓
2. **切換 Industry** → selectedModules 重置為新行業默認值 ✓
3. **勾選模組** → 藍色預覽欄實時更新 ✓
4. **多標籤編輯** → 其他標籤保存後刷新，模組選擇不丟失 ✓
5. **點確認** → module_selection 正確保存 ✓
6. **查看歷史** → 版本號和日期正確（不會因樂觀更新而錯亂）✓
