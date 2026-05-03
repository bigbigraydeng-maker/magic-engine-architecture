# HiBiz Phase 5 — 測試與驗證（Testing & Verification）

**前置條件**：Phase 1-4 已完成並推送到生產環境。

**目標**：驗證 Option B 模組開關系統從 Compile → Confirm → Assembly → Publish 的完整端到端流程正常運作。

---

## 📋 測試環境

**生產域名**：`https://hibiz-service.onrender.com`

**測試涵蓋範圍**：
- Compile UI（Module 多選）
- 資料持久化（module_selection 寫入 DB）
- Skeleton 裝配（讀取 module_selection）
- Preview Draft（只顯示選中模組）
- 發佈網站（線上驗證）
- 向後相容性（舊項目仍能正常運作）

---

## 🧪 Test Case 1：新項目 - 完整 Compile 流程

### 目標
驗證用戶能在 Compile 面板選擇模組，並正確保存到資料庫。

### 前置條件
- 已登入 HiBiz
- 有一個已編譯的項目（或新建一個）

### 步驟

#### 1.1：進入 Compile 面板
```
URL: https://hibiz-service.onrender.com/app/projects/[PROJECT_ID]/compile
```
✓ 頁面加載成功，不報錯

#### 1.2：點擊「Edit」進入編輯模式
```
位置：編譯結果卡片右上角
預期：看到 Industry 單選 + Module 多選複選框
```

#### 1.3：驗證 Module 多選複選框結構
```
應該看到三組：
┌─ Always Enabled (Cannot disable) ─────┐
│ ☑ Hero   ☑ Form   ☑ Footer            │
│ （灰顯，無法取消）                      │
└──────────────────────────────────────┘

┌─ Recommended ─────────────────────────┐
│ ☑ Offer   ☑ Contact   ☑ FAQ           │
│ （根據 industry + scene 預設勾選）     │
└──────────────────────────────────────┘

┌─ Optional ────────────────────────────┐
│ ☐ About   ☐ Listings   ☐ ...         │
│ （用戶可勾選/取消）                    │
└──────────────────────────────────────┘

┌─ 藍色預覽欄 ──────────────────────────┐
│ 推薦表單字段（根據選中模組動態更新）  │
└──────────────────────────────────────┘
```
✓ 結構正確

#### 1.4：取消勾選一個 Recommended 模組
```
例：取消勾選「Offer」
預期：
  - 複選框狀態改變 ✓
  - 藍色預覽欄立即更新（移除 offer 相關字段）✓
  - 「確認」按鈕啟用 ✓
```

#### 1.5：勾選一個 Optional 模組
```
例：勾選「About」
預期：
  - 複選框狀態改變 ✓
  - 藍色預覽欄立即更新（新增 about 相關內容）✓
```

#### 1.6：點擊「確認並保存」
```
預期：
  - 按鈕顯示 loading 狀態 ✓
  - 成功保存，頁面重新加載 ✓
  - 返回編譯結果視圖，顯示「已保存到項目」提示 ✓
```

#### 1.7：重新進入編輯模式，驗證狀態持久化
```
點擊「Edit」再次進入編輯
預期：
  - selectedModules 恢復為之前選擇的狀態 ✓
  - 預覽欄顯示與之前一致 ✓
```

✓ **Test Case 1 通過**：Module 選擇正確保存與恢復

---

## 🧪 Test Case 2：Skeleton 模式 - Assembly 驗證

### 目標
驗證 Skeleton 裝配邏輯優先讀取 compiled_intent 的 module_selection，而非場景預設。

### 前置條件
- 有一個骨架模式項目（Skeleton Mode）
- 該項目有對應的 CompiledIntentV2（含 module_selection）

### 步驟

#### 2.1：進入骨架編輯頁面
```
URL: https://hibiz-service.onrender.com/app/projects/[PROJECT_ID]?preview=1
```
✓ 頁面加載成功

#### 2.2：查看 Preview Draft（草稿預覽）
```
預期：
  - 網站顯示的模組與 CompiledIntentV2.module_selection 一致 ✓
  - 如果 module_selection 只包含 [hero, form, footer, offer, contact]
    → 預覽中只顯示這 5 個模組 ✓
  - 如果沒有 testimonials，預覽中不顯示 testimonials 模組 ✓
```

#### 2.3：在 Compile 面板修改 Module 選擇
```
進入 Compile 面板 → Edit → 新增/移除一個模組 → 確認保存
```

#### 2.4：回到 Skeleton Preview，驗證更新
```
重新加載 Preview 頁面（或等待自動更新）
預期：
  - 網站模組組成已更新為新的 module_selection ✓
  - 新增的模組出現在預覽中 ✓
  - 移除的模組從預覽中消失 ✓
```

✓ **Test Case 2 通過**：Assembly 邏輯正確讀取 module_selection

---

## 🧪 Test Case 3：Industry 切換 - 模組重置

### 目標
驗證切換 Industry 時，Module 選擇自動重置為新行業的預設值。

### 步驟

#### 3.1：進入編輯模式
```
Compile 面板 → Edit
當前 Industry：Real Estate
```

#### 3.2：記錄當前 Module 狀態
```
例：
- Offer ✓（勾選）
- Contact ✓（勾選）
- About ✗（取消）
```

#### 3.3：切換 Industry 至 Immigration
```
點擊 Industry 單選按鈕切換至「Immigration & education」
預期：
  - selectedModules 立即重置 ✓
  - Module 複選框更新為新行業的推薦值 ✓
  - 藍色預覽欄更新顯示新行業的推薦字段 ✓
```

#### 3.4：驗證新行業的模組不同
```
Real Estate 推薦：offer, contact, faq
Immigration 推薦：offer, contact（通常不同）

預期：複選框狀態與新行業推薦相符 ✓
```

✓ **Test Case 3 通過**：Industry 切換正確重置 Module 選擇

---

## 🧪 Test Case 4：多標籤編輯 - 狀態不丟失

### 目標
驗證在多標籤環境中，編輯其他標籤後，當前標籤的 Module 選擇不被覆蓋。

### 步驟

#### 4.1：在 Tab A 中進入編輯模式
```
Tab A：https://hibiz-service.onrender.com/app/projects/[PROJECT_ID]/compile
→ Edit → 選擇特定模組組合（例：Offer ✓, Contact ✓, FAQ ✗）
```

#### 4.2：在新標籤中打開同一項目
```
Tab B：在新標籤中打開 https://hibiz-service.onrender.com/app/projects/[PROJECT_ID]/compile
→ Edit → 選擇不同的模組組合（例：Offer ✓, Contact ✗, FAQ ✓）
→ 確認保存
```

#### 4.3：回到 Tab A，驗證選擇未被覆蓋
```
回到 Tab A（不關閉編輯模式）
預期：
  - selectedModules 仍保持 Tab A 的選擇（Offer ✓, Contact ✓, FAQ ✗）✓
  - 重新加載後，確認保存 Tab B 的更改（Offer ✓, Contact ✗, FAQ ✓）
```

✓ **Test Case 4 通過**：多標籤編輯狀態管理正確

---

## 🧪 Test Case 5：向後相容性 - 舊項目支持

### 目標
驗證舊項目（無 compiled_intent_v2）仍能正常運作，使用 module_visibility 邏輯。

### 步驟

#### 5.1：識別舊項目
```
找一個在 Phase 4 實施前創建的項目
或手動刪除該項目的 compiled_intent_v2 字段進行測試
```

#### 5.2：進入 Skeleton Preview
```
URL: https://hibiz-service.onrender.com/app/projects/[OLD_PROJECT_ID]?preview=1
預期：
  - Preview 頁面正常加載 ✓
  - 網站使用 module_visibility 邏輯裝配 ✓
  - 不出現錯誤信息 ✓
```

#### 5.3：修改 Module Visibility
```
在 Preview 頁面中切換模組開關（如果有 UI）
預期：
  - 模組狀態改變 ✓
  - Preview 實時更新 ✓
```

#### 5.4：在 Compile 面板編輯舊項目
```
進入 Compile → Edit → 選擇新的 Module 組合 → 確認保存
預期：
  - 保存成功 ✓
  - DB 中新增 compiled_intent_v2（從預設推薦或之前狀態初始化）✓
  - 重新加載，驗證 compiled_intent_v2 已被創建 ✓
```

✓ **Test Case 5 通過**：向後相容性完整

---

## 🧪 Test Case 6：發佈驗證 - 線上網站

### 目標
驗證發佈後的線上網站只包含用戶在 Compile 時選擇的模組。

### 步驟

#### 6.1：準備已確認的項目
```
確保項目已在 Compile 中選擇了特定模組組合並保存
例：只選 [hero, form, footer, offer, contact]（共 5 個）
```

#### 6.2：發佈網站
```
進入 Preview Draft → 點擊「Publish」
預期：
  - 發佈流程成功 ✓
  - 顯示發佈成功提示 ✓
```

#### 6.3：訪問已發佈網站
```
URL: https://hibiz-service.onrender.com/site/[SLUG]
或項目提供的公開鏈接
預期：
  - 網站加載成功 ✓
  - 只顯示已選中的 5 個模組 ✓
  - 不顯示未選中的模組（如 about, testimonials, etc.）✓
  - 網站功能正常（表單提交、導航、等）✓
```

#### 6.4：驗證 SEO 元數據
```
在瀏覽器中查看頁面源代碼（Ctrl+U）
預期：
  - <title> 標籤正確 ✓
  - <meta name="description"> 正確 ✓
  - Open Graph 標籤正確 ✓
```

✓ **Test Case 6 通過**：發佈網站與模組選擇一致

---

## 🧪 Test Case 7：表單字段預覽 - 動態更新

### 目標
驗證編輯模式中的表單字段預覽正確反映選中模組的推薦字段。

### 步驟

#### 7.1：進入編輯，觀察初始預覽
```
Compile → Edit
藍色預覽欄應顯示：
- Contact 字段：name, email, phone
- Additional 字段：message（根據 industry）
```

#### 7.2：增加模組，觀察字段增加
```
勾選「Listings」（房地產專用）
預期：藍色預覽欄新增：
- Property interest 字段：property_address, property_type, bedrooms, budget
```

#### 7.3：移除模組，觀察字段減少
```
取消勾選「Offer」
預期：藍色預覽欄移除與 offer 相關的字段
```

✓ **Test Case 7 通過**：表單字段預覽動態正確

---

## ✅ 最終檢查清單

### 功能驗證
- [ ] Module 多選複選框正確顯示（三組：Always / Recommended / Optional）
- [ ] 編輯時實時預覽表單字段變化
- [ ] 確認保存後，module_selection 持久化到 DB
- [ ] 重新進入編輯，selectedModules 正確恢復
- [ ] Industry 切換自動重置 Module 選擇
- [ ] 多標籤編輯時狀態不互相覆蓋
- [ ] Skeleton Assembly 優先讀取 module_selection
- [ ] 舊項目（無 compiled_intent_v2）仍能正常運作
- [ ] 發佈網站只顯示已選模組
- [ ] 表單字段根據模組動態更新

### 技術檢查
- [ ] Console 無 JavaScript 錯誤
- [ ] 網路請求成功（無 4xx/5xx）
- [ ] DB 中 compiled_intent_v2 結構正確
- [ ] module_selection 值與 UI 選擇一致
- [ ] 向後相容性：舊項目無錯誤

### 性能檢查
- [ ] 頁面加載時間 < 3 秒
- [ ] 模組切換響應時間 < 500ms
- [ ] Preview 更新流暢無卡頓
- [ ] 發佈流程 < 10 秒

---

## 🐛 如果發現問題

### 常見問題排查

| 問題 | 原因 | 解決方案 |
|------|------|---------|
| Module 複選框未顯示 | `editMode` 未激活 | 確保點擊「Edit」 |
| 預覽欄不更新 | `useEffect` 依賴缺失 | 檢查 browser console |
| 保存後選擇丟失 | `router.refresh()` 失敗 | 檢查 DB 中 compiled_intent_v2 |
| Industry 切換後選擇無效 | `onIndustryChange` 邏輯 | 檢查是否調用 `setSelectedModules` |
| Skeleton 顯示錯誤模組 | `resolveActiveSkeletonModuleEntries()` 邏輯 | 驗證 module_selection 與 skeleton mod.type 對應 |

### 收集信息報告

如遇到問題，請提供：
1. **URL**：項目頁面 URL
2. **操作步驟**：如何重現問題
3. **預期行為**：應該發生什麼
4. **實際行為**：實際發生什麼
5. **Console 錯誤**：F12 → Console 標籤的紅色錯誤信息
6. **DB 狀態**：Supabase dashboard 中 projects 表的 compiled_intent_v2 內容

---

## 📝 測試報告模板

```
# Option B Phase 5 測試報告

**測試日期**：YYYY-MM-DD
**測試人員**：[Your Name]
**測試環境**：https://hibiz-service.onrender.com

## 測試結果

- [ ] Test Case 1：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 2：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 3：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 4：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 5：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 6：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：
- [ ] Test Case 7：✓ PASS / ✗ FAIL / ⊘ SKIP
  - 備註：

## 總體評估

- **功能完整性**：[ ] 100% / [ ] 80-99% / [ ] < 80%
- **穩定性**：[ ] 穩定 / [ ] 偶爾出現問題 / [ ] 頻繁出現問題
- **性能**：[ ] 優秀 / [ ] 良好 / [ ] 需要優化
- **向後相容性**：[ ] 完全兼容 / [ ] 大部分兼容 / [ ] 有問題

## 發現的問題

1. **問題 #1**：[描述]
   - 重現步驟：[步驟]
   - 影響範圍：[哪些功能]
   - 優先級：HIGH / MEDIUM / LOW

2. **問題 #2**：...

## 簽名

測試者：________________
日期：__________________
```

---

## 🚀 測試完成後

**所有 Test Case 都通過（PASS）**：
→ **Option B 系統完全上線！** 🎉

**有 FAIL 項目**：
→ 提供測試報告，我會修復並迭代

---

## 💡 額外驗證（可選）

### 壓力測試
```
在 Compile 面板快速切換 10+ 次 Industry/Module 選擇
預期：無性能下降、無狀態錯亂
```

### 大規模模組測試
```
勾選所有 Optional 模組（8 個）
預期：預覽欄正確顯示所有字段，無重複或遺漏
```

### 浏覽器相容性
```
測試在 Chrome / Firefox / Safari 中的表現
預期：所有浏覽器行為一致
```

---

