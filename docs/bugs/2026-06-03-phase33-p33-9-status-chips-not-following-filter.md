# Bug: Phase 33 P33.9 Kanban 状态 chips 数字不跟 Goal filter 变化

> 发现日期：2026-06-03  
> 报告人：PM（CTS 执行看板测试）  
> 严重程度：🟡 中（UI 误导，但 filter 本身工作）  
> 影响 Phase：**Phase 33 P33.9 UI 一致性**  
> 复现率：100%

## 现象

CTS 执行看板，激活 Goal filter「CTS ME营销Wave 1」后：
- ✅ Filter 真生效（下方 action 列表正确缩减到该 Goal 旗下 2 条）
- ❌ 顶部状态 chips（待处理 38 / 进行中 11 / 已完成 20）**数字没变化**
- 结果：FDE 看顶部数字会误以为 filter 没生效

## 根因

`page.tsx:2390-2393` 状态 chips 计数器用的是 `items`（全部）而不是 `filteredItems`（filter 后）：

```js
const counts: Record<string, number> = {
  pending:     items.filter(i => i.status === 'pending').length,   // 应该用 filteredItems
  in_progress: items.filter(i => i.status === 'in_progress').length,
  completed:   items.filter(i => i.status === 'completed').length,
}
```

## 修复方案

把 `items` 改成 `filteredItems`（但需要先 unset goalFilter/statusFilter，否则 statusFilter 自身会循环影响数字）。

更准确：counts 应基于「应用 dimension + goal filter 但不应用 status filter」的中间结果。

```js
// 修正版 — 在 filteredItems 计算里抽出 statusFilter 之前的中间状态
const filteredWithoutStatus = (() => {
  let r = activeDimension === 'all' ? items : items.filter(i => i.dimension === activeDimension)
  if (goalFilter !== 'all') {
    const ids = goalInitiativeIds.get(goalFilter)
    if (ids) r = r.filter(i => i.initiative_id === null || ids.has(i.initiative_id))
  }
  return r
})()

const counts = {
  pending:     filteredWithoutStatus.filter(i => i.status === 'pending').length,
  in_progress: filteredWithoutStatus.filter(i => i.status === 'in_progress').length,
  completed:   filteredWithoutStatus.filter(i => i.status === 'completed').length,
}
```

工作量：15 min

## 关联

- 不阻塞 filter 主功能
- 与 [P33.10 unassigned bug](./2026-06-03-phase33-p33-10-unassigned-group-wrong-condition.md) 是相邻文件，可以一起修
