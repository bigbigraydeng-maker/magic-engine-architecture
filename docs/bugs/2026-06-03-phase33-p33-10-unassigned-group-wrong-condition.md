# Bug: Phase 33 P33.10 「未归类 Actions」分组永远不显示

> 发现日期：2026-06-03  
> 报告人：PM（CTS 执行看板测试时发现）  
> 严重程度：🟡 中（功能不可见，但不影响数据）  
> 影响 Phase：**Phase 33 P33.10 自身 bug**  
> 复现率：100%

## 现象

CTS 执行看板，激活 Goal filter（点「CTS ME营销Wave 1」）后：
- 顶部 chips 数字（38/11/20）没变化 ✅（filter 真的没排除 null initiative_id 项，符合 P33.10 设计）
- 但 Kanban 下方应该出现的「📥 未归类 Actions」分组**不显示** ❌

## 根因

Phase 33 P33.10 代码（`page.tsx:2537`）判断未归类用的是：
```js
i.initiative_id === null
```

但 **Phase 31 migration（`20260619000003_phase31_strategy_layer_foundation.sql:218-256`）已经把所有老 actions 自动绑定到了 "Unassigned Backlog" placeholder Initiative**（`initiative_type='unassigned'`）。

所以现实数据：
- 老 actions `initiative_id` 都**不是 null**，而是指向 placeholder initiative 的 UUID
- 新 actions（如果有）才会是 null
- → 我的判断条件永远 false，分组永远不显示

## 正确判断

应该是「**指向 unassigned 类型 Initiative 的 actions**」+ 「**真 null 的 actions**」一起算未归类。

```js
// 修复后逻辑
const isUnassigned = (item) =>
  item.initiative_id === null ||
  unassignedInitiativeIds.has(item.initiative_id)
```

其中 `unassignedInitiativeIds` 需要从 `/api/clients/[id]/initiatives` 返回（但目前 endpoint **过滤掉了 unassigned 类型** —— 见 `route.ts:42`：`.filter(r => r.initiative_type !== 'unassigned')`）。

## 修复方案

**Option A（推荐）**：endpoint 返回所有 initiative（包括 unassigned），前端区分用 `initiative_type === 'unassigned'`  
- 改 `/api/clients/[id]/initiatives` 不过滤
- 前端在 `initiativeMap` 加载时另外构建 `unassignedInitiativeIds` Set
- P33.10 判断条件改为同时检查 null + unassigned 类型
- 工作量：30 min

**Option B**：另开 `/api/clients/[id]/unassigned-initiatives` 专门返回 unassigned bucket（项目里已有 `/unassigned-actions`，可参考）  
- 工作量：20 min

**Option C（最小改动）**：直接在 `/api/clients/[id]/initiatives` 加 query 参数 `?include_unassigned=true`  
- 工作量：10 min

## 待办

- [ ] 选 Option 修复 P33.10 判断条件
- [ ] 测试：CTS Goal filter 激活后看到「未归类」分组（应有大量条目）
- [ ] 测试：bulk-assign 某个 action 到真 Initiative 后，该 action 从「未归类」消失

## 验证 SQL（提供给 PM 在 Supabase 跑确认）

```sql
-- 验证 CTS 所有 action 的 initiative 归属
SELECT
  ei.id,
  ei.title,
  ei.initiative_id,
  i.title as initiative_title,
  i.initiative_type
FROM execution_items ei
LEFT JOIN initiatives i ON i.id = ei.initiative_id
WHERE ei.client_id = 'c0000000-0000-0000-0000-000000000000'  -- CTS
LIMIT 10;
```

预期：所有行 `initiative_type` 都是 `'unassigned'`（除非 FDE 手动迁移过）。

## 关联

- 不阻塞 Phase 33 主功能（Goal filter UI / Initiative badge 都正常）
- 阻塞「FDE 看到未归类提示 → 主动去 Goal 页面归类」的引导流程
