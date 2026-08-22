# ME2 · Page Optimization Request Caller —— v1.0 spec (Draft, Caller BUILD)

**Status**: **Draft** —— 与实现 PR 同批提交。
**Author window**: `feat/page-optimization-request-caller-v1`
**Repository Fact Gate**: main = `a2dfcd8b8e9b100dda2ff00e75104ff5db5a4c78` (fetched 2026-08-19T05:39:58Z)
**Frozen ordering (Build Control)**: **Caller spec + Caller Draft PR → Hardening BUILD → PR #1097 适配 Hardening → 三者进入同一个 Production Readiness Gate → 首次真实 `/geo` execution**。任何 outward real execution 前，Hardening 必须落地。

**关于本 spec 与 `feat/page-apply-action-v1` 上那份的关系**：
`feat/page-apply-action-v1` 分支携带过一份同名 Caller spec (Draft, gate reviewer 版本)。本 spec 是**在其基础上按当前 runtime 事实与 Build Control 木桶原则修正过**的 caller-owning 版本，与实现代码同一 PR 提交。清理 `feat/page-apply-action-v1` 上遗留的那一份由该 PR 自己的窗口处理，本窗口不动它。

---

## 0. 一句话

新建**一根最小胶水管子**：接受一份已产生的 `PageOptimizationRequest` + 一个 `CandidateIdentity`，用**现有** Action Bridge 映射到 ActionKey（**禁止 hardcode**），构造 Kernel `SubmitActionInput`，调**现有** `runAction()` 走完 submit → authorize progression，返回结构化结果。**证明**"上游真的把一条业务意图送进 Kernel，出现在 Human Approval 队列，且 capability handler 一次都没被调"—— 到此立即停止。**不做 orchestrator、不做 cron、不自动遍历、不多客户 dispatch、不写 ME client id 进 shared runtime、不做 `/geo` 专用 Kernel API**。

---

## 1. 为什么必须现在建（今天的 audit 事实）

**只读 audit 结论**（针对 `origin/main`, `a2dfcd8b`）：

| 环节 | 状态 |
|---|---|
| GEO pipeline (WP03/WP05) 生成 `PageOptimizationRequest` | ✅ 代码存在，实际被调 = **只 tests + 只读脚本** |
| Action Bridge `mapCandidateIdentity` | ✅ 代码存在，`MAPPING_TABLE = []`（刻意），实际被调 = **零**（bridge 自身 + tests 之外） |
| Kernel 提交 + 授权入口 `runAction()` / `submitActionRun()` | ✅ 代码存在，实际被生产调用 = **零**（kernel 内部 + tests 之外） |
| Human Approval API `/api/kernel/approvals/*` + UI + 服务层 + 人批准触发 `approveRun` | ✅ **完整就绪**（Human Approval 只签授权，不执行） |
| 已注册的 `seo.build_publish_package` capability 的生产 caller | ❌ **零**（连它都没生产 caller，可以互证）|

**功能最短板** = **"读一份 `PageOptimizationRequest` → 用 Action Bridge 翻译 → 调 `runAction()`" 这根胶水在 main 上从未被写过**。下游全就绪，上游全就绪，就缺中间这根管子。

**安全最短板** = Hardening（狄仁杰 Attack #1 + #3 已用 review 证过）。跟本 spec 是**同一条窄闭环的相邻两块板**，都必须补，但本 spec 只涉及功能板。

---

## 2. Safety Fact Gate（Caller 复用 `runAction()` 的前提）

Caller 选 `runAction()` 而不是 `submitActionRun()`，是因为：
- `submitActionRun()` 只 INSERT `action_runs` 一行 (`status='queued'`)，**不走授权**，**不落 authorization_decision**，**不推 `pending_approval`**。它一个字都不写进 Approval Queue。
- 真正的 `submit → authorize → pending_approval` progression 在 `runAction()` 里：`submitActionRun` → `driveIntermediateRun` → `authorizeRun`。

**Caller v1 使用 `runAction()` 的安全前提**：对 `sideEffect: 'outward'` 的 action，`runAction()` 在结构上**不可能**到达 capability handler，除非另一个**显式的** `approveAndRun`（Human Approval）由人触发。

**源码引用**（`src/lib/kernel/`）：
- `authorize.ts:316-321` — outward 且无 `outwardAuthorization` 声明 → deny `outward_side_effect_blocked`；
- `authorize.ts:361-370` — outward + `policy.mode === 'auto_approve'` → deny `outward_requires_human_policy`（对外动作永远要人点头，`auto_approve` 不足以放行）；
- `authorize.ts:456-489` — outward + `policy.mode === 'require_approval'` → 返回 `verdict: 'require_approval'`，`run.status = 'pending_approval'`，**不调 executor**；
- `runner.ts:392-400` — `driveIntermediateRun` 见 `verdict === 'require_approval'` → 直接 return，**不进 `executeAndWrap`**。

**结论**：`runAction()` 对 `page.apply_optimization_request` (outward) 的三条终点只能是：
1. `denied`（deny code 属于 §5 明列的四种之一）；
2. `pending_approval`（本 caller v1 的**唯一** success）；
3. `dead_letter`（授权前置校验中间步骤崩了 —— Kernel 会 fence 好，不会漏调 handler）。

**Safety Gate PASS**。Caller 复用现成 progression，无需自己拼 `submitActionRun + authorizeRun`。

**关联 tests**（已存在，本 caller 不改也不复制）：
`src/lib/kernel/__tests__/outward-authorization.test.ts:194-244` 已经完整覆盖上述三条 outward 结构不变量。

---

## 3. Scope hard-boundary —— Caller v1 IS

一个**纯**函数（library function）：

```ts
export async function submitPageOptimizationRequest(
  deps: PageOptimizationRequestCallerDeps,
  input: SubmitPageOptimizationRequestInput,
): Promise<SubmitPageOptimizationRequestResult>
```

它做的**恰好**这几件事，一件不多：

1. **接受**已产生的 `PageOptimizationRequest`（`src/lib/page-optimization/types.ts`）+ 一个 `CandidateIdentity`（由触发端提供，不 hardcode 在 shared caller）
2. **assert** `request.clientId === kernelMeta.clientId` —— 不一致 fail closed（`client_id_mismatch`）
3. **assert** `request.basedOnVersion.known === true` —— unknown fail closed（`basedOnVersion_unknown`）
4. **调**注入的 `mapCandidate(candidateIdentity)`（生产默认接线到 `mapCandidateIdentity`）—— **禁止 hardcode ActionKey**
5. Bridge 返回 `outcome:'rejected'` → **不 submit**，直接返回结构化拒绝（`bridge_rejected`，含 bridge 给的 `code` + `reason`），caller 也不擅自 fallback
6. Bridge 返回 `outcome:'mapped'` → 构造 `SubmitActionInput.input`（形状严格按 §7）
7. **调**注入的 `runAction(kernelDeps, submitInput)`（生产默认接线到 `@/lib/kernel/runner` 的 `runAction`）
8. **按 outcome 分派返回**（§8）：只有 `pending_approval` 是 success；其余（`denied`, `dead_letter`, `succeeded`, `idempotent_hit`, `in_progress`）返回结构化 non-success

**验收 = "run 真进入 Approval Queue"**：`action_runs.status = 'pending_approval'` **且** `authorization_decision_id != null` **且** `authorization_decisions.verdict === 'require_approval'` **且** `listPendingRunsForClient(...)` 能读到这条 run **且** capability handler call count = 0。到此**立即停止**。

**Caller v1 不要求 `/geo` 页面被真的改掉**。Hardening 落地 + PR #1097 适配之前，这条 run 就停在 `pending_approval`，PM 即使去点批准，因为 `page.apply_optimization_request` 尚未在生产 registry 里 —— Kernel 会落 `unknown_action` deny（这是**预期**的）。

---

## 4. Caller v1 明确不做（复述 PM 冻结的 forbid list）

- ❌ 通用 orchestrator / cron / 自动遍历 / 多客户 dispatch framework / retry scheduler / event bus / workflow engine
- ❌ ME client id 写进 shared runtime
- ❌ `/geo` 专用 Kernel API
- ❌ 修改 Kernel / Action Bridge / GEO Module / WP06 pipeline / capability handler 任何一行 runtime code（只加最小架构 guard 到 `kernel/boundaries.ts` 与 `architecture.test.ts`）
- ❌ 建 caller 自己的 provider write（本 caller 一次 provider 写都不发起）
- ❌ Caller 内驱动 execution 到 `authorized → running`（`runAction` 对 outward + require_approval 结构上停在 `pending_approval`，见 §2）
- ❌ Caller 复制或重写 `canonicalDiffHash` 算法（那份权威 hash producer 在 #1097 branch，本 caller 只接受 `precomputed.validatedDiffHash: string`）
- ❌ 修改真实 `MAPPING_TABLE`（`ActionKey` 是封闭 union，`page.apply_optimization_request` 未在 main 的类型里；tests 走 dep injection，真实映射入表由 #1097 落地时同批加）
- ❌ Customer Zero CLI 触发脚本 with `--live` 真提交（v1 PR 不含 live 触发）

---

## 5. 输入契约

```ts
export interface PageOptimizationRequestCallerDeps {
  readonly kernelDeps: KernelDeps
  /** 注入的映射器。生产默认 = `mapCandidateIdentity`。Tests 注入合成 mapper 指向合成 outward action。 */
  readonly mapCandidate: (identity: unknown) => CandidateMappingResult
  /** 注入的 Kernel progression。生产默认 = `runAction`。Tests 注入相同真实函数。 */
  readonly runAction: (kd: KernelDeps, input: SubmitActionInput) => Promise<ActionRunOutcome>
}

export interface SubmitPageOptimizationRequestInput {
  /**
   * 由触发端显式提供。shared caller 不 import `@/lib/geo-module/candidate`，
   * 也不 hardcode `{domain:'geo', intent:'optimize_page_answerability'}`。
   * 触发端（Customer Zero trigger script / 未来其它域）负责传对应的 identity。
   */
  readonly candidateIdentity: CandidateIdentity

  /** 已由 WP06 pipeline 产出并通过 validation 的 request。Caller 不重跑 pipeline、不重算 diff、不重跑 validate。 */
  readonly request: PageOptimizationRequest

  /** Kernel 需要的执行元信息 —— 由 caller 的调用方（触发端）显式提供。 */
  readonly kernelMeta: {
    /** 必填 —— caller 不假设、不推断。必须 === `request.clientId`（不一致 fail closed）。 */
    readonly clientId: string
    readonly purpose: ActionPurpose
    /** growth 时必填（Kernel `submitActionRun` 会 fail-closed）。 */
    readonly goalId?: string | null
    readonly executionItemId?: string | null
    readonly triggeredBy: TriggeredBy
    readonly triggeredByRef?: string | null
    readonly rationale?: string | null
    readonly evidence?: Record<string, unknown>
    readonly correlationId?: string
  }

  /**
   * Caller 不自己算 hash（那会重复 WP06 pipeline 的工作，且权威 producer 未在 main）。
   * 由触发端在建 request 时算好并显式传入。
   */
  readonly precomputed: {
    readonly validatedDiffHash: string
  }
}
```

**为什么 `clientId` 显式传而不从 request 里挖**：`PageOptimizationRequest.clientId` 是 request 内部字段，Kernel `SubmitActionInput.clientId` 是**执行归属**。两者按契约必须一致，**caller 的职责是 assert 一致**（不一致 fail closed），不是二者取一。

**为什么 `candidateIdentity` 由触发端显式传**：Shared caller 在 `src/lib/action-submission/` 里；它禁止 import `@/lib/geo-module/**`（否则 shared runtime 就绑死 GEO 语义）。触发端可以自由 import GEO Module 的 constants 传进来 —— 未来任何域的触发端同理，caller library 一行不改。

---

## 6. Bridge use —— 禁止 hardcode ActionKey

```ts
const mapping = deps.mapCandidate(input.candidateIdentity)

if (mapping.outcome === 'rejected') {
  return {
    ok: false,
    reason: 'bridge_rejected',
    bridgeCode: mapping.code,        // malformed_identity / unmapped_identity / registry_drift
    bridgeReason: mapping.reason,
  }
}

const actionKey     = mapping.actionKey        // ← 从 bridge 拿，不 hardcode
const actionVersion = mapping.actionVersion    // ← 用于 caller 侧日志/追溯（Kernel 会自己重取）
```

**❌ 禁止**：
- `submitActionRun({actionKey: 'page.apply_optimization_request', ...})`
- 任何"跳过 bridge、直接指定 ActionKey"的路径
- 任何"bridge rejected 但 fallback 到默认 key"的路径

**理由**：Bridge 是 Kernel 治理层的唯一映射入口；跳过 bridge = 又开了第二条执行路径。也是 v1 spec §12 已冻结的架构原则："shared runtime 里不写任何客户 id、页面 URL、行业语义"。

**关于 `MAPPING_TABLE = []`**：main 上映射表刻意是空的（未预注册未使用的映射）。测试通过 `deps.mapCandidate` 注入自己的 mapper 来证明"caller 拿 bridge 返回值构造正确 submit"这一行为，不改真实 `MAPPING_TABLE`，不假 mapping 落进 shared runtime。真实映射入表由 PR #1097 落地时同批加。

---

## 7. Submit shape

```ts
const submitInput: SubmitActionInput = {
  clientId:         kernelMeta.clientId,
  actionKey:        mapping.actionKey,          // ← 从 bridge 拿
  purpose:          kernelMeta.purpose,
  goalId:           kernelMeta.goalId ?? null,
  executionItemId:  kernelMeta.executionItemId ?? null,
  triggeredBy:      kernelMeta.triggeredBy,
  triggeredByRef:   kernelMeta.triggeredByRef ?? null,
  rationale:        kernelMeta.rationale ?? null,
  evidence:         kernelMeta.evidence ?? {},
  correlationId:    kernelMeta.correlationId,
  input: {
    page_url:            request.page.url,
    page_version_token:  request.basedOnVersion.value,     // basedOnVersion.known === true 已在 §5 assert
    validated_diff_hash: precomputed.validatedDiffHash,    // 触发端传入，caller 原样绑定
    intents:             request.intents,                  // JSON-safe 由 WP01 保证
    do_not_touch:        request.constraints.doNotTouch,
  },
}

const outcome = await deps.runAction(deps.kernelDeps, submitInput)
```

Caller **不**：
- 重跑 snapshot / draft / diff / validate
- 改写 `proposedValue`
- 重算 hash
- 查询 provider

Caller 是 submission boundary，不是 validation pipeline。

---

## 8. 返回契约

**只有 `pending_approval` **且**带非空 authorization_decision_id** 才是 success**（复述 §3；见 Q7 冻结）。其它一律结构化 non-success。

```ts
export type SubmitPageOptimizationRequestResult =
  | {
      readonly ok: true
      readonly outcome: 'pending_approval'
      readonly runId: string
      /**
       * 🔴 必须非空。Approval Queue 的读路径（`decisionBelongsToRun` 的 7 条判据锚点）
       *    在 authorization_decision_id 为空时会**静默跳过**这条 run —— caller 若报
       *    ok:true 承诺"能被人点头"，触发端去看队列时根本看不到。fail closed 让触发端知情。
       */
      readonly authorizationDecisionId: string
    }
  | { readonly ok: false; readonly reason: 'client_id_mismatch'; readonly requestClientId: string; readonly kernelMetaClientId: string }
  | { readonly ok: false; readonly reason: 'basedOnVersion_unknown' }
  | { readonly ok: false; readonly reason: 'bridge_rejected'; readonly bridgeCode: CandidateMappingRejectionCode; readonly bridgeReason: string }
  | { readonly ok: false; readonly reason: 'kernel_denied';       readonly runId: string; readonly humanReason: string | null }
  | { readonly ok: false; readonly reason: 'kernel_dead_letter';  readonly runId: string; readonly humanReason: string | null }
  | { readonly ok: false; readonly reason: 'kernel_unexpected_outcome'; readonly runId: string; readonly outcomeKind: string }
  | {
      /**
       * 🔴 Kernel 报 pending_approval，但 run 上没有 authorization_decision_id ——
       *    库里状态不一致。Approval Queue 会静默跳过它，触发端应视作"未真正进入
       *    审批队列"，需要人工排查后重新排一次，而不是当作 pending 等人点。
       */
      readonly ok: false
      readonly reason: 'kernel_inconsistent_pending_approval'
      readonly runId: string
    }
```

**`kernel_unexpected_outcome`** 覆盖 `succeeded` / `idempotent_hit` / `in_progress`：
对 outward + require_approval 的 action，`runAction()` 结构上不该在这次调用里出现这三种 —— 出现即意味着上游状态与预期不一致（例如 mapper 指向了内部动作、政策被改成 `auto_approve`、并发有人在跑）。Caller **不粉饰**，如实标出。

**关于"幂等命中" (`existing`)**：v1 不报告这个信号。`runAction()` 的返回类型（`ActionRunOutcome`）**不携带** `SubmitResult.existing`（那是 Kernel 内部 `submitActionRun` 的返回字段，被 `runAction` 吞掉了）。Caller 无法在**不改 Kernel runtime** 的前提下如实报告"这是新排的一条还是幂等命中的老的一条"，所以直接不报 —— 触发端不做去重决策，真实幂等追溯留给 Kernel 审计表。（Codex #1101 PATCH #1）

**Caller 不重新包装 Kernel 抛出的 `KernelError`** —— 直接抛给触发端。理由：Kernel error 已经带 machine code + humanReason，包装一层会丢信息。**唯一例外**：invariant violation 场景（例如 `runAction` 返回的对象结构对不上）Caller 可以 throw，不要静默返 success。

---

## 9. 目录位置与依赖白名单

- **新目录**：`src/lib/action-submission/`
  - `index.ts` — 本 spec 的公开函数与默认 wiring
  - `types.ts` — Input / Result 类型
  - `__tests__/` — §11 全部测试

**依赖白名单**（新增到 `kernel/boundaries.ts` 的 `ACTION_SUBMISSION_ALLOWED_IMPORTS`）：

允许 import：
- `@/lib/kernel/runner`（`runAction`, `submitActionRun`, `SubmitActionInput`, `ActionRunOutcome`）
- `@/lib/kernel/types`（type-only）
- `@/lib/kernel/deps`（`KernelDeps` type）
- `@/lib/action-bridge`（`mapCandidateIdentity`, `CandidateMappingResult`, `CandidateIdentity`, `CandidateMappingRejectionCode`）
- `@/lib/page-optimization`（type-only：`PageOptimizationRequest`）
- `@/lib/kernel/errors`（type-only）
- `@supabase/supabase-js`（type-only；`SupabaseClient` 走 `KernelDeps`）

**明确禁止**（架构测试盯着）：
- ❌ `@/lib/capabilities/**`
- ❌ 任何 provider-write 模块（`PROVIDER_WRITE_MODULES` 里的每一条）
- ❌ 内部直连 `@/lib/supabase`（走 `KernelDeps` 注入）
- ❌ `@/lib/geo-module/**`（避免把 GEO 语义绑死进 shared submission runtime）
- ❌ 直接 INSERT `action_runs` / `authorization_decisions`（所有 run persistence 必须经 Kernel）

**为什么不是 `src/lib/action-bridge/`**：Bridge 的物理边界（`kernel/boundaries.ts:137-148` `ACTION_BRIDGE_FORBIDDEN_IMPORTS`）明确禁止 bridge import capabilities / supabase / execution / cms 等 —— 它是**纯映射**层。本 caller 要调 `runAction`，需要 Kernel deps 注入通道，属于 bridge 之外的**submission 层**。

**为什么不是 `src/lib/kernel/`**：`KERNEL_FORBIDDEN_MODULE_IMPORTS` 禁止 Kernel import bridge 与 domain —— 本 caller 需要 import bridge 与 domain-neutral types，属于 Kernel 之外的**submission 层**。

---

## 10. 触发端（Customer Zero 触发）

**PM 明说**："首个 Customer Zero 可以是触发场景，但代码必须仍是平台级最小 submission path。"

**Caller Draft PR 不实现真实 Customer Zero trigger script**。理由（木桶原则）：
- 权威 `canonicalDiffHash()` 只存在于 #1097 branch，未 merge 前 caller PR 不能复制它；
- 真实 mapping table 里的 `{geo, optimize_page_answerability} → page.apply_optimization_request` 也在 #1097；
- 现在硬建一份"看起来能跑但实际调不出正确 hash / 打到未注册 action"的假脚本 = 制造烂尾。

**触发脚本的建设推迟到 Production Readiness Gate**（Hardening + #1097 都落地后），届时那些依赖都真实存在。

**未来触发脚本的形态**（记录用途，不在本 PR 实现）：
- 一个 **CLI script** `scripts/submit-me-geo-first-request.ts`
- 默认 `NO WRITE`；真提交需显式 `--live`；PM 显式 go 才跑
- 硬编 ME `clientId` + `/geo` 页 URL（**允许含 ME 特有字符串**，因为它是触发方，天然 client-specific；**不进 shared runtime**）

Shared caller (`src/lib/action-submission/`) 里**一行 ME 特有字符串都不许出现**。未来任何客户第一次触发 = 各自写一个 script，caller library 一行不改。

---

## 11. 测试要求

**B 级**（普通业务逻辑；不是安全核心 —— 那是 Hardening 的事）。

### 11.1 单元测试（`src/lib/action-submission/__tests__/caller.test.ts`）
Fail closed / 分派正确性，使用注入的 `mapCandidate` + 注入的 `runAction` mock：

1. `client_id_mismatch` → 不调 bridge、不调 kernel
2. `basedOnVersion_unknown` → 不调 bridge、不调 kernel
3. `bridge_rejected` (unmapped_identity / registry_drift / malformed_identity 各一条) → 不调 kernel
4. Caller **不 hardcode** ActionKey：mapper 返回一个假 key → submitInput.actionKey 原样透传
5. `precomputed.validatedDiffHash` 原样绑定到 `submitInput.input.validated_diff_hash`
6. `runAction` 抛 `KernelError('INVALID_INPUT')` → 抛出**原样**，不吞不改
7. Kernel outcome 分派：
   - `pending_approval` **且带非空 authorization_decision_id** → `{ok:true, outcome:'pending_approval', ...}`
   - `pending_approval` **但 authorization_decision_id === null** → `{ok:false, reason:'kernel_inconsistent_pending_approval', runId}` **（Codex #1101 PATCH #2）**
   - `denied` → `{ok:false, reason:'kernel_denied', ...}`
   - `dead_letter` → `{ok:false, reason:'kernel_dead_letter', ...}`
   - `succeeded` / `idempotent_hit` / `in_progress` → `{ok:false, reason:'kernel_unexpected_outcome', ...}`

### 11.2 Kernel 集成测试（`src/lib/action-submission/__tests__/kernel-progression.test.ts`）
使用现成 `fake-supabase` + `makeFixture` + `makeRegistry` 造合成 outward test action + require_approval policy，注入**真实** `runAction`：

- Happy path：caller → Kernel → 断言：
  - `action_runs[0].status === 'pending_approval'`
  - `action_runs[0].authorization_decision_id != null`
  - `authorization_decisions[0].verdict === 'require_approval'`
  - `authorization_decisions[0].action_run_id === run.id`
  - `authorization_decisions[0].client_id === run.client_id`
  - `run.input` 包含 §7 的五个字段 + `intents` 字节相等（不 mutate、不 re-hash）
  - **capability handler call count = 0**

### 11.3 Approval Queue 集成测试
用 §11.2 建好的库状态，调 `listPendingRunsForClient(sb, clientId)`：
- 断言这条 run 出现在返回列表里
- 断言 `authorization_decision_id` 与 `action_runs.authorization_decision_id` 一致

### 11.4 架构测试（`src/lib/kernel/__tests__/architecture.test.ts` 追加）
- `src/lib/action-submission/**` 只 import §9 白名单里的模块
- 全仓 grep `submitActionRun` / `runAction` 调用点：只允许 `src/lib/action-submission/**` + Kernel 内部 + tests —— 防止未来有人**绕过 caller** 又开一条 submit path
- `src/lib/action-submission/**` 不 hardcode `'page.apply_optimization_request'` 字面量

---

## 12. Reuse Statement

- **复用**：
  - `runAction`（Kernel）
  - `submitActionRun` 的类型 `SubmitActionInput`
  - `mapCandidateIdentity` + `CandidateMappingResult` / `CandidateIdentity` / `CandidateMappingRejectionCode`（Bridge）
  - `PageOptimizationRequest` type（WP06）
  - `KernelDeps`（Kernel）
  - 现有 Human Approval API + UI（不改）
  - Kernel 现有的 outward + require_approval safety invariant（authorize + gateway 各一层，见 §2 源码引用）
  - Kernel 幂等（idempotency key + unique constraint）
  - Kernel 客户归属校验（goalId / executionItemId 都必须同 clientId，见 `runner.ts:87-133`）
- **新增 shared**：
  - 1 个新目录 `src/lib/action-submission/`（约 3 个文件：`index.ts` + `types.ts` + tests）
  - 4 条架构常量（`ACTION_SUBMISSION_FORBIDDEN_IMPORTS` + `KERNEL_RUNNER_ALLOWED_CALLER_DIRS` + `KERNEL_RUNNER_SOURCE_MODULES` + `KERNEL_RUNNER_SYMBOLS` 加进 `kernel/boundaries.ts`）
  - 架构测试新增：submission 层依赖白名单；Kernel progression 符号只走三处 caller（**同时覆盖 `@/lib/kernel/runner` 与 `@/lib/kernel` barrel**，符号级判据，非 type-only imports；见 Codex #1101 PATCH #3）；action-submission 内不 hardcode `page.*` ActionKey；合成源码 mutation 用例（正反两组，证明闸真会咬）
- **Governance-only 修改**：`kernel/boundaries.ts` + `kernel/__tests__/architecture.test.ts`（不是 runtime shared logic）
- **Runtime shared 修改**：**零**（不改 Kernel / Bridge / GEO Module / WP06 / capability 任何一行）
- **industry / client 边界**：
  - **caller library 里零 client-specific 字符串**（不含 ME id、不含 `/geo`、不含 GEO 术语）
  - 未来任何客户触发同类 caller = 再写一个 script，caller library 一行不改
- **不新增 migration 文件、也不 apply migration**
- **是否 production write**：本 PR 无 production write（不含 Customer Zero live trigger script）
- **是否泄露 secret**：无

---

## 13. 显式不做（复述 PM forbid list）

见 §4。

---

## 14. Open questions（本 spec 与实现同批提交，Q1-Q4 已按 PM 冻结的选项落地）

- Q1 触发端形态 → **推迟到 Production Readiness Gate**（木桶原则；见 §10）
- Q2 `validatedDiffHash` 来源 → **触发端传入**（`precomputed.validatedDiffHash`）
- Q3 Bridge unmapped 时的错误信号 → **返回 `{ok:false, reason:'bridge_rejected', ...}`**
- Q4 Caller 是否再跑一次 validate → **不跑**（触发端负责保证 request 已 valid）
- Q5 Caller 使用 `submitActionRun` 还是 `runAction` → **`runAction`**（Safety Gate PASS，见 §2；`submitActionRun` 只 INSERT queued，不进 Approval Queue，达不成本 spec 的验收标准）
- Q6 Merge 顺序 → Caller Draft PR → Hardening BUILD → PR #1097 适配 → 三者同一 Production Readiness Gate → 首次真实 `/geo` execution
