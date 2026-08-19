# ME2 · Kernel Outward Execution Hardening —— v1.0 spec (Draft, awaiting PM approval)

**Status**: **Draft** —— spec only, no code. GO BUILD 之前不写实现。
**Author window**: `magic-engine-gate-reviewer-2887e4`
**Repository Fact Gate**: main = `a2dfcd8b8e9b100dda2ff00e75104ff5db5a4c78` (fetched 2026-08-19T04:38:42Z; 从 handoff 时的 `2f1b097c` 前进，本 spec 相对当前 main **不 rebase/不 merge**，作为独立 Kernel-only PR 单独开)
**Depends on**: Kernel v1 (`src/lib/kernel/**`) —— 全部已在 main
**Blocks**: 启用 `page.apply_optimization_request`（[spec](2026-08-19-me2-page-optimization-apply-action-v1.0.md) §18.1 A/B 项）——本 spec 落地前，PR #1097 保持 Draft、不启用

---

## 0. 一句话

**Kernel 层只做两件事**：

- **A · Authorized Input Pinning + TOCTOU 关闭** —— authorization 时对完整 `action_runs.input` 做 SHA-256 canonical hash（**lowercase, 64 hex, 不截断**），落进 `authorization_decisions.policy_snapshot.input_hash`；`authorize.ts` 与 `human-approval.ts` **两处 `snapshotOf()` 调用**都要 pin；human approval 点批准时再复读一次并核对 hash（防"打开审批页后、点击前 input 被替换"）；每次**新的 execution invocation**（首次 `executeAuthorizedRun` / lease takeover / dead-letter recovery，**不含**单次 execution 内部的 step retry）在 `gateway.ts` 重读 `run.input`、重算 hash、严格相等；核对通过后对该 JSON 做 **deep clone + deep freeze**（不是 `Object.freeze({...input})` 的浅冻结）→ `CapabilityStepContext.runInput`；本次 execution 内所有 step + retry 复用**同一份**冻结 snapshot；capability **禁止**再 `SELECT action_runs.input`
- **B · Provider-native rollback + assembly-time precondition + rollback-aware recovery** —— `sideEffect:'outward' + rollback:'provider_native'` 的 Action 必须由 capability 提供 rollback handler；`gateway.ts` **assembly gate（在 `beginAuthorizedRun` 之前，同时已装配好 ActionDefinition + CapabilityImplementation 之处）**核对，缺 handler → `ROLLBACK_HANDLER_MISSING` fail-closed（不 `beginAuthorizedRun` · 不创建 execution steps · 不调用任何 capability step · 不产生 provider side effect · 授权不被消费）；只要本 execution **已实际进入过任一 capability handler**、随后进入 terminal failure，就在**统一 dead-letter 汇合点 `gateway.ts::failRun()`** 调 rollback handler（由 handler 自己判 `provider_native` vs `noop`）；结果用**现有** `action_run_steps(step_key='rollback')` 三态明确记录；rollback 成功 → **禁止 same-run recovery**（外部资源已撤，DB 里 succeeded step 会与 provider 现状分裂），失败 → 同样禁止（外部状态不明），noop → 沿用现有 recovery

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

### 3.2 authorize.ts + human-approval.ts 改动

`snapshotOf()` ([authorize.ts:66-116](../../src/lib/kernel/authorize.ts:66)) 签名扩展：

```ts
export function snapshotOf(
  policy: ClientAutomationPolicy | null,
  definition: ActionDefinition | null,
  runInput: Record<string, unknown>,   // 🔴 新增
): Record<string, unknown> {
  return {
    // ... 现有字段不动
    input_hash: canonicalHashOfInput(runInput),  // 🔴 新增，lowercase 64 hex
  }
}
```

**runtime 事实**：`snapshotOf()` 的**调用点分散在两个文件**：
- `src/lib/kernel/authorize.ts`：L192、L465、L501（3 处）
- `src/lib/kernel/human-approval.ts`：L375、L480（2 处）—— **原 touched-file plan 漏了这两处**

**5 处调用点全部更新**传入 `run.input`。任何一处漏 → 该路径签出的 decision 缺 `input_hash` → Gateway 执行前一律 fail-closed（B3 条件）。

`canonicalHashOfInput(input)` 新增到 `src/lib/kernel/canonical-hash.ts`（新文件；复用 capability 里的 `canonicalStringify` 逻辑，避免两处漂移）。

**幂等语义与既有 `idempotency_key` 的关系**：
- 现有 `idempotency_key` 只覆盖 `ActionDefinition.idempotency.keyFields` 里声明的**几个**字段
- 新增 `input_hash` 覆盖**整个** input（把"没声明为幂等键的字段"也一起 pin 住）
- 两者互补：idempotency_key 决定"这算不算同一件事"；input_hash 决定"这一件事的 input 有没有在授权后被动过"

### 3.3 gateway.ts 改动 —— hash-check + deep-freeze + 关闭 TOCTOU

**runtime 事实（不改这条 spec 就写错了）**：`runSteps()`（[gateway.ts:649](../../src/lib/kernel/gateway.ts:649)）内部的 step retry loop（[L720-1011](../../src/lib/kernel/gateway.ts:720)）**全在一个函数里跑**；**单次 execution 内部的 attempt++ 不重新进入 Gateway**。

因此"每次都重 hash-check"的**正确颗粒度**是**新的 execution invocation**，具体包括：
- **首次** `executeAuthorizedRun()` 触发
- **Lease takeover / reclaim**：新 owner 进入前
- **Dead-letter recovery**：resume 前（且遵守 §4.6 recovery gate）

**同一次 execution 内的 step 与 retry 复用同一份冻结 snapshot**，不再重读 DB。

Gateway 现有 `assertDecisionMatches()`（[gateway.ts:135-176](../../src/lib/kernel/gateway.ts:135)）在 mint `AuthorizedExecutionContext` 前已经重读 decision + 核对 policy 一致性。**在同一位置加一条硬断言 + 把校验通过的 input deep-freeze 后传下去**：

```ts
// 🔴 A · Authorized Input Pinning + TOCTOU 关闭（每次 execution invocation）：
//    1) 重读 action_runs.input
//    2) 重算 canonical SHA-256（lowercase, 64 hex, 不截断）
//    3) 严格相等 pinnedInputHash；缺 hash 或不等 → INPUT_TAMPERED_SINCE_AUTHORIZE
//    4) 校验通过的这份 input：**deep clone + deep freeze**（不是 Object.freeze({...})
//       浅冻结 —— 那样 intents 等嵌套结构仍可 mutate）
//    5) 作为 ctx.runInput 传下去
const currentInput = run.input                                 // 本次重读
const currentInputHash = canonicalHashOfInput(currentInput)    // full 64 hex
const pinnedInputHash = (decision.policy_snapshot as { input_hash?: string })?.input_hash
if (typeof pinnedInputHash !== 'string' || pinnedInputHash !== currentInputHash) {
  throw new KernelError('INPUT_TAMPERED_SINCE_AUTHORIZE', ...)
}
// verified —— 深冻结的只读 snapshot 传给 capability
const verifiedRunInput = deepFreezeVerifiedInput(currentInput)  // 见 §3.3a
```

### 3.3a `canonical-hash.ts` 提供的 helper

```ts
// src/lib/kernel/canonical-hash.ts
export function canonicalStringify(value: unknown): string       // 已定义
export function canonicalHashOfInput(input: unknown): string     // 返回 lowercase 64 hex
export function deepFreezeVerifiedInput<T>(input: T): Readonly<T> // deep clone + 每层 Object.freeze
```

`deepFreezeVerifiedInput` 的语义：
- 递归拷贝一份新的对象树（`structuredClone` 或手写深拷贝均可，只要不共享引用）
- 每一层数组 / 对象都 `Object.freeze`
- 保证 `ctx.runInput.intents[0].proposedValue = ...` 在 strict mode 下 TypeError（capability handler 无法 mutate 自己手里的 input）

### 3.4 CapabilityStepContext 扩展

[src/lib/kernel/types.ts:393-411](../../src/lib/kernel/types.ts:393) `CapabilityStepContext` 加一个**只读、深冻结**的 field：

```ts
export interface CapabilityStepContext {
  readonly ctx: AuthorizedExecutionContext
  readonly stepKey: string
  readonly attempt: number
  readonly idempotencyKey: string
  readonly priorOutputs: Readonly<Record<string, Record<string, unknown>>>
  /**
   * 🔴 本次 execution invocation 的**已由 Gateway hash-check 通过 + deep-frozen** 的 input。
   *    capability handler **必须**从这里读，**禁止**再回 `action_runs.input` 查询
   *    —— 否则 TOCTOU（Gateway 通过后 attacker UPDATE input，capability 读到新值）。
   *
   *    颗粒度：
   *    · 每次新的 execution invocation（首次 execute / lease takeover / dead-letter recovery）
   *      Gateway 会重跑 hash-check 再往 ctx 里塞新的 deep-frozen snapshot；
   *    · 单次 execution 内的 step retry **不重进 Gateway**，复用**同一份** runInput snapshot。
   */
  readonly runInput: Readonly<Record<string, unknown>>
}
```

capability 内部**下沉纪律**：
- ❌ 禁止：`sb.from('action_runs').select('input').eq('id', ctx.runId)`
- ✅ 只允许：`const input = step.runInput`
- 建议加架构测试（`src/lib/kernel/__tests__/architecture.test.ts`）扫描 `src/lib/capabilities/**` 里 `action_runs` + `.select('input')` 组合，禁止（本 spec 加这条 lint-like 断言）

### 3.4b Human Approval hash re-verification（防"打开审批页后、点击前 input 被替换"）

`human-approval.ts` 里的 `snapshotOf()` 调用点（[human-approval.ts:375, 480](../../src/lib/kernel/human-approval.ts:375)）同样落 `input_hash`。**加一条**：human 点批准触发 `finalizeApproval` 路径时，重读当前 `action_runs.input` + 重算 hash + 跟 **pending decision `policy_snapshot.input_hash`** 严格相等 → 不等 → **不签 allow decision**，fail-closed（PM 明确要求）。审批人看到的 input 与最终允许执行的 input 必须逐字节一致。

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

### 4.1a Gateway assembly-gate precondition —— 缺 rollback handler = fail-closed

**runtime 事实**：Gateway 里 `beginAuthorizedRun`（由 `executeAuthorizedRun` 在 [gateway.ts:282](../../src/lib/kernel/gateway.ts:282) 调用）是**执行开始的门**；在此之前的 assembly 阶段同时能拿到 `ActionDefinition` 和已装配好的 `CapabilityImplementation`。**precondition 应该放在这里**（不是散在 mint ctx 的具体行号）。

```ts
// 🔴 B · rollback handler 作为 execution precondition（PM Change 3）：
//    outward + provider_native 的动作必须已注册 rollback handler；否则一旦 dead_letter
//    时 provider 副作用没人撤 —— 这情况我们**已经预知**，不允许"先跑起来再看"。
//    位置：executeAuthorizedRun / beginAuthorizedRun 汇合处（同时拿得到 def + capability），
//    在任何 handler / step 运行之前。
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

**precondition 触发时**必须保证：
- **不** `beginAuthorizedRun`
- **不**创建 execution steps
- **不**调用任何 capability step handler
- **不**产生任何 provider side effect
- **授权决策不被消费**（`consumed_at` / `consumed_by` 不动，让人补上 handler 后可以复用同一份 approval —— 决策本身没有错，只是代码装配不全）

新 KernelErrorCode：`ROLLBACK_HANDLER_MISSING`（加进 errors.ts union）。**跟 `CAPABILITY_NOT_IMPLEMENTED` 分开**：那个是"整个 capability 处理器没注册"，本条是"处理器注册了但缺 rollback 必需字段"—— 补救方式不同（一个补代码 register，一个补 rollback handler 实现）。

### 4.2 gateway.ts `failRun()` 改动（**不是** runner.ts）

**runtime 事实**：dead-letter 汇合点是 `gateway.ts::failRun()`（[gateway.ts:1082-1112](../../src/lib/kernel/gateway.ts:1082)），从 `gateway.ts` 里多处 `failRun(deps, ...)` 调用点收敛。原 spec 写 "runner.ts 里插" 是错的。

**在 `failRun()` 内部**（写 `status='dead_letter'` 之前）**插一段**：

```ts
// 🔴 B · Provider-native rollback（在统一 dead-letter 汇合点 failRun）：
//    只要本 execution **已经实际进入过任一 capability handler**，就有可能产生 provider
//    副作用（哪怕 handler 在返回 succeeded 前网络断开/抛错，provider 侧仍可能已经写出）——
//    调 rollback，由 handler 自己判 provider_native vs noop。
//    不再用"至少一个 step succeeded"作条件（PM 明确要求更保守）。
const shouldTryRollback =
  definition.sideEffect === 'outward' &&
  definition.outwardAuthorization?.rollback === 'provider_native' &&
  typeof capability.rollback === 'function' &&
  anyHandlerInvocationAttempted(steps)  // 只要本 execution 进入过任一 step handler

if (shouldTryRollback) {
  let rollbackResult: OutwardRollbackResult
  try {
    rollbackResult = await capability.rollback(ctxOrSyntheticCtx, priorOutputs)
  } catch (e) {
    // handler 抛异常 = failed，异常本身作 failure_reason
    rollbackResult = {
      ok: false, rollbackKind: 'provider_native',
      detail: { thrown: e instanceof Error ? e.message : String(e) },
      failure_reason: e instanceof Error ? e.message : String(e),
    }
  }
  // 🔴 三种结果都**明确落一行**（详见 §4.4）
  await insertRollbackStep(deps, run, fence, rollbackResult)
  // 🔴 run 状态不变（dead_letter 就还是 dead_letter），last_error 追加撤回结论
}
```

**关键**：rollback 只**执行撤回**，**不改** run 的最终状态。dead_letter 永远是 dead_letter；rollback 成功也不能读成"原 action 成功了"。

### 4.3 什么时候触发 rollback —— 采用更保守判据

**PM 冻结**：不能再用"至少一个 step succeeded"判断。原因：provider 可能已经写出，但 handler 在返回 `succeeded` 之前网络断开/抛错，此时 `step.status=running` 或 `failed`，"至少一个 succeeded" 会漏。

**新判据**：只要本 execution **实际进入过任一 capability handler**（即 `anyHandlerInvocationAttempted(steps) === true`），就调 rollback。由 rollback handler 自己判到底是 `provider_native` 还是 `noop`。

| 条件 | 触发 rollback? |
|---|---|
| outward + provider_native + capability.rollback + 本 execution 已进过任一 handler | ✅ |
| 未进过任何 handler（e.g. 授权到 preflight 失败） | ❌（handler 没跑过，provider 侧一定没被写）|
| non-outward 或 rollback ≠ 'provider_native' 或 capability.rollback 未提供 | ❌（前两种：本 spec 不管；第三种：由 §4.1a assembly gate 提前挡下）|

`anyHandlerInvocationAttempted(steps)` = `steps.some(s => s.attempt > 0)` （只要 attempt 大于 0，就说明这一步的 handler 已经被 `runSteps()` 调过至少一次）。

### 4.4 rollback lineage：`action_run_steps` 一行（无新 VerificationMethod）

**PM Change 4**：**不新增 `rollback_integrity` VerificationMethod**。rollback 结果直接靠现有 `action_run_steps.status` + `output.rollback_kind` 三态明确记录。

| 情形 | `step_key` | `step_index` | `status` | `output.rollback_kind` | `output.detail` | `last_error` |
|---|---|---|---|---|---|---|
| 需要 rollback + 执行成功 | `'rollback'` | max+1 | `'succeeded'` | `'provider_native'` | handler.detail | `null` |
| 需要 rollback + 执行失败 | `'rollback'` | max+1 | `'failed'` | `'provider_native'` | handler.detail | handler.failure_reason |
| handler 判 noop（进过 handler 但确认无 side effect 要撤） | `'rollback'` | max+1 | `'skipped'` | `'noop'` | handler.detail（e.g. `{ reason: 'no_side_effect_produced' }`）| `null` |

三种情况都**明确落一行**（不是"noop 就不落"）—— 让"我们考察了是否需要 rollback，结论是..."这件事永远可审计。

**并发/幂等**：rollback step 走现有 `action_run_steps` 的 fenced write + `(run_id, step_key)` 唯一约束，天然防重（同一 `failRun()` 因异常被多次触发也只会写一行）。

**为什么不新建 `action_run_rollbacks` 表**：现有 `action_run_steps` 就是 append-only 的执行轨迹表，rollback 是"这次执行的最后一段"，属于同一时间线。新表 = 新 migration + 新 RLS + 新查询路径。

**为什么不加 `rollback_integrity` VerificationMethod**（PM Change 4）：
- `VerificationSpec` 是 `ActionDefinition.verification` 的类型 —— 它描述"这个动作的正常执行判据"
- Rollback 是**失败路径的清理**，不是"这个动作的正常执行判据"
- 强套 verification 概念会让 `ActionDefinition.verification` 与 rollback lineage 两处都有意义歧义
- `action_run_steps.status` 三值（succeeded / failed / skipped）已经**充分表达** rollback 的三态

### 4.6 Rollback-aware dead-letter recovery gate（新架构 blocker 冻结）

**问题（PM 发现）**：现有 dead-letter recovery 是"保留 succeeded steps 的断点续跑"。但 provider-native rollback 成功后，外部资源已被撤（GitHub 场景 = Draft PR + branch 已 close/delete）。此时同一 run 被 recover 继续，把 `open_pr=succeeded` 当作仍成立 → **数据库说 PR 仍存在、provider 上其实已删掉** → 状态分裂 + 错误 lineage。

**冻结规则**（在 `src/lib/kernel/runner.ts` 的 dead-letter recovery / `resumeDeadLetterRun` 入口加 gate）：

| 本 run 最新 `action_run_steps` 里 `step_key='rollback'` 的 status | 允许 same-run recovery? | 应做什么 |
|---|---|---|
| `'succeeded'`（provider 副作用已撤） | ❌ **禁止** | 新 run + 新授权 + 新 input hash pinning。原 run 状态永久锁死 |
| `'failed'`（外部状态不明） | ❌ **禁止** | 先由人工确认 provider 侧的外部资源实际状态，再决定新 run 走什么 input |
| `'skipped'`（noop，确认无副作用） | ✅ **允许** | 沿用现有 same-run recovery（断点续跑）|
| **不存在** rollback step（非 outward 动作 / 未触发 rollback） | ✅ **允许**（现有语义不变） | 沿用现有 same-run recovery |

**为什么必须冻结在这里**：若不冻结，PR #1097 落地后第一次真实 dead_letter + rollback succeeded 会立刻碰到"DB 有 succeeded step，provider 上没有 PR"的分裂。这是**架构层 blocker**，比"仅 A/B 落地"更根本。

**新 KernelErrorCode**（可选）：`ROLLBACK_BLOCKS_SAME_RUN_RECOVERY`（当有人试图 resume 一个已 rollback 的 run 时抛，指向"新开 run"的补救路径）。这个码不放 §3.5 里，独立列在此。

**recover 入口位置**（runtime 事实）：现有 `resumeDeadLetterRun` 类语义分散在 `runner.ts` 的多处 dead_letter 相关分支（[runner.ts:664-678 及其它](../../src/lib/kernel/runner.ts:664)）；本 spec 的 gate 应加在 runner.ts 里"重新领取 dead_letter run"的最外层门（GO BUILD 时 PR 作者精确定位到"claim a dead_letter run for recovery"的那一点，加 gate）。

### 4.7 GitHub v1 的 rollback handler（在 `page.apply_optimization_request` capability 里，另一个 PR 落）

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
- `src/lib/kernel/canonical-hash.ts`：
  - `canonicalStringify(value): string`
  - `canonicalHashOfInput(input): string` —— lowercase, **完整 64 hex** SHA-256
  - `deepFreezeVerifiedInput<T>(input: T): Readonly<T>` —— deep clone + 每层 Object.freeze（PM Change 1）

**修改文件 (7)**（比原 plan 多了 `human-approval.ts` + `store.ts` + `runner.ts` recovery gate 用途 + `architecture.test.ts` lint）：

- `src/lib/kernel/types.ts`：
  - `CapabilityStepContext` 加只读 `runInput: Readonly<Record<string, unknown>>`（§3.4）
  - `CapabilityImplementation` 加可选 `rollback?: OutwardRollbackHandler`（§4.1）
  - 新 export `OutwardRollbackHandler` / `OutwardRollbackResult`
  - **不改** `VerificationMethod` union

- `src/lib/kernel/authorize.ts`：`snapshotOf()` 加 `runInput` 参数、填 `input_hash`（64 hex）；本文件 3 处调用点更新（[L192, L465, L501](../../src/lib/kernel/authorize.ts:192)）

- `src/lib/kernel/human-approval.ts`（**原 plan 漏了**，PM 明确指出）：
  - 本文件 2 处 `snapshotOf()` 调用点（[L375, L480](../../src/lib/kernel/human-approval.ts:375)）更新，传入 `run.input`
  - human 点批准触发 `finalizeApproval` 路径时：重读当前 `action_runs.input` + 重算 hash + 跟 pending decision 的 `policy_snapshot.input_hash` 严格相等；不等 → 不签 allow decision，fail-closed（§3.4b）

- `src/lib/kernel/gateway.ts`（同一文件，3 处联动）：
  - Assembly gate（§4.1a，`executeAuthorizedRun` / `beginAuthorizedRun` 汇合处）：outward + provider_native 缺 rollback handler → `ROLLBACK_HANDLER_MISSING` fail-closed，不 begin，不消费授权
  - `assertDecisionMatches()` 附近（§3.3）：重读 `run.input` + 重算 hash + 严格相等；PASS 后 `deepFreezeVerifiedInput()` → `CapabilityStepContext.runInput`
  - 统一 dead-letter 汇合点 `failRun()` 内部（§4.2）：`shouldTryRollback` 判据（**"已进入过任一 capability handler"**，不用"至少一个 succeeded"）+ 调 rollback + `insertRollbackStep()` 三态 lineage

- `src/lib/kernel/store.ts`（**新加进 plan**，PM 明确指出）：
  - `insertRollbackStep(deps, run, fence, result | 'skipped')` —— 复用现有 `action_run_steps` 的 fenced write，写一行 `step_key='rollback'`（不建新表）
  - 遵守现有 `(run_id, step_key)` 唯一约束，天然防并发重写

- `src/lib/kernel/runner.ts`（用途**收窄**为 recovery gate，不再是 rollback 触发点）：
  - 定位 dead_letter 被"重新领取 recover"的入口
  - 加 gate：读本 run 最新 `step_key='rollback'` 行的 status；`succeeded` / `failed` → 拒 same-run recovery（`ROLLBACK_BLOCKS_SAME_RUN_RECOVERY`），`skipped` 或不存在 → 允许（§4.6）

- `src/lib/kernel/errors.ts`：`KernelErrorCode` union 加**3 项**：
  - `INPUT_TAMPERED_SINCE_AUTHORIZE`
  - `ROLLBACK_HANDLER_MISSING`
  - `ROLLBACK_BLOCKS_SAME_RUN_RECOVERY`

- `src/lib/kernel/__tests__/architecture.test.ts`：加一条 lint-like 断言 —— `src/lib/capabilities/**` 里禁止 `sb.from('action_runs').select('input')` 组合（capability 只能用 `ctx.runInput`）

**去重 (1)**：
- `src/lib/capabilities/page-apply-optimization/hash.ts`：把 `canonicalStringify` 改成从 `src/lib/kernel/canonical-hash.ts` re-export（消除两处漂移）

**测试支持**：
- `src/lib/kernel/__tests__/fake-supabase.ts`：如需给 `action_runs.input` UPDATE 建模 + `action_run_steps` rollback step，扩展假件
- 新 focused 测试文件见 §6

**明确不含（零 touched）**：
- ❌ `supabase/migrations/**`（**不新增 migration 文件，也不 apply migration**）
- ❌ 新 cron
- ❌ 新 orchestrator
- ❌ WordPress adapter
- ❌ PageProviderAdapter
- ❌ Growth Verification
- ❌ client policy
- ❌ production data
- ❌ ME `client_automation_policies` 记录
- ❌ `/geo` apply
- ❌ `GithubClient.deleteBranch` 扩展（进 rollback handler PR）
- ❌ `page.apply_optimization_request` capability 的 rollback handler 实施（follow-up PR）
- ❌ `page.apply_optimization_request` capability 里 `loadRunInput()` 改用 `ctx.runInput` 的下沉改造（跟 rollback handler 一起在 follow-up PR）
- ❌ 新 `VerificationMethod`（PM Change 4）
- ❌ 新 per-step side-effect taxonomy

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
- authorize 时 `policy_snapshot.input_hash` 精确匹配 `/^[0-9a-f]{64}$/`（lowercase, 64 hex, 不截断）
- Canonical 稳定：键顺序 / 空白 / nested object/array 顺序相同 → hash 相等
- Nested object/array hash 正确（`intents[0].proposedValue` 深度嵌套仍纳入 hash）
- 加字段 / 改值 / 删字段 / 改数组顺序 → hash 变 → fail-closed

**Human Approval hash 复核（§3.4b）**：
- pending approval 落库时 `policy_snapshot.input_hash` 已 pin
- Human 点批准前，`action_runs.input` 被 UPDATE → `finalizeApproval` fail-closed，不签 allow decision
- Human 点批准前，input 未动 → 允许

**Gateway execution-time hash（§3.3）**：
- 首次 `executeAuthorizedRun`：input 未动 → 通过 → `ctx.runInput` 存在
- Human Approval 通过后、Gateway 执行前 `action_runs.input` 被 UPDATE → `INPUT_TAMPERED_SINCE_AUTHORIZE` fail-closed
- 旧 decision（`policy_snapshot.input_hash` 为 undefined）→ 一律 fail-closed

**Deep freeze（PM Change 1，防浅冻结漏洞）**：
- capability 收到的 `ctx.runInput` 与被验证 input **canonical-equivalent**
- Adversarial：`ctx.runInput.intents = []` → strict mode TypeError
- Adversarial：`ctx.runInput.intents[0].proposedValue = 'X'` → TypeError（**nested 也冻结**，不是 shallow）
- Adversarial：`ctx.runInput.intents.push(newIntent)` → TypeError（数组也冻结）

**Retry 语义（PM Change 修正）**：
- 单次 execution 内 step retry（attempt++）复用**同一份** ctx.runInput snapshot；不重进 Gateway，不重 hash-check
- 新 execution invocation（首次 executeAuthorizedRun / lease takeover / dead-letter recovery）：Gateway 重跑 hash-check + 重 deep-freeze，形成新 snapshot

**Capability 纪律**：
- Architecture test：`src/lib/capabilities/**` 里出现 `action_runs` + `.select('input')` 组合 → 测试失败
- capability 只能读 `step.runInput`

**Append-only 触发器（现有）**：
- Adversarial：`policy_snapshot.input_hash` 被直接 UPDATE 成新值 → 由 `authorization_decisions` 已有 append-only 触发器挡；本 spec 测试**只验证**触发器仍在（不新建触发器）

### 6.2 B · Rollback

**Precondition（assembly gate，§4.1a）**：
- outward + provider_native + **无** capability.rollback → `ROLLBACK_HANDLER_MISSING` fail-closed；**任何 handler / step / provider side effect 未发生**；授权决策**未被消费**
- outward + provider_native + capability.rollback 存在 → assembly gate 放行
- non-outward 或 rollback ≠ 'provider_native' → gate 不检查 rollback 字段（非 outward 动作零改动）

**触发（`failRun()` 内部，§4.2）**：
- 未进过任何 handler（例如授权到 preflight 失败） → **不** rollback
- 已进过任一 handler + 随后 terminal failure → 调 rollback，由 handler 自己判 provider_native vs noop
- rollback ok=true → `action_run_steps` 一行 status='succeeded' + output.rollback_kind='provider_native'
- rollback 声称 ok=true 但抛异常 → 以异常为准，落 status='failed'
- rollback ok=false → status='failed'
- rollback handler 判断本次实际无 side effect 需撤 → status='skipped' + output.rollback_kind='noop'

**Failure 行为**：
- run 状态**永不变**（rollback 只清理，不改 dead_letter → 绝不假装安全结束）
- rollback 成功 → `last_error` 追加 "outward 副作用已撤回"（不替换原 last_error）
- rollback 失败 → `last_error` 追加 "⚠️ outward 副作用未撤回"；`needs_human=true`
- **无新** VerificationMethod（PM Change 4）

**Concurrency / fencing**：
- rollback step 遵守现有 `(run_id, step_key)` 唯一约束 + fenced write；同一 failRun 被多次触发只会写一行

### 6.3 Recovery gate（§4.6 新架构 blocker 冻结）

- 本 run 有 `step_key='rollback'` 且 status='succeeded' → same-run `resumeDeadLetterRun` 拒 → `ROLLBACK_BLOCKS_SAME_RUN_RECOVERY`
- 本 run 有 `step_key='rollback'` 且 status='failed' → 同样拒
- 本 run 有 `step_key='rollback'` 且 status='skipped' → 允许 same-run recovery（现有语义不变）
- 本 run 无 rollback step（非 outward / 未触发） → 允许 same-run recovery（现有语义不变）
- 新 run（针对同一业务）必须**重走 authorization + input hash pinning + assembly gate**

### 6.4 端到端
- 完整走 `submit → authorize (input_hash pinned) → pending_approval (input_hash pinned) → human approves (re-verify input hash) → executeAuthorizedRun (Gateway hash-check + assembly gate + deep-freeze runInput) → capability step invoked → step terminal failure → failRun (rollback handler called) → dead_letter with rollback lineage (succeeded/failed/skipped)`
- 端到端断言：capability handler 收到的 `ctx.runInput` 深冻结、canonical-equivalent 于 authorize 时的 input

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

**Kernel 加两件事：(A) authorize + human-approval 两条路径的 5 处 `snapshotOf()` 调用都 pin 完整 input 的 canonical SHA-256（lowercase, 64 hex, 不截断）；human 点批准时再复核一次 hash；每次新的 execution invocation（首次 execute / lease takeover / dead-letter recovery，**不含**单次 execution 内的 step retry）Gateway 都重读 + 重 hash-check + 对通过的 input 做 deep clone + deep freeze 传进 `ctx.runInput`；capability 禁止再从 `action_runs.input` 查询。(B) `outward + provider_native` 的 Action 必须由 capability 提供 rollback handler —— 缺 = Gateway assembly gate fail-closed（不 begin / 不消费授权）；在统一 dead-letter 汇合点 `gateway.ts::failRun()` 只要已进过任一 handler 就调 rollback，由 handler 判 provider_native vs noop；结果用现有 `action_run_steps(step_key='rollback', status ∈ succeeded/failed/skipped)` 三态明确记录；rollback succeeded/failed 时**禁止 same-run dead-letter recovery**（防外部资源已撤但 DB 说仍在的分裂），noop 保留现有 recovery。不新增 VerificationMethod。不新增 migration 文件，也不 apply migration。只碰 Kernel 内部。**

请你回一个：
- `SPEC APPROVED — GO BUILD`
- `SPEC APPROVED WITH CHANGES: <逐条>`
- `DEFER SPEC — <理由>`
