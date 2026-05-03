# HiBiz Phase 4.2 — Task 4 + Task 2：字段动态更新 & Intent 历史版本

## 任务概述

**目标**：完善 Compile v0.4 工作流的两个重要功能：
1. **Task 4**：字段动态更新 — 用户修改 `scene` 时，推荐字段实时更新
2. **Task 2**：Intent 历史版本 — 记录用户编译历史，支持查看/回滚

**预期工作量**：2-3 小时
**交付物**：修改 2 个文件 + 通过所有测试

---

## 上下文回顾

### 现状（Phase 4.1 完成）
```
用户输入 prompt
  ↓
编译 → 显示结果
  ↓
用户可以"编辑" → 打开编辑面板
  ↓
修改 industry/scene → ??? 字段不会自动更新
  ↓
点"重新编译" → 显示新结果
  ↓
点"确认保存" → 保存单次编译结果
```

### Task 4 的改进
```
编辑面板中：
用户修改 scene: "property_listing" → "open_home_event"
  ↓ 立即调用 buildFormFieldsFromRules("real_estate", "open_home_event")
  ↓ UI 实时更新推荐字段（显示新的 8 个字段）
```

### Task 2 的改进
```
编译历史追踪：
版本 1：industry=real_estate, scene=property_listing
版本 2：industry=real_estate, scene=open_home_event（修改后重编）
版本 3：industry=real_estate, scene=market_update（再次修改）

用户可以看到：
- 当前版本：3/3
- 历史版本列表
- 可以"回滚"到版本 1 或 2
```

---

## Task 4：字段动态更新

### 功能需求

#### 4.1 编辑面板中的动态字段更新
```
当前状态：
- 用户在编辑面板选择 scene
- 点"重新编译"才能看到新字段

改为：
- 用户在编辑面板选择 scene
- 立即显示该 scene 对应的推荐字段（无需点"重新编译"）
- 然后才点"重新编译"真正编译
```

#### 4.2 UI 优化
```
编辑面板：
┌─────────────────────────────────┐
│ 选择行业:                        │
│ ○ Real estate   ○ Immigration   │
│                                 │
│ 选择场景:                        │
│ ○ property_listing              │
│ ○ open_home_event               │  ← 用户选择这个
│ ○ market_update                 │
│                                 │
│ [预览字段] ← 新增：显示该场景   │
│ 推荐字段 (90% 匹配):             │
│ [name] [email] [phone] ...      │
│                                 │
│ [重新编译按钮] [取消按钮]       │
└─────────────────────────────────┘
```

#### 4.3 实现细节

**State 变化**：
```typescript
const [pendingIndustry, setPendingIndustry] = useState<string | null>(null);
const [pendingScene, setPendingScene] = useState<string | null>(null);

// ← 新增：在编辑模式下，实时计算预览字段
const previewFields = useMemo(() => {
  if (pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  return null;
}, [pendingIndustry, pendingScene]);
```

**事件处理**：
```typescript
const handleSceneChange = (newScene: string) => {
  setPendingScene(newScene);
  // previewFields 自动通过 useMemo 更新
};

const handleIndustryChange = (newIndustry: string) => {
  setPendingIndustry(newIndustry);
  setPendingScene(null); // 重置 scene，因为不同行业有不同的场景
};
```

**UI 渲染**：
```typescript
{editMode && pendingIndustry && (
  <div className="mt-4 rounded-lg bg-blue-50 p-3 border border-blue-200">
    <p className="text-sm font-medium text-blue-900 mb-2">🎯 预览推荐字段</p>
    {previewFields ? (
      <ul className="flex flex-wrap gap-2">
        {previewFields.selected_fields.map((f) => (
          <li key={f.id} className="text-xs bg-blue-100 text-blue-900 px-2 py-1 rounded">
            {f.label}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-xs text-blue-700">选择行业和场景后显示</p>
    )}
  </div>
)}
```

---

## Task 2：Intent 历史版本

### 功能需求

#### 2.1 数据结构升级
```typescript
// projects.compiled_intent_v2 现在包含：
{
  schema_version: 2,

  // 当前版本指针
  current_version: 2,

  // 历史版本数组
  revisions: [
    {
      version: 1,
      intent: { industry, scene, language, ... },
      confirmed_at: "2026-04-07T10:00:00Z",
      created_at: "2026-04-07T09:50:00Z"
    },
    {
      version: 2,
      intent: { industry, scene, language, ... }, // 修改后的
      confirmed_at: "2026-04-07T10:15:00Z",
      created_at: "2026-04-07T10:10:00Z"
    }
  ]
}
```

#### 2.2 UI 显示
```
Compile 结果区域：
┌────────────────────────────────┐
│ 当前版本：2/2                  │
│ 最后更新：2026-04-07 10:15    │
│                                │
│ Industry: real_estate          │
│ Scene: open_home_event         │
│ Language: both                 │
│                                │
│ [编辑] [查看历史版本]          │ ← 新增
└────────────────────────────────┘

点击"查看历史版本"后：
┌────────────────────────────────┐
│ 版本历史                        │
├────────────────────────────────┤
│ ✓ v2 (当前) - real_estate      │
│           open_home_event      │
│   确认时间：10:15              │
│   [回滚到此版本]                │
│                                │
│ v1 - real_estate               │
│      property_listing          │
│   确认时间：09:50              │
│   [回滚到此版本]                │
└────────────────────────────────┘
```

#### 2.3 回滚功能
```typescript
const handleRollbackToVersion = async (versionNumber: number) => {
  const targetVersion = compiledIntentV2.revisions.find(
    (r) => r.version === versionNumber
  );
  if (!targetVersion) return;

  // 确认保存这个历史版本为新的当前版本
  await confirmIntentV2Action(projectId, targetVersion.intent);
  // 数据库会添加新的 revision，而不是修改历史记录
};
```

### 2.4 数据库考虑
```
projects.compiled_intent_v2 类型保持为 jsonb
但现在内部结构变为：
{
  schema_version: 2,
  current_version: number,
  revisions: array,
  // ... 向后兼容 v1 的字段
}

迁移策略：
- 旧的 v1 intent 读取时，自动包装成 v2 格式
- 新的编译结果始终用 v2 格式保存
```

---

## 实现清单

### Task 4（字段动态更新）

- [ ] 修改 `src/components/project-compile-v2-card.tsx`
  - [ ] 新增 `previewFields` state（useMemo 计算）
  - [ ] 编辑面板中显示"预览字段"区域
  - [ ] 修改 scene 时立即更新预览（无需重编）
  - [ ] UI：蓝色预览框，显示 confidence % 和字段列表

- [ ] 测试
  - [ ] 编辑面板打开后，修改 scene → 预览字段实时更新 ✅
  - [ ] 不同 scene 显示不同的字段 ✅
  - [ ] 字段匹配度（confidence）正确显示 ✅

### Task 2（Intent 历史版本）

- [ ] 修改 `src/types/compiled-intent-v2.ts`
  - [ ] 升级 `CompiledIntentV2` 到 schema_version 2
  - [ ] 新增 `current_version: number`
  - [ ] 新增 `revisions: Array<{ version, intent, confirmed_at, created_at }>`

- [ ] 修改 `src/components/project-compile-v2-card.tsx`
  - [ ] 编译结果顶部显示"版本 N/M"
  - [ ] 添加"查看历史版本"按钮
  - [ ] 版本历史模态框（显示所有版本）
  - [ ] 每个版本有"回滚"按钮

- [ ] 修改 `src/app/app/projects/compile-intent-v2-action.ts`
  - [ ] `confirmIntentV2Action` 增强：
    - 判断是否存在旧的 revisions
    - 如果存在，追加新版本（version + 1）
    - 更新 current_version 指针
    - 保持历史记录不变

- [ ] 向后兼容
  - [ ] 读取旧的 v1 intent 时，自动转换成 v2 格式
  - [ ] `parseCompiledIntentV2` 中处理兼容逻辑

- [ ] 测试
  - [ ] 首次编译 → 创建 v1 revision ✅
  - [ ] 再次编译并确认 → 创建 v2 revision ✅
  - [ ] 显示"版本 2/2" ✅
  - [ ] 点"回滚"到 v1 → 变成"版本 1/2"（新的当前版本，旧版本推到历史） ✅
  - [ ] 版本历史完整记录所有操作 ✅

---

## 关键代码示例

### Task 4：预览字段更新
```typescript
import { buildFormFieldsFromRules } from "@/lib/generation/llm-form-builder";

// 在 ProjectCompileV2Card 中：
const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  return null;
}, [editMode, pendingIndustry, pendingScene]);
```

### Task 2：版本历史结构
```typescript
type CompiledIntentV2Revision = {
  version: number;
  intent: Omit<CompiledIntentV2, 'revisions' | 'current_version'>;
  confirmed_at: string; // ISO 8601
  created_at: string;   // ISO 8601
};

interface CompiledIntentV2 {
  schema_version: 2;
  current_version: number;
  revisions: CompiledIntentV2Revision[];
  // ... 其他字段
}
```

### Task 2：确认时添加历史
```typescript
export async function confirmIntentV2Action(projectId: string, intent: CompiledIntentV2): Promise<void> {
  // ... 验证逻辑

  const supabase = createClient();

  // 获取现有的历史
  const { data: current } = await supabase
    .from("projects")
    .select("compiled_intent_v2")
    .eq("id", projectId)
    .maybeSingle();

  const existing = parseCompiledIntentV2(current?.compiled_intent_v2);

  // 构建新的 revisions
  let newRevisions: CompiledIntentV2Revision[] = [];
  let newVersion = 1;

  if (existing?.revisions?.length > 0) {
    newRevisions = existing.revisions;
    newVersion = existing.current_version + 1;
  }

  // 追加新版本
  const now = new Date().toISOString();
  newRevisions.push({
    version: newVersion,
    intent: { ...intent, user_confirmed: true },
    confirmed_at: now,
    created_at: now
  });

  // 保存
  const merged: CompiledIntentV2 = {
    schema_version: 2,
    current_version: newVersion,
    revisions: newRevisions,
    // ...其他字段
  };

  await supabase
    .from("projects")
    .update({ compiled_intent_v2: merged })
    .eq("id", projectId);
}
```

---

## 验收标准

### Task 4 完成条件
- ✅ 编辑面板打开后，修改 scene → 推荐字段立即更新（无需重编）
- ✅ 不同 scene 显示不同字段数量和内容
- ✅ 字段匹配度百分比正确
- ✅ UI 清晰，蓝色预览框易于区分

### Task 2 完成条件
- ✅ 首次编译确认 → 创建 revision v1
- ✅ 再次编译确认 → 创建 revision v2
- ✅ 显示"版本 2/2"和最后更新时间
- ✅ 版本历史模态框显示所有版本
- ✅ 回滚功能正常：点"回滚"→ 该版本变成当前版本
- ✅ `npm run build` 通过
- ✅ `npm run test` 16/16 通过（无新增测试需求）

---

## 禁止事项

❌ 不要修改 Supabase schema（使用现有 jsonb 字段）
❌ 不要删除现有测试
❌ 不要改变 `buildFormFieldsFromRules` 的签名
❌ 不要硬编码版本号逻辑
❌ 不要破坏向后兼容性

---

## Cursor 最终提示词

```
### HiBiz Phase 4.2 — Task 4 + Task 2：字段动态更新 & Intent 历史版本

**目标**：
1. Task 4：编辑 scene 时，推荐字段实时更新（无需点"重新编译"）
2. Task 2：记录编译历史（revisions），支持查看和回滚

**修改文件**（共 2 个）：
- src/components/project-compile-v2-card.tsx
- src/types/compiled-intent-v2.ts（升级 schema）
- src/app/app/projects/compile-intent-v2-action.ts（历史管理）

---

## Task 4：字段动态更新

**核心逻辑**：
```typescript
const previewFields = useMemo(() => {
  if (editMode && pendingIndustry && pendingScene) {
    return buildFormFieldsFromRules(pendingIndustry, pendingScene);
  }
  return null;
}, [editMode, pendingIndustry, pendingScene]);
```

**UI 变化**：
- 编辑面板中新增"预览字段"区域（蓝色框）
- 用户修改 scene → 预览字段立即更新
- 显示 confidence % 和字段列表

---

## Task 2：Intent 历史版本

**数据结构升级**：
```typescript
interface CompiledIntentV2 {
  schema_version: 2,
  current_version: number,     // 当前版本指针（1, 2, 3...）
  revisions: [                 // 历史版本数组
    {
      version: 1,
      intent: { ... },
      confirmed_at: "ISO8601",
      created_at: "ISO8601"
    },
    ...
  ]
}
```

**UI 变化**：
- Compile 结果顶部显示"版本 2/2"和最后更新时间
- 新增"查看历史版本"按钮
- 版本历史模态框：列出所有版本 + 回滚功能

**Server Action 增强**：
- confirmIntentV2Action：
  - 检查现有的 revisions
  - 追加新版本（version + 1）
  - 更新 current_version 指针
  - 保持历史记录完整

---

## 验收标准：
✅ npm run build 通过
✅ npm run test 16/16 通过
✅ Task 4：修改 scene → 预览字段实时更新
✅ Task 2：版本历史完整，回滚功能正常
✅ 向后兼容旧的 v1 intent

## 不要做：
❌ 改变 Supabase schema（用现有 jsonb）
❌ 删除现有测试
❌ 硬编码版本逻辑
❌ 破坏向后兼容性

---

让我们开始吧！
```

---

## 文件修改概览

| 文件 | 修改内容 | 行数估算 |
|------|---------|---------|
| `project-compile-v2-card.tsx` | previewFields useMemo + 编辑面板 UI + 历史版本模态框 | +150 行 |
| `compiled-intent-v2.ts` | 升级到 schema 2，增加 revisions 类型 | +40 行 |
| `compile-intent-v2-action.ts` | confirmIntentV2Action 增强历史管理 | +50 行 |

---

**准备好了吗？把这份文档发给 Cursor，开始编码！** 🚀
