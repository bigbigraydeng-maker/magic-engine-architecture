# HiBiz Phase 4.1 — Compile 面板重构 & 解耦生成

## 任务概述

**目标**：实现方案 B 的 Intent 工作流 — 用户在 Compile 阶段可以编辑/确认参数，然后才生成网站。

**拆分为两个子任务**：
1. **Task 1**：Compile 面板增强 — 支持参数编辑 + 重新编译
2. **Task 3**：解耦生成 — Compile 确认后，单独显示"生成网站"按钮

**预期工作量**：3-4 小时
**交付物**：修改 3 个文件 + 通过所有测试

---

## 工作流变化（Before → After）

### Before（现状）
```
用户输入 prompt
  ↓
自动 Rule Guard + LLM Compile
  ↓
自动生成网站
  ↓
用户只能在网站编辑界面修改（如果有的话）
```

### After（Task 1 + 3）
```
用户输入 prompt
  ↓
Rule Guard + LLM Compile → 显示结果
  ↓
用户可以：
  - 看到编译结果（industry, scene, language）
  - 点"编辑"修改 industry/scene
  - 重新编译看新的推荐字段
  - 点"确认保存"
  ↓
只有确认后，才显示"生成网站"按钮
  ↓
用户点"生成网站" → 生成 microsite
```

---

## 技术背景

### 现有架构
- **Server Action**：`compileIntentV2Action` → 返回 `{ intent, formFields, costCents }`
- **Client Component**：`ProjectCompileV2Card` — 管理 compile 状态
- **类型**：`CompiledIntentV2`, `FormBuilderResultV2`
- **Form Builder**：`buildFormFieldsFromRules(industry, scene)` — 推荐字段

### 关键文件
```
src/components/project-compile-v2-card.tsx     ← 主要修改
src/app/app/projects/compile-intent-v2-action.ts  ← 可能增加新的 server action
src/app/app/projects/[id]/page.tsx             ← 添加独立的生成按钮
```

---

## Task 1：Compile 面板增强

### 功能需求

#### 1.1 编辑模式
- 当用户看到编译结果时，提供"编辑"按钮
- 点击后打开编辑面板：
  - 选择 industry（radio/select）
  - 选择 scene（radio/select，根据 industry 动态变化）
- 提供"重新编译"按钮 → 调用 `compileIntentV2Action`
- 新的编译结果自动刷新字段推荐

#### 1.2 字段推荐动态更新
- 用户修改 `scene` → 立即调用 `buildFormFieldsFromRules(industry, new_scene)`
- 界面上的推荐字段实时更新
- 显示新的 `confidence` 百分比

#### 1.3 确认与保存
- "✅ 确认并保存"按钮只有在用户确认后才激活
- 调用 `confirmIntentV2Action` 保存到数据库

#### 1.4 编辑历史（可选，低优先级）
- 显示"版本 1/2" — 用户曾经修改过参数
- 可以回滚到上一版本（后期 task）

### UI 结构

```
┌─────────────────────────────────────────┐
│ Compile v0.4 Hybrid                     │
├─────────────────────────────────────────┤
│                                         │
│ [编辑结果区域]                           │
│ ┌──────────────────────────────────┐   │
│ │ Industry: real_estate            │   │
│ │ Scene: property_listing          │   │
│ │ Language: both                   │   │
│ │ [编辑按钮]                        │   │
│ └──────────────────────────────────┘   │
│                                         │
│ [推荐字段]                               │
│ 🎯 推荐字段 (95% 匹配) — 8 个字段       │
│ [field1] [field2] [field3] ...         │
│                                         │
│ ┌─[确认保存按钮]─────────────────────┐ │
│ └────────────────────────────────────┘ │
│                                         │
│ ─── 编辑面板（hidden 初始化）──        │
│ ┌──────────────────────────────────┐   │
│ │ 选择行业:                         │   │
│ │ ○ Real estate   ○ Immigration    │   │
│ │                                  │   │
│ │ 选择场景:                         │   │
│ │ ○ property_listing               │   │
│ │ ○ open_home_event                │   │
│ │ ○ market_update                  │   │
│ │                                  │   │
│ │ [重新编译按钮] [取消按钮]         │   │
│ └──────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### 实现细节

#### State 变化
```typescript
type CompileState = "idle" | "compiling" | "compiled" | "editing" | "confirming" | "confirmed";

// 新增：
- editMode: boolean — 编辑面板显示/隐藏
- pendingIndustry: string | null — 编辑中的行业
- pendingScene: string | null — 编辑中的场景
```

#### 交互流
```
[输入 prompt]
  ↓ handleCompile
state = "compiling" → "compiled"
intent & formFields 存储到 state
displayIntent = intent
  ↓ 显示编译结果 + "编辑"按钮

[用户点"编辑"]
  ↓ toggleEditMode
editMode = true
pendingIndustry = intent.industry
pendingScene = intent.scene
  ↓ 显示编辑面板

[用户修改 scene]
  ↓ handleSceneChange
pendingScene = newScene
derivedFields = buildFormFieldsFromRules(pendingIndustry, pendingScene)
  ↓ 实时更新推荐字段显示

[用户点"重新编译"]
  ↓ handleRecompile
state = "compiling"
调用 compileIntentV2Action 用 pendingIndustry/pendingScene
  ↓ state = "compiled"
intent, formFields 更新为新的编译结果
editMode = false
  ↓ 显示新的结果

[用户点"✅ 确认保存"]
  ↓ handleConfirm
state = "confirming"
调用 confirmIntentV2Action
  ↓ state = "confirmed"
显示成功消息
```

---

## Task 3：生成网站与 Compile 解耦

### 功能需求

#### 3.1 分离按钮
- **Compile 卡片**：只负责编译和确认
- **生成网站按钮**：独立显示（在 Intent Confirmed 后）
  - 位置：Compile 卡片下方 或 新的"生成"卡片
  - 按钮文本："📄 生成网站草稿"
  - 状态：`disabled` 如果没有 compiled_intent_v2 或 user_confirmed = false

#### 3.2 生成流程
```
用户点"生成网站草稿" → 调用 generateMicrositeAction
  ↓ show "⏳ 生成中..."
  ↓ 完成后显示 "✅ 生成完毕，进入编辑"
  ↓ 显示预览或跳转到编辑页面
```

#### 3.3 状态检查
- 不显示"生成网站"按钮 if `!compiledIntentV2 || !compiledIntentV2.user_confirmed`
- 显示提示："先在上方编译并确认意图，再生成网站"

### 实现位置

**选项 A**：在 `ProjectCompileV2Card` 中
```
这样做的好处：logically grouped
缺点：卡片会很长
```

**选项 B**（推荐）：在主 page.tsx 中，Compile 卡片下方
```typescript
{compiledIntentV2?.user_confirmed && (
  <section id="workflow-generate" className="...">
    <GenerateMicrositeCard
      projectId={projectId}
      compiledIntentV2={compiledIntentV2}
    />
  </section>
)}
```

---

## 实现清单

### Phase 4.1 Task 1（Compile 面板）

- [ ] 修改 `src/components/project-compile-v2-card.tsx`
  - [ ] 增加 `editMode`, `pendingIndustry`, `pendingScene` state
  - [ ] 实现 `toggleEditMode()` 函数
  - [ ] 实现 `handleSceneChange()` 动态更新字段
  - [ ] 实现 `handleRecompile()` 重新调用编译
  - [ ] 编辑面板 UI（industry/scene selector）
  - [ ] 重编译按钮 + 取消按钮
  - [ ] 编译结果显示"编辑"按钮

- [ ] 修改 `src/app/app/projects/compile-intent-v2-action.ts`
  - [ ] 如果需要，增加支持部分参数更新的 server action（可选，目前直接重新编译）

- [ ] 测试
  - [ ] 输入 prompt → 编译 ✅
  - [ ] 点"编辑" → 打开编辑面板 ✅
  - [ ] 修改 scene → 字段实时更新 ✅
  - [ ] 点"重新编译" → 新结果显示 ✅
  - [ ] 点"确认保存" → 保存到数据库 ✅

### Phase 4.1 Task 3（解耦生成）

- [ ] 创建新组件 `src/components/generate-microsite-card.tsx`（可选）
  - [ ] 显示"生成网站"按钮
  - [ ] 调用 generateMicrositeAction（已有）
  - [ ] 显示生成进度

- [ ] 修改 `src/app/app/projects/[id]/page.tsx`
  - [ ] 在 Compile 卡片下方添加生成网站的调用
  - [ ] 只有当 `compiledIntentV2?.user_confirmed` 时才显示

- [ ] 测试
  - [ ] Compile 卡片不自动生成网站 ✅
  - [ ] 只有确认后才显示"生成网站"按钮 ✅
  - [ ] 点"生成网站"能成功生成 ✅

---

## 技术细节

### FormBuilder 动态调用
```typescript
import { buildFormFieldsFromRules } from "@/lib/generation/llm-form-builder";

// 在编辑场景时
const newFields = useMemo(() => {
  if (pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  return formFields;
}, [pendingIndustry, pendingScene, formFields]);
```

### Server Action 保持不变
```typescript
// compileIntentV2Action 已经支持完整的编译
// 只需要调用一次，不需要改参数
await compileIntentV2Action(rawPrompt, projectId)
  → 调用 Rule Guard + LLM + FormBuilder
  → 返回完整的编译结果
```

---

## 验收标准（DoD）

### Task 1 完成条件
- ✅ `npm run build` 通过
- ✅ `npm run test` 所有测试通过（16/16）
- ✅ 在浏览器中完整流程测试：
  - 输入 prompt
  - 编译成功
  - 点"编辑"打开编辑面板
  - 修改 scene → 字段实时更新
  - 重新编译 → 结果更新
  - 确认保存 → 数据库有数据
- ✅ UI 无错误，加载状态清晰
- ✅ 所有错误消息友好（中文）

### Task 3 完成条件
- ✅ Compile 卡片不再自动生成网站
- ✅ 只有 `user_confirmed = true` 时显示"生成网站"按钮
- ✅ 点"生成网站"能成功触发生成
- ✅ 生成进度显示清晰

---

## 禁止事项

❌ 不要修改 `compileIntentV2Action` 的签名
❌ 不要删除现有的测试
❌ 不要引入新的依赖（除非必须）
❌ 不要改变数据库 schema
❌ 不要硬编码 industry/scene 列表（使用现有的枚举）

---

## 后续（Task 4、Task 2）

这次不做：
- ❌ Intent 历史版本追踪（Task 2）
- ❌ 完整的编辑历史回滚

---

## 提示词版本

**给 Cursor 的最终提示词**：

```
### HiBiz Phase 4.1 — Compile 面板重构（Task 1 + Task 3）

**目标**：
1. 增强 Compile 卡片：允许用户编辑 industry/scene 参数，重新编译
2. 解耦生成：Compile 确认后，单独显示"生成网站"按钮

**修改文件**：
- src/components/project-compile-v2-card.tsx
- src/app/app/projects/[id]/page.tsx

**任务 1 - Compile 面板增强**：
- 编译后显示结果（industry, scene, language）+ "编辑"按钮
- 点"编辑"打开编辑面板（industry/scene selector）
- 用户修改 scene → 立即调用 buildFormFieldsFromRules 更新推荐字段
- 点"重新编译"→ 调用 compileIntentV2Action
- 点"✅ 确认保存" → 调用 confirmIntentV2Action

**任务 3 - 解耦生成**：
- ProjectCompileV2Card 不再自动生成网站
- 在 page.tsx 中，Compile 卡片下方添加"生成网站"按钮
- 只有 compiledIntentV2?.user_confirmed 时才显示按钮
- 点"生成网站"调用现有的 generateMicrositeAction

**关键组件**：
- buildFormFieldsFromRules：推荐字段动态计算（无 API 调用）
- compileIntentV2Action：完整编译（已有）
- confirmIntentV2Action：保存到 DB（已有）
- generateMicrositeAction：生成网站（已有）

**验收标准**：
✅ npm run build 通过
✅ npm run test 16/16 通过
✅ 完整流程测试：编辑 → 重编 → 确认 → 生成
✅ UI 清晰，错误信息友好（中文）

**不要做**：
❌ 修改 server action 签名
❌ 改变数据库 schema
❌ 删除现有测试
❌ 实现 Intent 历史版本（Task 2）

---

让我们开始吧！
```

---

## 参考代码片段

### FormBuilder 导入示例
```typescript
import { buildFormFieldsFromRules } from "@/lib/generation/llm-form-builder";
import type { FormBuilderResultV2 } from "@/types/form-builder";
```

### useMemo 实时更新字段示例
```typescript
const derivedFields = useMemo((): FormBuilderResultV2 | null => {
  if (pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  if (formFields) return formFields;
  if (savedIntent) {
    return buildFormFieldsFromRules(savedIntent.industry, savedIntent.scene);
  }
  return null;
}, [pendingIndustry, pendingScene, formFields, savedIntent]);
```

---

**准备好了吗？把这份文档发给 Cursor，开始编码！** 🚀
