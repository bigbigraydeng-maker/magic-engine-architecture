# ME2 · Kernel Outward Execution Hardening —— v1.0 spec (Draft, awaiting PM approval)

**Status**: **Draft** —— spec only, no code. GO BUILD 之前不写实现。
**Author window**: `magic-engine-gate-reviewer-2887e4`
**Repository Fact Gate**: main = `2f1b097c055e34575391770ac8b796db370fb07c` (fetched 2026-08-19T03:41:50Z)
**Depends on**: Kernel v1 (`src/lib/kernel/**`) —— 全部已在 main
**Blocks**: 启用 `page.apply_optimization_request`（[spec](2026-08-19-me2-page-optimization-apply-action-v1.0.md) §18.1 A/B 项）——本 spec 落地前，PR #1097 保持 Draft、不启用

---

## 0. 一句话

**Kernel 层只做两件事**：

- **A · Authorized Input Pinning** —— 授权时对**完整** `action_runs.input` 做 canonical hash 落进 `authorization_decisions.policy_snapshot.input_hash`；Gateway 在 mint `AuthorizedExecutionContext` 前重算并**严格相等**，不等 = fail-closed
- **B · Provider-native rollback on outward failure** —— 已经产生 outward 副作用之后进入需要回滚的失败路径时，Kernel runner 调用 capability **显式暴露**的 rollback handler；rollback 结果进 lineage；rollback 失败 = run 仍在 `dead_letter`，**绝不**伪装成安全结束

只做这两件事。不做别的（详见 §7 non-goals）。

---

## 1. 为什么现在必须落

PR #1097 Round 1 review 三个 reviewer 汇聚出两个 Kernel 层的**真攻击面**，capability 层无法自修：

### 1.1 A · Authorized Input Pinning —— 狄仁杰 Attack #1

**攻击路径**（原文引自 review）：
> run 由 agent 创建 intents=[{field:'meta_title',value:'X'}]，human 看到 X 后批准。批准后但 prepare 前，往 `action_runs.input` 打 UPDATE 把 intents 换成 `[{field:'meta_description',value:'REPLACE'}]`，同时把 `validated_diff_hash` 一起换成 `canonicalDiffHash([新 diff])`。preflight schema 只检查数组类型，prepare 的 §4.1 hash 重算基于 `input.intents` 现场重算，**自我一致 → 通过**。最终 PR 内容与 human 授权时看到的完全不同。

**根因**：`authorization_decisions.policy_snapshot`（[src/lib/kernel/authorize.ts:66-116](../../src/lib/kernel/authorize.ts:66)）只 snapshot policy + definition 元数据，**不含 input 任何指纹**。capability 层能做的最强动作是"input 自我一致"，无法验证"input 与 human 授权时看到的一致"。

**为什么不能只 pin `intents` 局部字段**：
- 未来 action 的 input 结构未知，任何"只 pin 某字段"的实现都会给"其它字段被静默篡改"留出攻击面
- Kernel 应该**对整个 input 负责**，不假设知道每个 action 的 input schema 语义
- 一个 canonical hash 覆盖整个 input，无字段级歧义

### 1.2 B · Provider-native rollback —— 狄仁杰 Attack #3

**攻击路径**（原文引自 review）：
> prepare 读 main blob=X 通过。commit 时重取 `getBranchSha(main)` 得到 Y（main 被 force-push）。createBranch 从 Y 开分支。commitFile 用 blobSha=X ... 静默吞掉。open_pr 创建的 PR 就是"新分支 vs new-main"，diff 可能为空或非预期内容 ... record 步 ② 会挂 → dead_letter，**但 Draft PR 已经开在客户仓库里**。没有 rollback（close PR + delete branch）动作 —— spec §4.4 rollback: 'provider_native' 只是声明，capability 里没找到实现代码，dead_letter 不触发 close。

**注**：狄仁杰 Attack #2（commit 正则过宽）已在 Round 1 fix commit 关闭；但**已产生的 outward 副作用没被撤回**这条 Kernel 层缺口独立存在，任何 outward action 的任何 dead_letter 都会碰到。

**根因**：
- `OutwardAuthorization.rollback` 值仅是**声明**，Kernel runner ([src/lib/kernel/runner.ts:664-678](../../src/lib/kernel/runner.ts:664)) 在 run 进入 `dead_letter` 时只清租约、标 `needs_human=true`，**不调 provider 撤回**
- `CapabilityImplementation` ([src/lib/kernel/types.ts:435](../../src/lib/kernel/types.ts:435)) 只有 `steps: Record<stepKey, handler>`，**没有 rollback handler 字段**
- capability 层无处暴露 rollback；Kernel 层无处调用 rollback；两边都只等对方

---

## 2. Non-goals (v1 明确不做，未来另开 spec)

- ❌ **PageProviderAdapter 抽象**（子牙 Nit #2，v2 加 WordPress 时才做）
- ❌ **WordPress capability handler**
- ❌ **新 backlog / 新 cron**
- ❌ **Production migration apply**（本 spec 只出 migration 文件，不 apply；Production Readiness Gate 由 PM 触发）
- ❌ **ME `client_automation_policies` 首个 policy 记录**
- ❌ **ME `/geo` apply**（前置 gate 全过后由 PR #1097 承接）
- ❌ **rollback 之外的 outward-safety 议题**（限速 / 熔断 / audit alerting 等未来另开）
- ❌ **snapshot_restore 类型的 rollback**（v1 只覆盖 `provider_native`，`snapshot_restore` union 值保留但无消费方）

---

## 3. Section A · Authorized Input Pinning

### 3.1 数据形状

- **Hash 算法**：SHA-256（前 40 位 hex，与 shared runtime 内其它 canonical hash 一致，如 `computeBlogContentHash` [src/lib/capabilities/seo/build-publish-package.ts:63](../../src/lib/capabilities/seo/build-publish-package.ts:63)）
- **canonical 序列化**：JSON with sorted keys, no whitespace, no undefined —— 与 `src/lib/capabilities/page-apply-optimization/hash.ts:canonicalStringify` 同一算法（考虑抽到 `src/lib/kernel/canonical-hash.ts` 复用）
- **落进哪里**：`authorization_decisions.policy_snapshot.input_hash: string`（现有 JSON 列，无需 migration）

### 3.2 authorize.ts 改动

`snapshotOf()` ([src/lib/kernel/authorize.ts:66-116](../../src/lib/kernel/authorize.ts:66)) 签名扩展：

```ts
export function snapshotOf(
  policy: ClientAutomationPolicy | null,
  definition: ActionDefinition | null,
  runInput: Record<string, unknown>,   // 🔴 新增
): Record<string, unknown> {
  return {
    // ... 现有字段不动
    input_hash: canonicalHashOfInput(runInput),  // 🔴 新增
  }
}
```

`canonicalHashOfInput(input)` 新增到 `src/lib/kernel/canonical-hash.ts`（新文件；复用 capability 里的 `canonicalStringify` 逻辑，避免两处漂移）。

所有 `snapshotOf()` 调用点（[authorize.ts:192,465,501](../../src/lib/kernel/authorize.ts:192)）传入 `run.input`。

**幂等语义与既有 `idempotency_key` 的关系**：
- 现有 `idempotency_key` 只覆盖 `ActionDefinition.idempotency.keyFields` 里声明的**几个**字段
- 新增 `input_hash` 覆盖**整个** input（把"没声明为幂等键的字段"也一起 pin 住）
- 两者互补：idempotency_key 决定"这算不算同一件事"；input_hash 决定"这一件事的 input 有没有在授权后被动过"

### 3.3 gateway.ts 改动

Gateway 现有 `assertDecisionMatches()`（[src/lib/kernel/gateway.ts:135-176](../../src/lib/kernel/gateway.ts:135)）在 mint `AuthorizedExecutionContext` 前已经重读 decision 并核对 policy 一致性。**在同一位置加一条断言**：

```ts
// 🔴 A · Authorized Input Pinning：
//    重算 action_runs.input 的 canonical hash，跟授权时 pin 的比。
//    不等 = input 在授权后被篡改，fail-closed。
const currentInputHash = canonicalHashOfInput(run.input)
const pinnedInputHash = (decision.policy_snapshot as { input_hash?: string })?.input_hash
if (typeof pinnedInputHash !== 'string' || pinnedInputHash !== currentInputHash) {
  throw new KernelError('INPUT_TAMPERED_SINCE_AUTHORIZE', ...)
}
```

### 3.4 新 KernelErrorCode

`INPUT_TAMPERED_SINCE_AUTHORIZE` 加进 [src/lib/kernel/errors.ts:9-105](../../src/lib/kernel/errors.ts:9) union type。

**跟 `STALE_DECISION` 分开**是必须的：
- `STALE_DECISION` = 挂起期间**policy** 改过；刷一下重新签就能救
- `INPUT_TAMPERED_SINCE_AUTHORIZE` = **input** 被改过；不是"刷一下"能救的，需要**重新提交 run**（新 idempotency_key）
- 合成一个码，PM/审批面无法区分"改一下 policy 就能救"与"这次已经污染了要重来"

### 3.5 迁移与向后兼容

**已经存在的旧 decision 行**：`policy_snapshot.input_hash` 字段不存在（`undefined`）。Gateway 的断言写成"`typeof pinnedInputHash !== 'string'`" —— 对旧 decision 直接 fail-closed。

**为什么不引入 grace period / 只在新 decision 上强制**：
- Kernel v1 目前只有 `seo.build_publish_package` 一个动作在生产（且很少跑）
- 让旧 decision 一律 fail-closed 是**最保守**的：不会有"新代码放过一份该拦的旧决策"
- 需要重跑的极少数旧 decision，走 human-approval 走一遍就能获得带 input_hash 的新 decision

**无 Postgres migration**：`policy_snapshot` 是 `jsonb` 列，加字段不动 schema。

### 3.6 为什么"canonical hash of full input"而不是"immutable trigger on action_runs.input"

- **触发器**方案（`AFTER UPDATE OF input ... RAISE EXCEPTION`）：能挡直接 UPDATE，但**挡不住 Kernel 自己在 attempt/retry 时的合法更新**（如 `retry_count++`、`last_error` 写回）—— 除非精心区分列级触发。列级触发在 PostgreSQL 里需要针对每个 column 写规则，脆
- **hash 方案**：不管谁改了 input，Gateway 都当场发现。**根本不依赖数据库触发器**（可跨迁移、可跨 provider）
- **组合使用**（触发器 + hash）可行但**过度**：hash 一层已经 fail-closed，加触发器只是 defense-in-depth；v1 只做 hash，未来发现 hash 检查被绕过（如 Gateway 被 bypass）再谈触发器

---

## 4. Section B · Provider-native rollback on outward failure

### 4.1 数据形状

`CapabilityImplementation` ([src/lib/kernel/types.ts:435-440](../../src/lib/kernel/types.ts:435)) 扩展：

```ts
export interface CapabilityImplementation {
  readonly actionKey: ActionKey
  readonly version: number
  readonly steps: Readonly<Record<string, CapabilityStepHandler>>
  /**
   * 🔴 outward 动作**必须**声明；non-outward 动作可选。
   * Kernel runner 在以下情形调用：
   *   · run 进入 `dead_letter` 且至少有一个 step 已 succeeded
   *     （证明 outward 副作用可能已经产生）
   *   · run 进入 `failed` 且失败位置**在 sideEffect 已发生之后**
   *     （通过 step_key 判：本 spec §4.3 附一张判据表）
   */
  readonly rollback?: OutwardRollbackHandler
}

export type OutwardRollbackHandler = (
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
) => Promise<OutwardRollbackResult>

export interface OutwardRollbackResult {
  readonly ok: boolean
  readonly rollbackKind: 'provider_native' | 'noop'
  readonly detail: Readonly<Record<string, unknown>>
  readonly failure_reason?: string
}
```

### 4.2 runner.ts 改动

在 [src/lib/kernel/runner.ts:664-678](../../src/lib/kernel/runner.ts:664)（进 dead_letter 前）**插一段**：

```ts
// 🔴 B · Provider-native rollback：
//    如果 ActionDefinition 声明 outward + rollback:'provider_native'，
//    且 capability 提供了 rollback handler，且至少有一个 step 已 succeeded
//    （证明 outward 副作用可能已经产生）—— 在标 dead_letter 之前调 rollback。
const shouldRollback =
  definition.sideEffect === 'outward' &&
  definition.outwardAuthorization?.rollback === 'provider_native' &&
  typeof capability.rollback === 'function' &&
  hasAtLeastOneSucceededStep(run)

if (shouldRollback) {
  const rollbackResult = await capability.rollback(ctx, priorOutputs)
  // 🔴 rollback 结果**必须**进 lineage —— 存成一条 step_key='rollback' 的 action_run_steps
  await insertRollbackStep(run, rollbackResult)
  // 🔴 rollback 失败**不能**让 run 假装安全结束：
  //    - rollback.ok=false → run 仍在 dead_letter，且 last_error 明确说"outward 副作用未撤回"
  //    - rollback.ok=true  → run 仍在 dead_letter（原因是原 action 失败），但 last_error 补一句"outward 副作用已撤回"
  //    dead_letter 状态在**任何**情况下都不变成 succeeded；rollback 只影响 last_error 文案
}
```

**关键**：rollback 只**执行撤回**，**不改** run 的最终状态。原来 dead_letter 就还是 dead_letter；原来 failed 就还是 failed。这是刻意的 —— rollback 的成功不能被误读成"原 action 成功了"。

### 4.3 什么时候触发 rollback

**判据表**（严格）：

| run.status | 至少一个 step.status = succeeded | outward=true + rollback='provider_native' + capability.rollback? | 触发 rollback? |
|---|---|---|---|
| dead_letter | ✅ | ✅ | ✅ |
| dead_letter | ❌ | any | ❌（还没产生 outward 副作用）|
| failed | ✅ | ✅ | ✅ |
| failed | ❌ | any | ❌ |
| succeeded | any | any | ❌（正常路径）|
| denied / authorizing / pending_approval | any | any | ❌（没进入执行）|

**"至少一个 step succeeded"**：Kernel 只能这样近似判"outward 副作用是否已产生"。更精确的做法（每个 step 声明是否 outward-writing）是 v2 议题。v1 保守 —— 有一个 step 成功就当有可能已经写了。

### 4.4 rollback lineage：`action_run_steps` 一行

- `step_key = 'rollback'`
- `step_index = <max_existing_step_index> + 1`
- `status = 'succeeded' if rollbackResult.ok else 'failed'`
- `output = rollbackResult.detail`
- `verification = { method: 'rollback_integrity', passed: rollbackResult.ok, ... }`（**新** VerificationMethod，见 §4.5）
- `last_error = rollbackResult.failure_reason ?? null`

**为什么不新建 `action_run_rollbacks` 表**：现有 `action_run_steps` 就是 append-only 的执行轨迹表，rollback 是"这次执行的最后一段"，属于同一时间线。新表 = 新 migration + 新 RLS + 新查询路径。

### 4.5 新 VerificationMethod

`VerificationMethod` union（[src/lib/kernel/types.ts:128-137](../../src/lib/kernel/types.ts:128)）加 `'rollback_integrity'`。

判据：rollback handler 返回的 `ok: boolean`。verification.checks 由 handler 自己填。

### 4.6 GitHub v1 的 rollback handler（在 `page.apply_optimization_request` capability 里，另一个 PR 落）

**本 spec 只定义 Kernel 契约**，不实施 capability 侧的 handler。但为让 PM 审到 v1 的完整闭环，形状示意：

```ts
// src/lib/capabilities/page-apply-optimization/index.ts
export function createPageApplyOptimizationCapability(sb, deps): CapabilityImplementation {
  return {
    actionKey: 'page.apply_optimization_request',
    version: 1,
    steps: { prepare, commit, open_pr, record },
    rollback: async ({ ctx }, priorOutputs) => {
      const opened = priorOutputs.open_pr as OpenPrOutput | undefined
      const prep = priorOutputs.prepare as PrepareOutput | undefined
      const checks: VerificationResult['checks'] = []
      let prClosed = false, branchDeleted = false
      if (opened?.pr_number && prep) {
        try {
          await deps.createGithubClient(...).closePullRequest(prep.repo_owner, prep.repo_name, opened.pr_number)
          prClosed = true
        } catch (e) { /* record and continue to branch delete */ }
      }
      if (prep?.branch_name) {
        try {
          await deps.createGithubClient(...).deleteBranch(prep.repo_owner, prep.repo_name, prep.branch_name)
          branchDeleted = true
        } catch (e) { /* record */ }
      }
      return {
        ok: prClosed && branchDeleted,
        rollbackKind: 'provider_native',
        detail: { pr_closed: prClosed, branch_deleted: branchDeleted },
        failure_reason: !prClosed || !branchDeleted ? '未完全撤回' : undefined,
      }
    },
  }
}
```

**注**：本 spec 不实施上述 handler；`GithubClient.closePullRequest` 已存在（[src/lib/cms/github-client.ts:190](../../src/lib/cms/github-client.ts:190)），`deleteBranch` 需要小扩展（GitHub REST 原生支持 `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`）。Handler + `deleteBranch` 的实施进 **PR #1097 的 follow-up commit 或独立 v1.1 PR**（一起本 spec 通过后再谈）。

---

## 5. 具体代码改动清单（GO BUILD 后 PR 落）

### 5.1 一个 PR：`feat(kernel): outward execution hardening v1 (input pinning + provider-native rollback)`

- **`src/lib/kernel/canonical-hash.ts`** — 新文件，`canonicalStringify` + `canonicalHashOfInput`（复用 capability 里那份）
- **`src/lib/kernel/authorize.ts`** — `snapshotOf()` 加 `runInput` 参数 + 填 `input_hash`；调用点 3 处更新
- **`src/lib/kernel/gateway.ts`** — `assertDecisionMatches()` 加 input_hash 重算断言
- **`src/lib/kernel/errors.ts`** — `KernelErrorCode` union 加 `'INPUT_TAMPERED_SINCE_AUTHORIZE'`
- **`src/lib/kernel/types.ts`** — `CapabilityImplementation` 加可选 `rollback?: OutwardRollbackHandler`；`VerificationMethod` union 加 `'rollback_integrity'`；新 export `OutwardRollbackHandler` / `OutwardRollbackResult`
- **`src/lib/kernel/runner.ts`** — dead_letter 前插 rollback 调用；新 `insertRollbackStep()` 内部函数
- **`src/lib/capabilities/page-apply-optimization/hash.ts`** — 把 `canonicalStringify` 抽出去，改成从 `src/lib/kernel/canonical-hash.ts` re-export（消除重复）

**明确不含**：
- ❌ Postgres migration（`policy_snapshot` 是 jsonb，加字段不需要 schema 变化；`action_run_steps` 已支持任意 step_key）
- ❌ ME policy 记录
- ❌ `/geo` apply
- ❌ `deleteBranch` 加到 `GithubClient`（进 rollback handler 的 PR 里加）
- ❌ `page.apply_optimization_request` capability 的 rollback handler 实施（本 spec 只定契约，handler 在 follow-up）

### 5.2 与 PR #1097 的关系

- PR #1097 **仍保持 Draft** 且不 merge
- 本 spec 的 PR 独立开、独立 review、独立 merge
- 本 spec merge 后，PR #1097 需要：
  - rebase / merge origin/main 拉进 hardening 代码
  - 补 `rollback` handler 实施（+ `deleteBranch` 加到 GithubClient）
  - 更新 `page-apply` spec §18.1 从"必须 Kernel-side follow-up"改成"已落地，见 hardening spec"
  - 再走一轮 review（至少狄仁杰复核）

---

## 6. 测试要求（GO BUILD 后 PR 必须含）

**A 级**（安全 · Kernel · 授权核心）：

### 6.1 A · Input Pinning
- authorize 时 `policy_snapshot` 落库确实带 `input_hash`
- Gateway：input 未动 → 通过；`action_runs.input` 被 UPDATE → `INPUT_TAMPERED_SINCE_AUTHORIZE` fail-closed
- 旧 decision（无 input_hash）通过 Gateway → fail-closed
- Adversarial：input 里"看起来无关"的字段被改（e.g. 空格 / 键顺序变了）→ **canonical hash 稳定**，允许通过（否则 canonical 序列化实现错）
- Adversarial：input 加一个新字段（保留原字段值）→ hash 变 → fail-closed
- Adversarial：`policy_snapshot.input_hash` 被直接 UPDATE 成新值 → 由 append-only 触发器挡（`authorization_decisions` 已有触发器，[decisions_append_only.sql](../../supabase/migrations/)）—— 本 spec 假设已存在；测试验证

### 6.2 B · Rollback
- 有 outward + rollback + capability.rollback + 至少一 step 成功 → dead_letter 前调 rollback
- rollback 成功 → `action_run_steps` 多一行 step_key='rollback' status='succeeded'；run 仍 dead_letter；last_error 补 "outward 副作用已撤回"
- rollback 失败 → 多一行 step_key='rollback' status='failed'；run 仍 dead_letter；last_error 明确说"outward 副作用未撤回"
- **无** step 成功 → 不调 rollback（还没产生 outward 副作用）
- **非** outward 或 rollback ≠ 'provider_native' 或 capability.rollback 未提供 → 不调 rollback
- Adversarial：rollback handler 内部抛异常 → 视为 rollback 失败，run 仍 dead_letter，异常写进 last_error
- Adversarial：rollback handler 声称 ok=true 但抛异常 → 以异常为准（Kernel 不信 handler 单方声明）

### 6.3 端到端
- 完整走 `authorize → pending_approval → human → gateway (input pinning 通过) → step succeeded → step failed → dead_letter → rollback → dead_letter with rollback lineage`

---

## 7. 显式不做（重复列一遍，防扩散）

- ❌ PageProviderAdapter 抽象
- ❌ WordPress adapter
- ❌ 新 backlog
- ❌ 新 cron
- ❌ Production migration apply
- ❌ ME `client_automation_policies` 记录
- ❌ `/geo` apply
- ❌ rollback 之外的 outward-safety（限速 / 熔断 / alerting）
- ❌ `snapshot_restore` rollback 类型（v1 只覆盖 `provider_native`）
- ❌ 在本 PR 里同时实施 `page.apply_optimization_request` 的 rollback handler（那是 follow-up）

---

## 8. Reuse Statement

- **复用**：现有 `authorization_decisions` 表 · 现有 `action_run_steps` 表 · 现有 Gateway assertDecisionMatches 流程 · 现有 dead_letter 流程 · 现有 `VerificationResult` 形状 · 现有 `CapabilityStepContext` · capability 里的 `canonicalStringify` 逻辑（抽公共位置复用，不重实现）
- **新增 shared**：
  - 1 个新文件 `src/lib/kernel/canonical-hash.ts`（约 40 行）
  - `CapabilityImplementation.rollback?` 字段（1 行 + 类型定义 ~15 行）
  - `KernelErrorCode` +1 项
  - `VerificationMethod` +1 项
  - `snapshotOf` 加一个 param + 一个字段
  - `assertDecisionMatches` 加一段断言
  - runner dead_letter 前插一段 rollback 触发 + insertRollbackStep 内部函数
- **修改 shared**：`src/lib/capabilities/page-apply-optimization/hash.ts` 里 `canonicalStringify` 改成 re-export 消除重复
- **industry / client 边界**：全部改动都在 Kernel 层，与任何客户 / 行业无关
- **是否 production write**：本 spec 只是文档；实施 PR 也不含 migration / policy / apply
- **是否泄露 secret**：无（本 spec 不碰任何凭据）

---

## 9. Open questions for PM

**Q1. 是否新增 `canonical-hash.ts` 还是复用 `computeBlogContentHash` 的 canonical 逻辑**
- A: 新增文件（本 spec 推荐 —— seo build-publish-package 的 hash 是对**特定 BlogDraftRow** 形状的，不是通用 canonicalStringify；两者不能合并）
- B: 复用（不推荐 —— 会把通用工具塞进领域 capability）
- **推荐**：A

**Q2. `assertDecisionMatches` 加 input_hash 断言 —— 是否需要独立的第三条 predicate 位置**
- 现有 `outward-authorization.ts` 是 "一个 predicate，两处调用"（`authorize.ts` + `gateway.ts` 各一）。input_hash 断言也走同一模式？
- A: 抽 `input-pinning.ts` 一个 predicate，authorize 与 gateway 各调一次（与现有 outward pattern 一致）
- B: 就在 gateway 里直接检查（简单，但缺 authorize 侧同名对齐）
- **推荐**：A（跟现有一致，且 authorize 侧也应该在 mint decision 时算一次 hash 落库；gateway 侧算一次 hash 比对）

**Q3. rollback 失败后 `run.last_error` 追加还是替换**
- A: 追加（保留原失败原因 + "outward 副作用未撤回"）—— 推荐
- B: 替换（只留 rollback 失败原因）
- **推荐**：A（PM/on-call 都要看到"为什么原 action 失败"和"撤回情况"两条独立事实）

**Q4. 本 spec 与 PR #1097 的 merge 顺序**
- A: 本 spec PR 先 merge → PR #1097 rebase + 补 rollback handler + 再 review → merge
- B: 本 spec PR 与 PR #1097 rollback-handler-follow-up 打包成一个 PR
- **推荐**：A（各自独立 review；Kernel 改动风险更高，独立可回滚）

---

## 10. 一句话总结

**Kernel 加两件事：(A) 授权时 pin 完整 input 的 canonical hash，Gateway 执行前重算严格相等；(B) 声明 provider_native rollback 的 outward action 在 dead_letter 前调 capability 显式暴露的 rollback handler，结果进 lineage，rollback 失败绝不假装安全结束。这两件事都不新表、不新 cron、不新 migration，只碰 Kernel 内部；落地后 PR #1097 才可以启用。**

请你回一个：
- `SPEC APPROVED — GO BUILD`
- `SPEC APPROVED WITH CHANGES: <逐条>`
- `DEFER SPEC — <理由>`
