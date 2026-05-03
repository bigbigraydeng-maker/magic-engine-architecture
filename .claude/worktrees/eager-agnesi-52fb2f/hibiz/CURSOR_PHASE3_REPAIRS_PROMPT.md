# Cursor Phase 3 修復提示詞

## 背景與目標

Phase 3 UI 實現已完成（tests 16/16✓, build ✓），但代碼審查發現 7 個需修復的問題。

**修復目標**：
1. 修復 5 個 HIGH 架構問題（状態管理、數據一致性、邏輯重複）
2. 修復 2 個 MEDIUM 問題（代碼組織、邊界情況）
3. 確保 tests 仍通過、build 成功、瀏覽器手動驗證正確

**預計時間**：1.5–2h

---

## 修復清單（按優先級）

### 1️⃣ HIGH-1：修復 useEffect 導致用戶選擇被覆蓋

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：useEffect 依賴 displayIntent，導致 router.refresh() 後用戶的模組選擇被無警告重置。

**修復步驟**：

**A. 簡化 useEffect（第 122–132 行）**

找到：
```typescript
useEffect(() => {
  if (!editMode) {
    setPendingIndustry(null);
    setSelectedModules([]);
  } else if (editMode && displayIntent) {
    const savedModules = displayIntent.module_selection
      ? resolveActiveModulesForForm(displayIntent.scene, displayIntent.module_selection)
      : getDefaultModulesForScene(displayIntent.scene);
    setSelectedModules(savedModules);
  }
}, [editMode, displayIntent]);  // ← 問題：displayIntent 依賴
```

替換為：
```typescript
useEffect(() => {
  if (!editMode) {
    setPendingIndustry(null);
    setSelectedModules([]);
  }
}, [editMode]);  // ← 移除 displayIntent 依賴
```

**B. 在 openEdit() 中同步初始化（第 152–160 行）**

找到：
```typescript
const openEdit = () => {
  if (!displayIntent) {
    return;
  }
  setSaveMessage(null);
  setEditMode(true);
  setPendingIndustry(displayIntent.industry);
};
```

替換為：
```typescript
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
```

**C. 簡化 cancelEdit()（第 162–166 行）**

替換為：
```typescript
const cancelEdit = () => {
  setEditMode(false);
};
```

---

### 2️⃣ HIGH-3：修復場景解析邏輯重複

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：handleConfirm 與 previewScene 各自實現場景規則，未來修改其中一處會導致預覽和保存值不同。

**修復步驟**：

**A. 確保 previewScene 輔助函數存在（文件底部，應在第 600+ 行）**

若不存在，添加：
```typescript
function previewScene(ind: IndustryV2, disp: CompiledIntentV2 | null): SceneV2 {
  if (!ind || !disp) return disp?.scene ?? "property_listing";
  if (ind === disp.industry) return disp.scene;
  return defaultSceneForIndustry(ind);
}
```

**B. 在 handleConfirm 中調用 previewScene（第 254–255 行）**

找到：
```typescript
const sc = ind !== base.industry ? defaultSceneForIndustry(ind) : base.scene;
```

替換為：
```typescript
const sc = previewScene(pendingIndustry ?? base.industry, intent ?? savedIntent);
```

---

### 3️⃣ HIGH-5：修復 Always-Enabled 模組列表硬編碼

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：UI 硬編碼 `["hero", "form", "footer"]`，若場景數據變更不會同步。

**修復步驟**：

**A. 導入 MODULE_DEFAULTS_BY_SCENE（第 1–20 行導入段）**

確保導入中包含：
```typescript
import {
  MODULE_DEFAULTS_BY_SCENE,
  // ... 其他現有導入
} from "@/types/compiled-intent-v2";
```

**B. 在 Module 選擇面板中派生 Always-Enabled 列表（第 420–435 行）**

找到硬編碼的 `{["hero", "form", "footer"].map((mod) => (...))}`

替換為：
```typescript
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

    {/* Optional Modules... 保留現有邏輯 */}
  </div>
) : null}
```

---

### 4️⃣ HIGH-2：修復 getSelectableModulesForIndustry 與場景數據同步

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：UI 列表與 `getAllSelectableModulesForScene` 各自維護，無編譯時同步保障。

**修復步驟**：

**A. 替換 getSelectableModulesForIndustry 實現（文件底部，第 629–637 行）**

替換為：
```typescript
function getSelectableModulesForIndustry(industry: IndustryV2): SelectableModuleType[] {
  // 從 MODULE_DEFAULTS_BY_SCENE 聚集該行業所有場景的可選模組
  const allModules = new Set<SelectableModuleType>();

  const realEstateScenes: SceneV2[] = ["property_listing", "open_home_event", "market_update"];
  const immigrationScenes: SceneV2[] = ["visa_consultation", "school_info", "program_enrollment"];
  const scenesForInd = industry === "real_estate" ? realEstateScenes : immigrationScenes;

  for (const scene of scenesForInd) {
    const defaults = MODULE_DEFAULTS_BY_SCENE[scene];
    if (defaults) {
      defaults.recommended_enabled.forEach(m => allModules.add(m));
      defaults.optional_modules.forEach(m => allModules.add(m));
    }
  }

  return Array.from(allModules).sort() as SelectableModuleType[];
}
```

---

### 5️⃣ HIGH-4：簡化樂觀更新，依賴 router.refresh()

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：mergeConfirmLocalState 嘗試客戶端合併版本歷史，可能與 DB 不同步。

**修復步驟**：

**A. 簡化 mergeConfirmLocalState 函數（第 216–243 行）**

替換為：
```typescript
const mergeConfirmLocalState = (mergedInput: CompiledIntentV2) => {
  // 簡化邏輯：設定合併狀態，依賴 router.refresh() 返回正確的伺服器狀態
  setIntent(mergedInput);
};
```

**B. 更新 handleConfirm 中的調用邏輯（第 246–276 行）**

確保 handleConfirm 流程：
1. 調用 confirmIntentV2Action（伺服器持久化，返回正確版本）
2. 設置本地 intent 為合併值（樂觀更新）
3. 調用 router.refresh()（伺服器重新渲染，獲得正確狀態）

```typescript
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
      const sc = previewScene(ind, intent ?? savedIntent);
      const mergedInput: CompiledIntentV2 = {
        ...stripIntentForRevision(base),
        industry: ind,
        scene: sc,
      };
      await confirmIntentV2Action(projectId, mergedInput);

      // 樂觀更新
      setIntent(mergedInput);

      const modules = resolveActiveModulesForForm(sc, mergedInput.module_selection);
      const formFields = buildFormFieldsFromModules(ind, modules, sc);
      setFormFields(formFields);

      setEditMode(false);
      setPendingIndustry(null);
      setSelectedModules([]);
      setSaveMessage("已保存到項目。可在下方使用「生成網站草稿」。");

      // 伺服器重新渲染，獲得正確的版本歷史和狀態
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  });
};
```

---

### 6️⃣ MEDIUM-1：拆分組件至 < 400 行

**文件**：`src/components/project-compile-v2-card.tsx`（637 行 → 目標 < 400 行）

**修復步驟**：

**A. 提取歷史模態框（新文件 `src/components/ProjectIntentHistoryModal.tsx`）**

移動現有的歷史模態框代碼（第 495–550 行）到新組件，簽名：
```typescript
interface ProjectIntentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  revisions: IntentRevisionV2[];
  displayIntent: CompiledIntentV2 | null;
  onRollback: (rev: IntentRevisionV2) => void;
  pending: boolean;
}

export function ProjectIntentHistoryModal({
  open, onClose, revisions, displayIntent, onRollback, pending
}: ProjectIntentHistoryModalProps) {
  // 從原組件移入的模態框 JSX
}
```

在 project-compile-v2-card.tsx 中替換為：
```typescript
import { ProjectIntentHistoryModal } from "./ProjectIntentHistoryModal";

// ... 在原模態框位置替換為：
{displayIntent?.user_confirmed && revisionsForModal.length > 0 ? (
  <button
    type="button"
    onClick={() => setHistoryOpen(true)}
    className="text-sm font-medium text-indigo-800 underline hover:text-indigo-950"
  >
    查看歷史版本
  </button>
) : null}

<ProjectIntentHistoryModal
  open={historyOpen}
  onClose={() => setHistoryOpen(false)}
  revisions={revisionsForModal}
  displayIntent={displayIntent}
  onRollback={handleRollback}
  pending={pending}
/>
```

**B. 提取模組選擇面板（新文件 `src/components/ModuleSelectionPanel.tsx`）**

簽名：
```typescript
interface ModuleSelectionPanelProps {
  industry: IndustryV2;
  selectedModules: ModuleTypeV2[];
  onModulesChange: (modules: ModuleTypeV2[]) => void;
  displayIntent: CompiledIntentV2 | null;
  onCompile: () => void;
  onCancel: () => void;
  pending: boolean;
  rawPrompt: string;
}

export function ModuleSelectionPanel({
  industry, selectedModules, onModulesChange, displayIntent,
  onCompile, onCancel, pending, rawPrompt
}: ModuleSelectionPanelProps) {
  // 模組選擇 UI + Always-Enabled + Optional + 按鈕
}
```

在 project-compile-v2-card.tsx 中替換為：
```typescript
import { ModuleSelectionPanel } from "./ModuleSelectionPanel";

{editMode && pendingIndustry ? (
  <ModuleSelectionPanel
    industry={pendingIndustry}
    selectedModules={selectedModules}
    onModulesChange={setSelectedModules}
    displayIntent={displayIntent}
    onCompile={handleCompile}
    onCancel={cancelEdit}
    pending={pending}
    rawPrompt={rawPrompt}
  />
) : null}
```

**C. 提取輔助函數（新文件 `src/lib/compile-v2-helpers.ts`）**

將以下函數移出 project-compile-v2-card.tsx：
- `previewScene`
- `defaultSceneForIndustry`
- `filterModulesForScene`
- `moduleSelectionFromModules`
- `baselineModulesForIntent`
- `modulesSignature`
- `getSelectableModulesForIndustry`

在 project-compile-v2-card.tsx 頂部導入：
```typescript
import {
  previewScene,
  defaultSceneForIndustry,
  filterModulesForScene,
  moduleSelectionFromModules,
  baselineModulesForIntent,
  modulesSignature,
  getSelectableModulesForIndustry,
} from "@/lib/compile-v2-helpers";
```

---

### 7️⃣ MEDIUM-2：修復空模組預覽檢查邏輯

**文件**：`src/components/project-compile-v2-card.tsx`

**問題**：只有 always-enabled 模組時，previewFields 仍會顯示（只有 3 個必需字段），看起來跟無預覽一樣。

**修復步驟**：

**A. 在 previewFields useMemo 中添加可選模組檢查（第 135–151 行）**

找到 previewFields 邏輯，添加檢查：
```typescript
const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && selectedModules.length > 0) {
    const sceneForForm = previewScene(pendingIndustry, displayIntent);
    const mods = filterModulesForScene(selectedModules, sceneForForm);

    // ✅ 新增：檢查是否有非 always-enabled 的模組
    const alwaysEnabled = ["hero", "form", "footer"] as const;
    const hasSelectableModules = mods.some(m => !alwaysEnabled.includes(m as any));
    if (!hasSelectableModules) {
      // 只有 always-enabled，無需顯示預覽
      return null;
    }

    return buildFormFieldsFromModules(pendingIndustry, mods, sceneForForm);
  }
  return null;
}, [editMode, pendingIndustry, selectedModules, displayIntent]);
```

---

## 驗證檢查清單

完成所有修復後，執行：

```bash
# 1. 構建檢查
npm run build

# 2. 測試檢查
npm run test

# 3. 瀏覽器手動測試
# 開啟 http://localhost:3000/app/projects/[some-project-id]
# 依次執行：
```

**手動測試步驟**：
- [ ] **編輯已保存的意圖** → 進入編輯模式 → selectedModules 正確從 module_selection 恢復
- [ ] **切換 Industry** → selectedModules 重置為新行業的推薦模組
- [ ] **勾選 / 取消勾選模組** → 藍色預覽欄實時更新（Contact / Property / Additional）
- [ ] **多標籤場景** → 在 A 標籤編輯，B 標籤保存，回到 A 標籤 → 模組選擇不丟失
- [ ] **點「確認並保存」** → 保存成功 → 刷新後模組列表與保存值一致
- [ ] **查看歷史版本** → 版本號、日期正確（不會因樂觀更新而錯亂）

---

## 完成標誌

- [ ] 所有 5 個 HIGH 問題修復完成
- [ ] 所有 2 個 MEDIUM 問題修復完成
- [ ] `npm run build` 通過
- [ ] `npm run test` 通過（16/16）
- [ ] 浏览器手動驗證全部通過 ✓
- [ ] 代碼行數：project-compile-v2-card.tsx < 400 行

---

## 提交

完成所有修復後，創建提交：

```bash
git add -A
git commit -m "fix(Phase 3): resolve 7 code review issues — HIGH-1/2/3/4/5 + MEDIUM-1/2

- HIGH-1: Remove displayIntent from useEffect dependency to prevent selection overwrite
- HIGH-3: Consolidate scene resolution logic by calling previewScene in handleConfirm
- HIGH-5: Derive always-enabled modules from MODULE_DEFAULTS_BY_SCENE instead of hardcoding
- HIGH-2: Aggregate getSelectableModulesForIndustry from scene configuration data
- HIGH-4: Simplify optimistic state merging, rely on router.refresh() for DB state
- MEDIUM-1: Extract components (HistoryModal, ModuleSelectionPanel, helpers) to reduce file to <400 lines
- MEDIUM-2: Add check for selectable modules in previewFields condition

Tests: 16/16 pass
Build: successful"
```

**完成後可進入 Phase 4（裝配邏輯）。**
