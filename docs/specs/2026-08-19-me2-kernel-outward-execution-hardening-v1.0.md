# ME2 · Kernel Outward Execution Hardening —— v1.0 spec (Draft, awaiting PM approval)

**Status**: **Draft** —— spec only, no code. GO BUILD 之前不写实现。
**Author window**: `magic-engine-gate-reviewer-2887e4`
**Repository Fact Gate**: main = `2f1b097c055e34575391770ac8b796db370fb07c` (fetched 2026-08-19T03:41:50Z)
**Depends on**: Kernel v1 (`src/lib/kernel/**`) —— 全部已在 main
**Blocks**: 启用 `page.apply_optimization_request`（[spec](2026-08-19-me2-page-optimization-apply-action-v1.0.md) §18.1 A/B 项）——本 spec 落地前，PR #1097 保持 Draft、不启用

---

## 0. 一句话

**Kernel 层只做两件事**：

- **A · Authorized Input Pinning + TOCTOU 关闭** —— 授权时对**完整** `action_runs.input` 做 SHA-256 canonical hash（**完整 64 hex**）落进 `authorization_decisions.policy_snapshot.input_hash`；Gateway 在 mint `AuthorizedExecutionContext` 前**重读** `run.input`、重算 hash、**严格相等**；核对通过的那份 input 作为**只读** `runInput` 直接放进 `CapabilityStepContext`，capability **不许再从 `action_runs.input` 查询执行输入**；每次新的 execution / recovery 都独立重跑一次"重读 + 重 hash-check + 传入 ctx"（TOCTOU 关闭）
- **B · Provider-native rollback as execution precondition** —— `sideEffect:'outward' + rollback:'provider_native'` 的 Action 必须由 capability 提供 rollback handler；Gateway 在**任何 provider 副作用发生之前**核对，缺 handler = fail-closed；已经产生 outward 副作用之后进入需要回滚的失败路径时，Kernel runner 调用该 rollback handler；rollback 成功 / 失败 / noop 用**现有** `action_run_steps(step_key='rollback')` 明确记录；rollback 失败 = run 仍在 `dead_letter`，**绝不**伪装成安全结束

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

- **Hash 算法**：SHA-256，**完整 64 hex**（不截 40 位；authorization 决策级安全，PM Change 2 明确要求完整长度）
- **canonical 序列化**：JSON with sorted keys, no whitespace, no undefined —— 与 `src/lib/capabilities/page-apply-optimization/hash.ts:canonicalStringify` 同一算法（考虑抽到 `src/lib/kernel/canonical-hash.ts` 复用）
- **落进哪里**：`authorization_decisions.policy_snapshot.input_hash: string`（现有 jsonb 列，**不新增 migration 文件、也不 apply migration**）

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

### 3.3 gateway.ts 改动 —— hash-check + 关闭 TOCTOU

Gateway 现有 `assertDecisionMatches()`（[src/lib/kernel/gateway.ts:135-176](../../src/lib/kernel/gateway.ts:135)）在 mint `AuthorizedExecutionContext` 前已经重读 decision 并核对 policy 一致性。**在同一位置加一条硬断言 + 把校验通过的 input 传下去**：

```ts
// 🔴 A · Authorized Input Pinning + TOCTOU 关闭：
//    1) 重读 action_runs.input（**每次** execution / recovery 都独立重读，不复用旧的）
//    2) 重算 canonical SHA-256 (64 hex)，跟授权时 pin 的 input_hash 严格相等
//    3) 校验通过的这份 input 作为**只读**引用直接放进 CapabilityStepContext.runInput
//       —— capability **不许**再从 action_runs.input 查询执行输入（PM Change 1）
const currentInput = run.input                            // 本次重读
const currentInputHash = canonicalHashOfInput(currentInput)
const pinnedInputHash = (decision.policy_snapshot as { input_hash?: string })?.input_hash
if (typeof pinnedInputHash !== 'string' || pinnedInputHash !== currentInputHash) {
  throw new KernelError('INPUT_TAMPERED_SINCE_AUTHORIZE', ...)
}
// verified — 只读快照传给 capability
const runInputForCtx = Object.freeze({ ...currentInput }) as Readonly<Record<string, unknown>>
```

### 3.4 CapabilityStepContext 扩展（关闭 TOCTOU）

[src/lib/kernel/types.ts:393-411](../../src/lib/kernel/types.ts:393) `CapabilityStepContext` 加一个**只读** field：

```ts
export interface CapabilityStepContext {
  readonly ctx: AuthorizedExecutionContext
  readonly stepKey: string
  readonly attempt: number
  readonly idempotencyKey: string
  readonly priorOutputs: Readonly<Record<string, Record<string, unknown>>>
  /**
   * 🔴 本次 execution / recovery 的**已由 Gateway hash-check 通过**的 input，只读。
   *    capability handler **必须**从这里读，**禁止**再回 `action_runs.input` 查询
   *    —— 否则 TOCTOU（Gateway 通过后 attacker UPDATE input，capability 读到新值）。
   *    每次新的 execution / recovery Gateway 都会重跑一次 hash-check 再往 ctx 里塞；
   *    ctx 是本次 step invocation 的一次性快照，跨 step 通过 priorOutputs 传，不跨 attempt 复用。
   */
  readonly runInput: Readonly<Record<string, unknown>>
}
```

capability 内部**下沉纪律**（本 spec 只在契约里立规矩，capability 侧改造在 PR #1097 follow-up）：
- ❌ 禁止：`sb.from('action_runs').select('input').eq('id', ctx.runId)`
- ✅ 只允许：`const input = step.runInput`

**每次 execution / recovery 都重新读取 + 重新 hash-check**：
- 首次 run：`gateway.ts:signAndMintContext` → hash-check → ctx.runInput
- Step 重试（attempt++）：runner 再次调 `gateway.ts:assertDecisionMatches` → 重新重读 + 重 hash-check → 新的 ctx.runInput
- Reclaim / lease takeover：新 owner 进入 → 同样走一遍
- Dead-letter recovery（rollback 路径）：同样先 hash-check 再进 rollback handler，见 §4

### 3.5 新 KernelErrorCode

`INPUT_TAMPERED_SINCE_AUTHORIZE` 加进 [src/lib/kernel/errors.ts:9-105](../../src/lib/kernel/errors.ts:9) union type。

**跟 `STALE_DECISION` 分开**是必须的：
- `STALE_DECISION` = 挂起期间**policy** 改过；刷一下重新签就能救
- `INPUT_TAMPERED_SINCE_AUTHORIZE` = **input** 被改过；不是"刷一下"能救的，需要**重新提交 run**（新 idempotency_key）
- 合成一个码，PM/审批面无法区分"改一下 policy 就能救"与"这次已经污染了要重来"

### 3.6 迁移与向后兼容

**已经存在的旧 decision 行**：`policy_snapshot.input_hash` 字段不存在（`undefined`）。Gateway 的断言写成"`typeof pinnedInputHash !== 'string'`" —— 对旧 decision 直接 fail-closed。

**为什么不引入 grace period / 只在新 decision 上强制**：
- Kernel v1 目前只有 `seo.build_publish_package` 一个动作在生产（且很少跑）
- 让旧 decision 一律 fail-closed 是**最保守**的：不会有"新代码放过一份该拦的旧决策"
- 需要重跑的极少数旧 decision，走 human-approval 走一遍就能获得带 input_hash 的新 decision

**不新增 migration 文件，也不 apply migration**：`policy_snapshot` 是 `jsonb` 列，加字段不动 schema；`action_run_steps` 已支持任意 step_key。本 spec 涉及的所有存储改动都靠现有列 + append-only 语义承接。

### 3.7 为什么"canonical hash of full input"而不是"immutable trigger on action_runs.input"

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
   * 🔴 sideEffect:'outward' + outwardAuthorization.rollback:'provider_native' 的
   *    ActionDefinition 对应的 CapabilityImplementation **必须**提供 rollback handler
   *    （PM Change 3）—— Gateway 在 mint ctx 前把这条当**执行前置条件**验证：
   *    缺 handler → `ROLLBACK_HANDLER_MISSING` fail-closed，任何 provider 副作用发生前停止。
   *
   *    non-outward 或 rollback ≠ 'provider_native' 的动作可选（不提供即 undefined）。
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

### 4.1a Gateway execution precondition —— 缺 rollback handler = fail-closed

在 [src/lib/kernel/gateway.ts](../../src/lib/kernel/gateway.ts) mint `AuthorizedExecutionContext` 前（跟 §3.3 hash-check 同一位置），加一条：

```ts
// 🔴 B · rollback handler 作为 execution precondition（PM Change 3）：
//    outward + provider_native 的动作，capability 必须提供 rollback handler；
//    否则一旦 dead_letter 时 provider 副作用没人撤 —— 那种情况我们已经预知，
//    不允许"先跑起来再看"，必须在**任何 provider 副作用发生之前**停止。
if (
  definition.sideEffect === 'outward' &&
  definition.outwardAuthorization?.rollback === 'provider_native' &&
  typeof capability.rollback !== 'function'
) {
  throw new KernelError(
    'ROLLBACK_HANDLER_MISSING',
    `动作 ${definition.actionKey} 声明了 outward + provider_native rollback，` +
      `但 capability 没有提供 rollback handler —— 任何 provider 副作用发生前停止`,
  )
}
```

新 KernelErrorCode：`ROLLBACK_HANDLER_MISSING`（加进 errors.ts union）。**跟 `CAPABILITY_NOT_IMPLEMENTED` 分开**：那个是"整个 capability 处理器没注册"，本条是"处理器注册了但缺 rollback 必需字段"—— 补救方式不同（一个补代码 register，一个补 rollback handler 实现）。

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

### 4.4 rollback lineage：`action_run_steps` 一行（无新 VerificationMethod）

**PM Change 4**：**不新增 `rollback_integrity` VerificationMethod**。rollback 结果直接靠现有 `action_run_steps.status` + `output.rollback_kind` 三态明确记录。

| 情形 | `step_key` | `step_index` | `status` | `output.rollback_kind` | `output.detail` | `last_error` |
|---|---|---|---|---|---|---|
| 需要 rollback + 执行成功 | `'rollback'` | max+1 | `'succeeded'` | `'provider_native'` | handler.detail | `null` |
| 需要 rollback + 执行失败 | `'rollback'` | max+1 | `'failed'` | `'provider_native'` | handler.detail | handler.failure_reason |
| 不需要 rollback（无 succeeded step，证明 outward 副作用未发生）| `'rollback'` | max+1 | `'skipped'` | `'noop'` | `{ reason: 'no_side_effect_produced' }` | `null` |

三种情况都**明确落一行**（不是"noop 就不落"）—— 让"我们考察了是否需要 rollback，结论是..."这件事永远可审计。

**为什么不新建 `action_run_rollbacks` 表**：现有 `action_run_steps` 就是 append-only 的执行轨迹表，rollback 是"这次执行的最后一段"，属于同一时间线。新表 = 新 migration + 新 RLS + 新查询路径。

**为什么不加 `rollback_integrity` VerificationMethod**（PM Change 4）：
- `VerificationSpec` 是 `ActionDefinition.verification` 的类型 —— 它描述"这个动作的正常执行判据"
- Rollback 是**失败路径的清理**，不是"这个动作的正常执行判据"
- 强套 verification 概念会让 `ActionDefinition.verification` 与 rollback lineage 两处都有意义歧义
- `action_run_steps.status` 三值（succeeded / failed / skipped）已经**充分表达** rollback 的三态

### 4.5 GitHub v1 的 rollback handler（在 `page.apply_optimization_request` capability 里，另一个 PR 落）

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

### 5.1 一个 PR：`feat(kernel): outward execution hardening v1 (input pinning + rollback precondition)`

**新增文件 (1)**：
- `src/lib/kernel/canonical-hash.ts` — `canonicalStringify` + `canonicalHashOfInput(input) → string`（返回**完整 64 hex** SHA-256）

**修改文件 (5)**：
- `src/lib/kernel/types.ts`：
  - `CapabilityStepContext` 加只读 `runInput: Readonly<Record<string, unknown>>` 字段（§3.4，PM Change 1）
  - `CapabilityImplementation` 加可选 `rollback?: OutwardRollbackHandler` 字段（§4.1）
  - 新 export `OutwardRollbackHandler` / `OutwardRollbackResult`
  - **不改** `VerificationMethod` union（PM Change 4：不新增 `rollback_integrity`）
- `src/lib/kernel/authorize.ts`：`snapshotOf()` 加 `runInput` 参数、填 `input_hash`（64 hex）；调用点 3 处更新
- `src/lib/kernel/gateway.ts`：`assertDecisionMatches()` 附近加两条 precondition：(a) hash-check + 把 verified input 塞进 `CapabilityStepContext.runInput`（§3.3）；(b) outward + provider_native 但缺 rollback handler → fail-closed（§4.1a）
- `src/lib/kernel/runner.ts`：dead_letter 前插 rollback 调用（§4.2）；新增 `insertRollbackStep()` 内部函数（往 `action_run_steps` 写一行）；无论 succeeded / failed / skipped 都落 lineage
- `src/lib/kernel/errors.ts`：`KernelErrorCode` union 加两项：`'INPUT_TAMPERED_SINCE_AUTHORIZE'`、`'ROLLBACK_HANDLER_MISSING'`

**去重 (1)**：
- `src/lib/capabilities/page-apply-optimization/hash.ts`：把 `canonicalStringify` 改成从 `src/lib/kernel/canonical-hash.ts` re-export（消除两处漂移）

**明确不含**：
- ❌ **不新增 migration 文件、也不 apply migration**（`policy_snapshot` 是 jsonb；`action_run_steps` 已支持任意 step_key）
- ❌ ME `client_automation_policies` 记录
- ❌ `/geo` apply
- ❌ `GithubClient.deleteBranch` 扩展（进 rollback handler PR）
- ❌ `page.apply_optimization_request` capability 的 rollback handler 实施（本 spec 只定 Kernel 契约；handler 在 follow-up PR）
- ❌ `page.apply_optimization_request` capability 里 `loadRunInput()` 改用 `ctx.runInput` 的下沉改造（跟 rollback handler 一起在 follow-up PR）
- ❌ 新 `VerificationMethod`（PM Change 4）

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

### 6.1 A · Input Pinning + TOCTOU

**基础**：
- authorize 时 `policy_snapshot` 落库确实带 `input_hash`，长度 = **64 hex**（不是 40）
- Gateway：input 未动 → 通过 → `ctx.runInput` 与 `run.input` **结构相等且冻结**
- Gateway：`action_runs.input` 被 UPDATE → `INPUT_TAMPERED_SINCE_AUTHORIZE` fail-closed，run 未推进
- 旧 decision（无 input_hash）通过 Gateway → fail-closed

**Canonical 稳定性**：
- 键顺序不同 / 空白不同 / 语义相同的 JSON → hash 相等
- 加一个字段（保留原字段值）→ hash 变 → fail-closed
- 数组顺序变 → hash 变（数组保持原顺序是刻意的）

**TOCTOU（PM Change 1）**：
- 首次 attempt：Gateway hash-check → ctx.runInput 冻结；capability 从 ctx.runInput 读到的正是校验过的那份
- Step 重试（attempt++）：Gateway 再跑一次 hash-check → 新的 ctx.runInput；期间被 UPDATE → 新 attempt 拒
- Reclaim / lease takeover：新 owner 进入前 Gateway 走一遍 hash-check
- Adversarial：capability 直接调 `sb.from('action_runs').select('input')` → 应能被 ESLint 或 lint rule 挡（后续加 lint 规则；本 spec 出契约 + 测试防线）
- Adversarial：capability 想 mutate `ctx.runInput` → Object.freeze 挡，运行时抛

**Append-only 触发器**：
- Adversarial：`policy_snapshot.input_hash` 被直接 UPDATE 成新值 → 由 `authorization_decisions` 已有 append-only 触发器挡；本 spec 测试**只验证**这条触发器仍在（不新建触发器 —— 现有 migration 已有）

### 6.2 B · Rollback

**Precondition (execution-time gate)**：
- outward + provider_native + **无** capability.rollback → Gateway `ROLLBACK_HANDLER_MISSING` fail-closed，**任何 step 未运行**（PM Change 3）
- outward + provider_native + capability.rollback 存在 → Gateway 放行
- non-outward 或 rollback ≠ 'provider_native' → Gateway 不检查 rollback 字段（保持 non-outward 动作零改动）

**触发（dead_letter 前）**：
- 有 outward + rollback + capability.rollback + 至少一 step succeeded → 调 rollback；落 `action_run_steps` 一行 status='succeeded' 或 'failed'（output.rollback_kind='provider_native'）
- **无** step succeeded（证明 outward 副作用未产生）→ 落 `action_run_steps` 一行 status='skipped'（output.rollback_kind='noop'）；**明确记录**"我们考察过是否需要 rollback"

**Failure 行为**：
- rollback handler 声称 ok=true 但抛异常 → 以异常为准，落 status='failed'
- rollback handler 声称 ok=false → 落 status='failed'
- run 状态**永不变**（rollback 只清理，不改 dead_letter → 绝不假装安全结束）
- rollback 成功 → last_error 追加 "outward 副作用已撤回"（不替换原 last_error）
- rollback 失败 → last_error 追加 "⚠️ outward 副作用未撤回"

### 6.3 端到端
- 完整走 `authorize → gateway hash-check + rollback precondition → pending_approval → human → gateway hash-check → step succeeded → step failed → dead_letter → rollback → dead_letter with rollback lineage (succeeded/failed/skipped)`
- 端到端里明确断言：capability handler 收到的 `ctx.runInput` 是 Object.frozen 的、且 shape 与授权时的 input 逐字节一致（canonical hash 相等）

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

- **复用**：现有 `authorization_decisions` 表（`policy_snapshot` jsonb 加字段）· 现有 `action_run_steps` 表（step_key='rollback' 复用现有 append-only 语义）· 现有 Gateway `assertDecisionMatches` 位置 · 现有 dead_letter 流程 · 现有 `CapabilityStepContext` 形状（加字段扩展，不替换）· capability 里的 `canonicalStringify` 逻辑（抽公共位置复用，不重实现）· 现有 `authorization_decisions` append-only 触发器
- **新增 shared**（**总量 = 1 新文件 + 契约扩展**）：
  - `src/lib/kernel/canonical-hash.ts`（新文件，~40 行）
  - `CapabilityStepContext.runInput` readonly 字段（PM Change 1）
  - `CapabilityImplementation.rollback?` 可选字段 + `OutwardRollbackHandler` / `OutwardRollbackResult` 类型
  - `KernelErrorCode` +2 项（`INPUT_TAMPERED_SINCE_AUTHORIZE` · `ROLLBACK_HANDLER_MISSING`）
  - `snapshotOf` 加 `runInput` 参数 + 落 `input_hash`
  - Gateway 加两条 precondition（hash-check + rollback handler existence）
  - runner dead_letter 前插 rollback 触发 + `insertRollbackStep()` 内部函数
- **不新增**（PM Change 4）：`VerificationMethod`（rollback 用现有 `action_run_steps.status` 三态承接）
- **修改 shared**：`src/lib/capabilities/page-apply-optimization/hash.ts` 里 `canonicalStringify` 改成 re-export 消除重复
- **industry / client 边界**：全部改动都在 Kernel 层，与任何客户 / 行业无关；本 spec 也不给 ME 任何默认待遇
- **不新增 migration 文件、也不 apply migration**（PM 文案修正）
- **是否 production write**：本 spec 只是文档；实施 PR 也不含 migration / policy / apply / provider write
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

**Kernel 加两件事：(A) 授权时 pin 完整 input 的 canonical SHA-256 (64 hex)；每次 execution/recovery Gateway 都重读+重 hash-check+把 verified input 冻结进 `ctx.runInput`；capability 禁止再从 `action_runs.input` 查询（TOCTOU 关闭）。(B) `outward + provider_native` 的 Action 必须由 capability 提供 rollback handler —— 缺 = Gateway fail-closed 在任何 provider 副作用发生前停止；dead_letter 前调 rollback；结果用 `action_run_steps(step_key='rollback', status ∈ succeeded/failed/skipped)` 三态明确记录；rollback 失败绝不假装安全结束。不新增 VerificationMethod。不新增 migration 文件、也不 apply migration。只碰 Kernel 内部；落地后 PR #1097 才可以启用。**

请你回一个：
- `SPEC APPROVED — GO BUILD`
- `SPEC APPROVED WITH CHANGES: <逐条>`
- `DEFER SPEC — <理由>`
