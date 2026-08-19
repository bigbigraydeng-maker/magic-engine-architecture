# ME2 · Page Optimization Request Caller —— v1.0 spec (Draft, awaiting PM approval)

**Status**: **Draft** —— spec only, no code. GO BUILD 之前不写实现。
**Author window**: `magic-engine-gate-reviewer-2887e4`
**Repository Fact Gate**: main = `a2dfcd8b8e9b100dda2ff00e75104ff5db5a4c78` (fetched 2026-08-19T05:00:04Z)
**Frozen ordering (Build Control)**: **Caller spec → Caller Draft PR → Hardening BUILD → PR #1097 适配 Hardening → 三者进入同一个 Production Readiness Gate → 首次真实 `/geo` execution**。任何 outward real execution 前，Hardening 必须落地。

---

## 0. 一句话

新建**一根最小胶水管子**：接受一份已产生的 `PageOptimizationRequest`，用**现有** Action Bridge 映射到 ActionKey（**禁止 hardcode**），构造 Kernel `SubmitActionInput`，调**现有** `submitActionRun()`，返回 `{run_id, status, approvalRequired}`。**证明**"上游真的把一条业务意图送进 Kernel，并出现在 Human Approval 队列"—— 到此立即停止。**不做 orchestrator、不做 cron、不自动遍历、不多客户 dispatch、不写 ME client id 进 shared runtime、不做 `/geo` 专用 Kernel API**。

---

## 1. 为什么必须现在建（今天的 audit 事实）

**只读 audit 结论**（针对 `origin/main`, `a2dfcd8b`）：

| 环节 | 状态 |
|---|---|
| GEO pipeline (WP03/WP05) 生成 `PageOptimizationRequest` | ✅ 代码存在，实际被调 = **只 tests + `scripts/diagnose-roman-geo.ts` 只读脚本** |
| Action Bridge `mapCandidateIdentity` | ✅ 代码存在，实际被调 = **零**（bridge 自身 + tests 之外） |
| Kernel 提交入口 `submitActionRun()` | ✅ 代码存在，实际被调 = **零**（kernel 内部 + tests 之外） |
| Human Approval API `/api/kernel/approvals/*` + UI `/dashboard/kernel-approvals` + 服务层 `kernel-approval/service.ts` + 人批准触发 `runAction` | ✅ **完整就绪** |
| 已注册的 `seo.build_publish_package` capability 的生产 caller | ❌ **零**（连它都没生产 caller，可以互证）|

**功能最短板** = **"读 GEO pipeline 产出 → 用 Action Bridge 翻译 → 调 `submitActionRun()`" 这根胶水在 main 上从未被写过**。下游全就绪，上游全就绪，就缺中间这根管子。

**安全最短板** = Hardening（狄仁杰 Attack #1 + #3 已用 review 证过，不需要再等生产事故）。

两者是**同一条窄闭环的相邻两块板**，都必须补，只是本 spec 只涉及功能板。

---

## 2. Scope hard-boundary —— Caller v1 IS

一个**纯**函数（library function）：

```ts
export async function submitPageOptimizationRequest(
  deps: PageOptimizationRequestCallerDeps,
  input: SubmitPageOptimizationRequestInput,
): Promise<SubmitPageOptimizationRequestResult>
```

它做的**恰好**这几件事，一件不多：

1. **接受**已产生的 `PageOptimizationRequest`（来自 WP06 `src/lib/page-optimization/types.ts` 的 `PageOptimizationRequest`，caller 不生成 request）
2. **构造** `CandidateIdentity = {domain: 'geo', intent: 'optimize_page_answerability'}` —— **从 GEO Module 的 exported constants `GEO_CANDIDATE_DOMAIN` / `GEO_CANDIDATE_INTENT` 读**，不 hardcode 字符串
3. **调**现有 `mapCandidateIdentity(identity)`（`src/lib/action-bridge/index.ts:232`）—— **禁止 hardcode `page.apply_optimization_request`**
4. Bridge 返回 `outcome:'rejected'` → **不 submit**，直接返回结构化拒绝（含 bridge 给的 `code` + `reason`），caller 也不擅自 fallback
5. Bridge 返回 `outcome:'mapped'` → 构造 `SubmitActionInput.input`（形状严格按 `ActionDefinition.inputSchema`）
6. **调**现有 `submitActionRun(deps.kernelDeps, submitInput)`
7. **返回** 标准化结果 `{runId, status, approvalRequired, existing}` —— caller **不**驱动执行（不调 `runAction` / `driveIntermediateRun` / `approveAndRun`），只提交

**验收 = "run 真进入 Approval Queue"**（`action_runs.status = 'pending_approval'` 且 `/api/kernel/approvals?clientId=...` GET 能列出它）—— 到此**立即停止**。

**Caller v1 不要求 `/geo` 页面被真的改掉**。Hardening 落地 + PR #1097 适配之前，这条 run 就停在 `pending_approval`，PM 点批准之后按 Kernel 现有语义会尝试进入执行 —— 但因为 PR #1097 未 merge，`page.apply_optimization_request` 尚未在生产 registry 里 —— Kernel 会落 `unknown_action` deny（这是**预期**的，也是**验证**："pipeline 送达 Kernel"这件事已经证明）。

---

## 3. Caller v1 明确不做（复述 PM 冻结的 forbid list）

- ❌ 通用 orchestrator
- ❌ cron / 定时轮询
- ❌ 自动遍历所有 GEO findings
- ❌ 多客户 dispatch framework
- ❌ 自动 submit 所有 ActionCandidate
- ❌ retry scheduler
- ❌ event bus
- ❌ workflow engine
- ❌ **ME client id 写进 shared runtime**
- ❌ **`/geo` 专用 Kernel API**
- ❌ 修改 Kernel / Action Bridge / GEO Module / WP06 pipeline / capability handler 任何一行
- ❌ 建 caller 自己的 provider write（本 caller 一次 provider 写都不发起）
- ❌ **驱动执行**（不调 `runAction`，只 `submitActionRun`）

---

## 4. 输入契约

```ts
export interface SubmitPageOptimizationRequestInput {
  /** 已由 WP06 pipeline 产出并通过 Human Approval 意图确认的一份 request。 */
  readonly request: PageOptimizationRequest

  /** Kernel 需要的执行元信息 —— 由 caller 的调用方（触发端）显式提供。 */
  readonly kernelMeta: {
    /** 必填 —— caller 不假设、不推断。*/
    readonly clientId: string
    /** growth / compliance / ... —— 见 ActionPurpose union；本 caller v1 不限制值，Kernel 会验。 */
    readonly purpose: ActionPurpose
    /** growth 时必填（Kernel `submitActionRun` 会 fail-closed）。 */
    readonly goalId?: string | null
    /** 可选：挂到执行看板卡片。 */
    readonly executionItemId?: string | null
    /** 谁触发的：'human' / 'signal' / 'schedule' / 'agent' / 'run'。 */
    readonly triggeredBy: TriggeredBy
    /** 可选：触发方引用（e.g. dashboard button click id / cron name）。 */
    readonly triggeredByRef?: string | null
    /** 一句话人话："PM 在 /dashboard 手动触发首个 ME /geo apply"。 */
    readonly rationale?: string | null
    /** Evidence 结构化痕迹，non-domain-vocab（形状通用）。 */
    readonly evidence?: Record<string, unknown>
    /** 关联 correlation。 */
    readonly correlationId?: string
  }
}
```

**为什么 `clientId` 显式传而不从 request 里挖**：`PageOptimizationRequest.clientId` 是 request 内部字段，但 Kernel 侧 `SubmitActionInput.clientId` 是**执行归属**。两者按契约必须一致，**caller 的职责是 assert 一致**（不一致 → fail-closed），不是二者取一。

---

## 5. Bridge use —— 禁止 hardcode ActionKey

```ts
// ✅ 唯一合法写法
import { mapCandidateIdentity } from '@/lib/action-bridge'
import { GEO_CANDIDATE_DOMAIN, GEO_CANDIDATE_INTENT } from '@/lib/geo-module/candidate'

const mapping = mapCandidateIdentity({
  domain: GEO_CANDIDATE_DOMAIN,
  intent: GEO_CANDIDATE_INTENT,
})

if (mapping.outcome === 'rejected') {
  return {
    ok: false,
    reason: 'bridge_rejected',
    bridgeCode: mapping.code,       // malformed_identity / unmapped_identity / registry_drift
    bridgeReason: mapping.reason,
  }
}

const actionKey = mapping.actionKey        // ← 从 bridge 拿，不 hardcode
const actionVersion = mapping.actionVersion // ← 用于 caller 侧日志/追溯
```

**❌ 禁止**：
- `submitActionRun({actionKey: 'page.apply_optimization_request', ...})`
- 任何"跳过 bridge、直接指定 ActionKey"的路径
- 任何"bridge rejected 但 fallback 到默认 key"的路径

**理由**：
- Bridge 是 Kernel 治理层的唯一映射入口；跳过 bridge = 又开了第二条执行路径
- 未来新增域 (crm, ads) 时 Bridge 只需加一行；hardcode 的 caller 会散落成 N 个"专用 caller"
- 也是 v1 spec §12 已冻结的架构原则："shared runtime 里不写任何客户 id、页面 URL、行业语义"

---

## 6. Submit shape

`SubmitActionInput.input` 的形状严格来自 **PR #1097 里 `page.apply_optimization_request` 的 `ActionDefinition.inputSchema`**（本 spec merge 时 PR #1097 尚未 merge，但 caller 的 input 构造**必须**匹配那份 schema —— 否则 Kernel `preflight` 层会 fail-closed）：

```ts
const submitInput: SubmitActionInput = {
  clientId: kernelMeta.clientId,
  actionKey: mapping.actionKey,   // ← 从 bridge 拿
  purpose: kernelMeta.purpose,
  goalId: kernelMeta.goalId ?? null,
  executionItemId: kernelMeta.executionItemId ?? null,
  triggeredBy: kernelMeta.triggeredBy,
  triggeredByRef: kernelMeta.triggeredByRef ?? null,
  rationale: kernelMeta.rationale ?? null,
  evidence: kernelMeta.evidence ?? {},
  correlationId: kernelMeta.correlationId,
  input: {
    page_url:            request.page.url,
    page_version_token:  extractVersionToken(request),  // 见 §6.1
    validated_diff_hash: extractValidatedDiffHash(request),  // 见 §6.1
    intents:             request.intents,        // JSON-safe 由 WP01 保证
    do_not_touch:        request.constraints.doNotTouch,
  },
}

const result = await submitActionRun(deps.kernelDeps, submitInput)
```

### 6.1 `page_version_token` / `validated_diff_hash` 从哪里来

**runtime 事实**：`PageOptimizationRequest.basedOnVersion` 是 `GrowthMaybeUnknown<string>`（可能是 unknown）；`validated_diff_hash` 目前**不在** WP06 `PageOptimizationRequest` 类型里 —— 它是 caller 侧算出来的（用 `canonicalDiffHash` 对 validated diff 算 SHA-256）。

**Caller v1 只做形状 valid 的最小构造**，不重跑 pipeline：

- **`page_version_token`**：如果 `request.basedOnVersion.known === true` → 用其 value；如果 unknown → **fail-closed**（PM Change: 未来 request 生产端应保证已知，本 caller v1 不为 unknown fallback）
- **`validated_diff_hash`**：**Caller 侧不自己重算 diff**（那会重复 WP06 pipeline 的工作）。v1 由**触发端**（trigger surface）连同 `request` 一起显式传入 `validatedDiffHash: string`。见 §7 的入参扩展

**修正 §4 输入契约**（增补）：

```ts
readonly precomputed: {
  /** Caller 不重跑 WP06 pipeline；由触发端在建 request 时算好并显式传。 */
  readonly validatedDiffHash: string
}
```

这一条把"重跑 pipeline"的责任明确排除在 caller v1 外 —— caller 是**提交管道**，不是**验证管道**。

---

## 7. 返回契约

```ts
export type SubmitPageOptimizationRequestResult =
  | {
      readonly ok: true
      readonly runId: string
      readonly runStatus: RunStatus
      /**
       * 从 ActionDefinition + policy 推断，caller 不判决 —— 只**转达**给触发端。
       * 用于触发端决定"要不要立刻把 PM 引导到 approval 队列"。
       */
      readonly approvalRequired: boolean
      /**
       * 幂等命中：这次提交拿到的是已存在的 run（Kernel 幂等键相同）。
       * 触发端应把它当"正常复用"，不当"我又提了一次"。
       */
      readonly existing: boolean
      /** 相对 URL，可选 —— 触发端如果是 UI 会用到。 */
      readonly approvalQueueUrl?: string  // '/dashboard/kernel-approvals?clientId=<uuid>'
    }
  | {
      readonly ok: false
      readonly reason: 'bridge_rejected'
      readonly bridgeCode: CandidateMappingRejectionCode
      readonly bridgeReason: string
    }
  | {
      readonly ok: false
      readonly reason: 'client_id_mismatch'
      readonly requestClientId: string
      readonly kernelMetaClientId: string
    }
  | {
      readonly ok: false
      readonly reason: 'basedOnVersion_unknown'
    }
```

**Caller 不重新包装 Kernel 抛出的 `KernelError`** —— 直接抛给触发端（`INVALID_INPUT` / `CROSS_CLIENT` 等由触发端决定怎么呈现）。理由：Kernel error 已经带 machine code + humanReason，包装一层会丢信息。

---

## 8. 目录位置

- **新目录**：`src/lib/action-submission/`
  - `index.ts` — 本 spec 的公开函数与类型
  - `types.ts` — Input / Result 类型
  - `__tests__/` — §11 全部测试

**为什么不是 `src/lib/action-bridge/`**：Bridge 的物理边界（`kernel/boundaries.ts:137-148` `ACTION_BRIDGE_FORBIDDEN_IMPORTS`）明确禁止 bridge import capabilities / supabase / execution / cms 等 —— 它是**纯映射**层。本 caller 要调 `submitActionRun`，需要 supabase 依赖，属于 bridge 之外的**submission 层**。

**为什么不是 `src/lib/kernel/`**：Kernel `boundaries.ts:125-128` `KERNEL_FORBIDDEN_MODULE_IMPORTS` 禁止 Kernel import bridge 与 domain —— 本 caller 需要 import bridge 与 GEO Module constants，属于 Kernel 之外的**submission 层**。

**为什么不是 `src/lib/geo-module/`**：GEO Module 也不 import Kernel / bridge（domain 独立）。放这里就把 domain 变成 submission 承载方，架构方向反转。

**结论**：`src/lib/action-submission/` 是唯一物理上合法的位置 —— 它**依赖** kernel + bridge + domain constants + WP06 types，被**触发端**（API route / dashboard action / script）依赖。

**新增架构规则**：`src/lib/action-submission/**` 可 import 以下：
- `@/lib/kernel/runner`（`submitActionRun`, `SubmitActionInput`）
- `@/lib/kernel/types`（type-only）
- `@/lib/action-bridge`（`mapCandidateIdentity`, types）
- `@/lib/geo-module/candidate`（constants only，type-only import）
- `@/lib/page-optimization`（type-only：`PageOptimizationRequest`）
- `@/lib/kernel/errors`（type-only）
- `@supabase/supabase-js`（type-only；`SupabaseClient` 走 `KernelDeps`）

**明确禁止**：
- ❌ import `@/lib/capabilities/**`
- ❌ import 任何 provider-write 模块
- ❌ 内部直连 `supabaseAdmin`（走 `KernelDeps` 注入）

需要在 `kernel/boundaries.ts` 加一条 `ACTION_SUBMISSION_ALLOWED_IMPORTS`（本 spec 建议命名）。

---

## 9. 触发端（Customer Zero 的一次触发场景）

**PM 明说**："首个 Customer Zero 可以是触发场景，但代码必须仍是平台级最小 submission path。"

Caller 本身是平台级 library function。**Customer Zero 的触发**用**最小、最一次性、最不建设**的形态：

**选 A（推荐）**：一个 **CLI script** `scripts/submit-me-geo-first-request.ts`（与 `scripts/diagnose-roman-geo.ts` 同一类），只做：
1. 硬编 ME `clientId` + `/geo` 页 URL（这份 script 是"客户零号触发脚本"，本身允许含 ME id，因为它就是为 ME 一次性触发而生 —— **不进 shared runtime**，属于 client-specific trigger script）
2. 跑 GEO pipeline 一次（或复用现有 `scripts/diagnose-roman-geo.ts` 相同的读法为 ME 读一次）
3. 拿到 `PageOptimizationRequest` + 算 `validatedDiffHash`
4. 调 `submitPageOptimizationRequest(deps, input)`
5. 打印 `runId` + `approvalQueueUrl` + 让 PM 打开面板核验

**选 B**：一个 **API route** `src/app/api/action-submission/page-optimization/route.ts`（POST）—— 但这引入面向 client 的入口，会带上鉴权决策 + 谁能触发的问题，超本 spec 范围。**v1 不做**。

**选 C**：dashboard 里一个按钮 —— v1 不做（UI 会带出更多决策）。

**推荐**：**A**（脚本触发一次证明闭环，把 API/UI 建设明确留到证明之后再决定）。

---

## 10. 触发脚本的 client-specific 边界（重要）

`scripts/submit-me-geo-first-request.ts` **允许**含 ME `clientId`、`/geo` URL、Magic Engine 特定 GEO batch id —— 因为它是**触发方**，本身就是"给客户 X 触发一次"的脚本，天然 client-specific。

**Caller library (`src/lib/action-submission/**`) 里不允许出现任何 ME 特有字符串** —— 一行都不许。Caller 只知道"我接一份 request，去 bridge 找 ActionKey，去 Kernel submit"。它不知道 ME、不知道 `/geo`、不知道 GEO。这条边界是 shared runtime 与 client-specific trigger 的清晰切分。

未来 Roman / Oztop / 任何客户第一次触发同类 caller 时，各自写一个 `scripts/submit-<client>-<intent>.ts` 触发脚本 —— **complete duplication OK**，因为触发脚本是一次性的。**Caller library 一行不改**。

---

## 11. 测试要求

**B 级**（普通业务逻辑；不是安全核心 —— 那是 Hardening 的事）：

### 11.1 单元测试
- Happy path：bridge mapped + client id 一致 + basedOnVersion known → 提交成功；返回 `{ok:true, runId, runStatus:'pending_approval', approvalRequired:true}`
- Bridge rejected (unmapped_identity) → `{ok:false, reason:'bridge_rejected', bridgeCode:'unmapped_identity'}`；未调 submitActionRun
- Bridge rejected (registry_drift / malformed_identity) → 同上，各自 code
- `request.clientId !== kernelMeta.clientId` → `{ok:false, reason:'client_id_mismatch'}`；未调 bridge、未调 submitActionRun
- `request.basedOnVersion.known === false` → `{ok:false, reason:'basedOnVersion_unknown'}`
- 幂等命中 (`submitActionRun` 返回 `existing:true`) → `{ok:true, existing:true, ...}`
- Kernel 抛 `KernelError('INVALID_INPUT')` (e.g. goalId 不属于 clientId) → 抛出**原样**，不吞不改
- Caller **不 hardcode** ActionKey：mutation 测试 —— 把 `mapping.actionKey` 换成假 key（e.g. `'garbage.x'`）→ caller 应该继续（因为拿的是 bridge 返回值），Kernel 侧 fail-closed（`unknown_action` deny）；这里断言 caller **透传** bridge 结果，不做 override

### 11.2 集成测试（fake supabase）
- 端到端：构造真实 `PageOptimizationRequest` → 调 caller → 断言 `action_runs` 表里出现一行 status='pending_approval'
- 断言 `action_runs.input` 字段包含 spec §6 的 5 个字段（page_url / page_version_token / validated_diff_hash / intents / do_not_touch）
- 断言 `input.intents` 是 `request.intents` 逐字节相等（不 mutate、不 re-hash）

### 11.3 架构测试
- `src/lib/action-submission/**` 只 import §8 白名单里的模块（新增到 `kernel/architecture.test.ts`）
- 全仓 grep `submitActionRun` 调用点：只允许 `src/lib/action-submission/**` 与 kernel 内部 —— 防止未来有人**绕过 caller** 又开一条 submit path

### 11.4 端到端手动核验（Customer Zero 触发时）
- 跑 `scripts/submit-me-geo-first-request.ts`
- 打开 `/dashboard/kernel-approvals?clientId=<ME>` → 断言 UI 上真能看到这条 pending run
- **不要求** PM 点批准（因 `page.apply_optimization_request` 尚未在生产 registry，PM 点批准后 Kernel 会 `unknown_action` deny —— 这正是**预期路径**，等 PR #1097 + Hardening merge 后再 PM 点批准）

---

## 12. Reuse Statement

- **复用**：`submitActionRun`（Kernel）· `mapCandidateIdentity`（Bridge）· `PageOptimizationRequest` type（WP06）· `GEO_CANDIDATE_DOMAIN` / `GEO_CANDIDATE_INTENT` constants（WP05）· `KernelDeps`（Kernel）· 现有 Human Approval API + UI（不改）
- **新增 shared**：
  - 1 个新目录 `src/lib/action-submission/`（约 3 个文件：`index.ts` + `types.ts` + tests）
  - 1 条架构规则（`ACTION_SUBMISSION_ALLOWED_IMPORTS` 加进 `kernel/boundaries.ts`）
  - 1 条架构测试断言（`architecture.test.ts` 里禁止 `src/lib/action-submission/**` 之外的模块调 `submitActionRun`）
- **修改 shared**：**零**（不改 Kernel / Bridge / GEO Module / WP06 / capability）
- **industry / client 边界**：
  - **caller library 里零 client-specific 字符串**（不含 ME id、不含 `/geo`、不含 GEO 术语；只操作 `PageOptimizationRequest` 通用形状 + `CandidateIdentity` 通用形状）
  - Customer Zero 触发脚本（`scripts/submit-me-geo-first-request.ts`）**允许**含 ME id —— 属于 client-specific trigger，不进 shared runtime
  - 未来任何客户触发同类 caller = 再写一个 script，caller library 一行不改
- **不新增 migration 文件、也不 apply migration**
- **是否 production write**：本 spec 只是文档；实施 PR 涉及一次 `action_runs.insert`（通过 Kernel），但只有 Customer Zero 触发脚本在被 PM 显式执行时才产生这次 insert —— 不是自动的
- **是否泄露 secret**：无

---

## 13. 显式不做（复述 PM forbid list）

- ❌ 通用 orchestrator / cron / event bus / workflow engine / retry scheduler
- ❌ 自动遍历所有 GEO findings / 自动 submit 所有 candidates
- ❌ 多客户 dispatch framework
- ❌ ME client id 写进 shared runtime
- ❌ `/geo` 专用 Kernel API
- ❌ v1 里 Caller 里驱动执行 (`runAction`)
- ❌ v1 里做 API route / dashboard button（触发端限 script）
- ❌ v1 里让 `/geo` 页面被真的改掉（那需要 Hardening + PR #1097 都落地）

---

## 14. Open questions for PM

**Q1. 触发端形态**
- A: CLI script `scripts/submit-me-geo-first-request.ts`（推荐 —— 一次性，不建设 API/UI）
- B: 极简 POST endpoint（引入鉴权决策，超本 spec 范围）
- **推荐**：**A**

**Q2. `validatedDiffHash` 从哪里来**
- A: 触发端在建 request 时算好并显式传入 caller（推荐 —— caller 保持"纯 submission"）
- B: Caller 内部再跑一次 WP06 pipeline 算 hash（会重复 pipeline 的工作）
- **推荐**：**A**

**Q3. Bridge `unmapped_identity` 时 caller 的错误信号**
- A: 返回 `{ok:false, reason:'bridge_rejected', ...}` 让触发端决定怎么呈现（推荐）
- B: caller 抛 `KernelError` 或普通 Error
- **推荐**：**A**（return-style；符合"caller 是纯函数"定位）

**Q4. Caller 是否要断言 request 已通过 `validatePageChange`**
- A: 不断言（Caller 是 submission 层，不做 validation；触发端负责保证 request 已 valid）
- B: caller 内部再跑一次 validate（重复 WP06）
- **推荐**：**A**（跟 Q2 同理）

**Q5. Customer Zero 触发脚本要走 dry-run 还是真提交**
- A: 一次真提交（v1 目标 = "run 真进入 Approval Queue"，dry-run 证明不了）
- B: 先 dry-run，print SubmitActionInput，不真调 submitActionRun
- **推荐**：**A**（否则 v1 的验收标准无法真达成 —— 但触发时机由 PM 显式 go）

**Q6. 本 spec merge 顺序**
- A: Caller spec 先 review + approve → Caller Draft PR → Hardening BUILD → PR #1097 适配 → Production Readiness Gate 一起验（PM 冻结的顺序）
- **推荐**：**A**（就是 PM 已冻结的顺序，Q6 只为记录用途）

---

## 15. 一句话总结

**建一个 `src/lib/action-submission/submitPageOptimizationRequest()` 纯函数：接受一份 `PageOptimizationRequest` + kernelMeta；用现有 Action Bridge 映射（禁 hardcode）→ 构造 `SubmitActionInput` → 调现有 `submitActionRun()` → 返回 `{runId, runStatus, approvalRequired, existing}`。Customer Zero 用一个一次性 script 触发，脚本允许含 ME id 但 caller library 里零 client-specific 字符串。到"run 出现在 Human Approval 队列"就停。不驱动执行、不做 orchestrator、不做 cron、不做 API/UI；不修 Kernel / Bridge / Domain / WP06 / capability 任何一行。Hardening 落地前不允许 PM 点批准执行（会被 Kernel `unknown_action` deny，这是预期）。**

请你回一个：
- `SPEC APPROVED — GO BUILD Caller Draft`
- `SPEC APPROVED WITH CHANGES: <逐条>`
- `DEFER SPEC — <理由>`
