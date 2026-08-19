# ADR: Reversibility / Recovery 契约（ME2 广告中枢 v1）

**状态：DRAFT，等 A 级设计复审（子牙 + 魏征）——未经复审，Day 2 不得实施**
**日期**：2026-08-20
**关联**：Codex 复审 BLOCKER #5（`reversible:true` 不诚实）+ MAJOR #7/#8/#9（verification 缺失、
partial success 无恢复协议、ActionDefinition 字段不全）

## 背景

Day 1 计划草稿把 boost 广告的 Kernel `ActionDefinition` 标成 `reversible: true` +
`rollback: 'provider_native'`（意思是"失败了 pause 一下就撤回了"）。Codex 复审指出这不诚实：

- Pause 能停止**未来**的展示/点击/花费
- Pause **不能**撤回已经产生的展示、点击、已扣的钱
- 三层对象（campaign/adset/ad）建到一半失败，"部分成功"是一种真实存在的状态，
  不是"要么全成要么全不成"

## 决策

### 1. `reversibilityScope`（新字段，不改现有 `reversible: boolean`）

```typescript
type ReversibilityScope = {
  futureDelivery: 'reversible_via_pause' | 'irreversible'
  incurredSpend: 'reversible' | 'irreversible'
  externalArtifacts: 'reversible_via_delete' | 'irreversible' | 'kept'
}
```

`ads.meta_boost_sandbox_reel` 的取值：
```typescript
reversibilityScope: {
  futureDelivery: 'reversible_via_pause',   // Kernel 能拦住未来花费
  incurredSpend: 'irreversible',             // 已花的钱撤不回，PM 批准前必须知道这点
  externalArtifacts: 'reversible_via_delete', // 暂停的 campaign/adset/ad 可以手动删
}
```

`outward-authorization.ts` 校验：`sideEffect='outward'` 的 ActionDefinition **必须**同时提供
`reversibilityScope`，不能只给一个笼统的 `reversible: true`。

### 2. `verification`（Kernel 独立必填契约，不是 gate step 兼职）

```typescript
verification: {
  provider_object_exists: (runResult) => Promise<boolean>
  matches_approved_snapshot: (runResult, snapshot) => Promise<{ok: boolean, diff?: string[]}>
  delivery_state_reached: (runResult) => Promise<'delivering' | 'in_review' | 'rejected' | 'unknown'>
  link_registered: (runResult) => Promise<boolean>
}
```

`activate` step 成功后，Kernel **立即**（不是等每日 cron）跑这四条。任一失败 →
`action_runs.status = 'verification_failed'` → 转人工待办，不留 orphan 静默存在。

### 3. Recovery protocol（每步一个 reconcile probe）

- `publish_paused` 超时（不知道到底建成没建成）→ 用 `deterministicTag`
  （`ME-SANDBOX-<runId>`）反查 Meta：
  - 查到 0 个对象 → 安全重建
  - 每层查到 1 个 → 已建成，接续到下一步
  - 查到多个 / 数量不一致 → **转人工**，不猜、不自动选一个
- `activate` 部分成功（三层里某一层挂了）→ **统一 pause 已激活的层**，然后转人工，
  待办里写清"哪层已经激活、哪层没有"
- 已建但最终判定失败的对象 → 进 orphan queue（不同于"删除"——orphan 是"存在但需要人处理"，
  删除是另一个更激进的动作，v1 不自动做）

### 4. ActionDefinition 补全字段

Codex 复审 #7 指出 Day 1 草稿的 ActionDefinition 缺 `title / inputSchema / outputSchema /
verification / retryPolicy.backoff / retryPolicy.baseMs`。v2 计划里已经把完整字段列出
（见 v2 计划 §Kernel 授权契约），本 ADR 补充的是"为什么 verification 和
reversibilityScope 必须是独立字段，不能塞进已有字段里蒙混过关"的论证。

## Reuse Statement

- 新增 platform-shared：`ReversibilityScope` type + `verification` 必填契约（Kernel `types.ts` /
  `outward-authorization.ts` 层面的升级），任何未来的 outward 动作都能用
- 不动：现有 outward action（如 `seo.build_publish_package`）—— v1 给它们填一个兜底
  `reversibilityScope` 值，不阻断，但需要在 A 级复审里明确这个兜底值是什么
- CTS-specific：无（这一层全是 Kernel 核心机制，不含任何客户语义）

## 开放问题（等 A 级复审拍板）

- [ ] 现有 outward action 的兜底 `reversibilityScope` 具体填什么值 —— 随便填一个能通过
      类型检查的值，还是需要真的去看每个现有 action 的语义补对应值
- [ ] `verification` 从"nullable"升成"outward 时必填"这个改动，会不会让某些现有测试
      （尤其是 `kernel/__tests__/architecture.test.ts` 里已有的断言）失败 —— Day 4/5
      如果真的动这层，需要先跑一次现有测试基线
- [ ] orphan queue 的"人工待办"具体走哪个管道 —— CLAUDE.md 铁律 3 要求"能自动化就必须
      自动化，做不到才下发人工任务"，orphan 处理是否有可能进一步自动化（比如自动删除
      pause 超过 N 天且从未激活过的对象），v1 暂时人工，但要留一条 ROADMAP 记录这个缺口
