# ME2 · Page Optimization Apply Action —— v1.0 spec (Draft, awaiting PM approval)

**Status**: **Draft** —— spec only, no code. GO BUILD 之前不写实现。
**Author window**: `magic-engine-gate-reviewer-2887e4`
**Repository Fact Gate**: main = `42a8866b02aa1705dd81dfacca468a0d085a0852` (fetched 2026-08-19T00:17:42Z)

**Depends on (all already on main, no change required by this spec)**:
- WP01 Growth Contract — `src/lib/growth/**`
- WP05 GEO Module `candidate.ts` —— `{domain:'geo', intent:'optimize_page_answerability'}`
- WP06 Page Optimization Capability —— `src/lib/page-optimization/**` + `src/lib/capabilities/page-optimization/**`
- Kernel v1 —— `src/lib/kernel/**`
- Action Bridge —— `src/lib/action-bridge/**`

---

## 0. 一句话

新建**一个**平台级、provider-neutral 的受治理动作 `page.apply_optimization_request`，把已经通过 Snapshot → Draft → Diff → Validation → Human Approval 的一份 `PageOptimizationRequest` 提交到目标 provider。

- GitHub v1 = **Draft PR**（不直推 main、不 auto-merge）
- rollback = **`provider_native`**（未合并 Draft PR = close PR + cleanup branch；post-merge git revert 不是本 Action v1 的职责）
- verification = **execution-integrity only**（PR 是否真按批准的 diff/版本创建、`doNotTouch` 是否被守住、lineage 是否可回读）—— **`PR 创建成功 ≠ Growth success`**
- Growth 层的 matched remeasurement 仍然发生在 merge/release 之后，走**现有** GEO Measurement 链，不由本 Action 承担、不由本 Action 调度

不按字段建 ActionKey（`meta_description` / `meta_title` / `content_html` 共用一条），也不按 provider 建 ActionKey。

---

## 1. 为什么必须现在建，且必须这样建

Preflight (v6 Dry Run) 已经证明当前 main 上的现实：

| 层 | 现状 | 后果 |
|---|---|---|
| `MAPPING_TABLE` (`src/lib/action-bridge/mapping-table.ts:27`) | `[]` (刻意空) | 任何 `PageOptimizationRequest` 都 `unmapped_identity` |
| `ACTION_REGISTRY` (`src/lib/kernel/registry.ts:96-98`) | 只 1 条 `seo.build_publish_package` (`sideEffect:'internal_write'`) | 无适用于 customer-website outward write 的 `ActionDefinition` |
| WP06 pipeline (`src/lib/page-optimization/**`) | snapshot/draft/diff/validate 全部就绪，v5 已跑通 | **能出 Request，出不了 Run** |

也就是说：**pipeline 前 5 段已在 main，缺的是第 6 段"受治理的动作"**。今天 ME Customer Zero `/geo` 卡在这里，明天 Roman、Oztop 的任何一次 GEO-driven page optimization 都会同样卡在这里 —— 这是**平台缺口**，不是客户缺口。

### 1.1 为什么"一个 ActionKey"而不是按字段/按 provider 拆

- 按字段：v1 冻结字段 3 个 (`meta_title` / `meta_description` / `content_html`)，配 policy 立刻 3~9 条 —— PM/FDE 面临 "对 `meta_description` 允许 auto，对 `meta_title` 要审" 这种伪细分决策
- 按 provider：Draft PR / WP patch API / (未来) Shopify Section update 是**实现差异**，不是**治理差异** —— Kernel 的授权/幂等/验证判据对三者相同，provider 差异下沉到 capability 处理器
- WP06 合同就是"一份 Request 可以带多个 field-level intents"（`PageOptimizationRequest.intents: readonly PageOptimizationIntent[]`），一条 Request 一条 Run 是最直接映射

**结论**：**one ActionKey, one policy row per client, one row in MAPPING_TABLE.**

---

## 2. ActionKey 身份

```
'page.apply_optimization_request'
```

- **`page.` 前缀**：与 `seo.` (v0 blog package builder)、未来 `ads.` / `crm.` 平级；与 domain 前缀 `geo.` 刻意错开（domain = 从哪个角度诊断出来的；action = 要在哪个平台面上做什么）
- **`.apply_optimization_request`**：谓语 = `apply`（唯一动作），宾语 = `optimization_request`（已过 pipeline 前 5 段的那份东西）—— 不含 provider 名、不含字段名

---

## 3. `ActionDefinition` 字段（逐项，与 `src/lib/kernel/types.ts:142-176` 契约对齐）

| 字段 | 值 | 理由 |
|---|---|---|
| `actionKey` | `'page.apply_optimization_request'` | §2 |
| `version` | `1` | 首版 |
| `title` | `把已授权的页面优化请求提交到目标 provider（GitHub v1: Draft PR，不合并）` | 说明"止于哪里" |
| `inputSchema` | 见 §4 | JSON-safe，绑定 stale-write 防御 |
| `outputSchema` | 见 §5 | 只带引用，不带原文 |
| `capability` | `'page.apply_optimization_request'` | 处理器注册键；与 actionKey 同名 |
| `risk` | `'medium'` | 对客户公开面写入（Draft PR 待人 merge → 不是 `high`；碰到客户对外资产 → 不是 `low`）|
| `sideEffect` | `'outward'` | 目标是客户自有域名下的页面；**默认拒绝，靠下面 `outwardAuthorization` 逐动作放行** |
| `reversible` | `true` | Draft PR = 未合并的分支；rollback = close PR + delete branch —— 可撤回 |
| `outwardAuthorization` | 见 §6 | **本 spec 的核心闸门** |
| `idempotency` | 见 §7 | keyFields 绑到 request 身份 + snapshot version |
| `costModel` | `{kind:'fixed', estimate:()=>0}` | v1 GitHub API 免费；provider 处理器不调付费 LLM |
| `providerIdempotency` | `'supported'` | GitHub `POST /pulls` 用同 `head` branch 是幂等（返回既有 PR），`commitFile` 用同 blobSha 也幂等 |
| `retryPolicy` | `{maxAttempts:3, backoff:'exponential', baseMs:1000}` | 与 `seo.build_publish_package` 同一档 |
| `verification` | 见 §8 —— **`page_apply_integrity`** | **execution-integrity only**；不做 Growth 复测 |
| `requiredCapabilityTier` | `'paid_client'` | 复用现成 tier；不新发明角色 |
| `steps` | `['prepare','commit','open_pr','record']` | 4 步，见 §9 |
| `allowedPurposes` | `['growth']` | Page Optimization 服务 Goal，不做 compliance/housekeeping |

**新增 `ActionKey` 需要的代码改动（GO BUILD 后单条 PR 落）**：
- `src/lib/kernel/types.ts:26` — `ActionKey` union type 加 `| 'page.apply_optimization_request'`
- `src/lib/kernel/types.ts:128` — `VerificationMethod` union 加 `| 'page_apply_integrity'`
- `src/lib/kernel/registry.ts` — `DEFINITIONS` 加一条 ActionDefinition literal
- `src/lib/action-bridge/mapping-table.ts:27` — `MAPPING_TABLE` 加一行

**`OutwardAuthorization.rollback` union 不动**（保持 `'provider_native' | 'snapshot_restore'`，本 v1 用 `'provider_native'`，见 §6）。

---

## 4. Input schema (JSON-safe，绑定 stale-write 防御)

```json
{
  "type": "object",
  "required": [
    "page_url",
    "page_version_token",
    "validated_diff_hash",
    "intents",
    "do_not_touch"
  ],
  "properties": {
    "page_url":            { "type": "string" },
    "page_version_token":  { "type": "string" },
    "validated_diff_hash": { "type": "string" },
    "intents":             { "type": "array" },
    "do_not_touch":        { "type": "array" }
  },
  "additionalProperties": false
}
```

### 4.1 Stale-write 防御（capability 侧强制**重算**，不信 caller 传的 hash）

**核心原则**：capability 处理器**不信任 input 里传进来的任何 hash**；必须在 `prepare` step 里拿真实 approved 对象**自己再算一遍**，两者严格相等才通过。

- **`page_version_token`** = 授权时刻的 `PageSnapshot.versionToken`（GitHub = blob SHA）
- **`validated_diff_hash`** = 对通过 `validatePageChange()` 的 `PageDiffResult.changes` 做 canonical JSON serialize 后的 SHA-256
- **`prepare` step 强制流程**：
  1. 用同一个 provider 客户端**再取一次** file blob SHA
     - **严格等于** 授权时刻 `page_version_token` → 通过
     - 不等 → step 失败，`last_error='stale_snapshot'`，run 转 `failed`（不进 dead_letter；不是 provider 故障，是"世界变了，请重跑 pipeline"）
  2. 用 `intents` + `do_not_touch` 重跑 `draftPageChange()` + `diffPageChange()` + `validatePageChange()`（**完全复用现有 shared runtime，零重实现**）
  3. 对**step 2 自己刚算出来的 diff 结果**再做一次 canonical JSON + SHA-256
     - **严格等于** input 里的 `validated_diff_hash` → 通过
     - 不等 → step 失败，`last_error='pipeline_regression'`
  4. Assert `do_not_touch` 字段与本次 diff 无交集；否则 `last_error='do_not_touch_violation'`

这三条是**capability 内的执行时纪律**，跟 caller 传什么无关 —— 就算 caller 编了个假 hash，capability 也会当场重算撞出 mismatch。

### 4.2 `intents` / `do_not_touch` 的形状

- **`intents`**: `PageOptimizationRequest.intents` 原样 (`PageOptimizationIntent[]`) —— JSON-safe 由 WP01 校验器保证
- **`do_not_touch`**: `PageOptimizationRequest.constraints.doNotTouch` 原样 (`PageOptimizationField[]`)

### 4.3 关于 `verification_definition_hash` —— **刻意不进 input schema**

- `GrowthVerificationDefinition` 属于**下游** Growth Verification / Outcome 链，**不是** apply capability 的执行依赖
- 若未来需要跨链追溯，走 `PageOptimizationRequest.lineage.findingRefs` → GEO finding → verification definition，是 lineage 关系，不是 input gate
- 本 spec v1 明确**不把它绑进 apply capability**，保持 apply 的执行契约窄

### 4.4 为什么不把 provider owner/repo/branch/path 塞进 input

- 那是 **provider 实现的事**，不是 request 的事
- capability 处理器从 `cms_connections` 表按 `page_url` + `client_id` 解析（复用 `resolvePage()` + `resolvePageUpgradeExecution()`）
- input 只带 provider-neutral 身份，同一份 authorization decision 在客户从 GitHub 迁到 WP 时**语义仍然一致**

---

## 5. Output schema

```json
{
  "type": "object",
  "required": ["provider", "run_reference"],
  "properties": {
    "provider":      { "type": "string" },
    "run_reference": { "type": "string" }
  },
  "additionalProperties": true
}
```

- **`provider`** = `'github'` (v1 只有这个值)
- **`run_reference`** = `pr:<owner>/<repo>#<number>`
- **刻意不带**：diff 原文、任何 PAT、任何 provider raw response body（output 会落 `action_run_steps.output`，是可 audit 的；不能把 secret 或大段内容存这里）
- **刻意不带 `verification_scheduled_at`**：v1 verification 是 execution-integrity，run 内完成 (§8)；不调度任何后续任务

---

## 6. `outwardAuthorization` (逐字段)

```ts
outwardAuthorization: {
  declaredIn: 'docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md',
  requiresHumanApproval: true,
  rollback: 'provider_native',
}
```

- **`declaredIn`**：本 spec 相对路径（拆版本时换 v1.1 spec 路径）
- **`requiresHumanApproval: true`**：字面量 true（types 层锁死）。**含义**：`client_automation_policies.mode` 就算配了 `'auto_approve'`，本动作**仍然**要经 human approval —— outward 动作的一票否决 (kernel/types.ts:122)
- **`rollback: 'provider_native'`**（union 不新增值）：
  - **v1 Draft PR 未合并**时：`close PR + delete branch` = provider 原生撤回路径，符合 `'provider_native'` 语义
  - **v1 明确不承担 post-merge rollback**：merge 后如需撤回，走**下一版 Action**（或人工 revert PR）—— 不由本 v1 处理
- Kernel v1 明确要求 `reversible === true` 的对外动作才放行 (types.ts:117) → 本 spec `reversible: true` 已满足

### 6.1 Human Approval 与 Kernel Authorization 不是一件事 —— 关键区分

聊天里 PM 说 "GO"、"SPEC APPROVED"、"APPROVE THIS DIFF"，是**治理层批准**（"这个 diff 可以进入治理流程"），**不是** Kernel 授权。

Kernel 授权必须走**现有** `src/lib/kernel/human-approval.ts` 与 `authorize.ts`：

1. Run 首次进入 `authorize()` → 因 `require_approval` policy + `requiresHumanApproval:true` → run 转 `pending_approval`
2. Human 走既有 approval 面（面板 UI 或后台 API，本 spec 不新造入口）→ 落一条 `authorization_decisions` 行：`verdict='allow'`, `decided_by='human'`, `decided_by_user='<真实身份>'`
3. Kernel 再次 authorize → 从 append-only `authorization_decisions` 读回并 assertDecisionMatches → 签发 `AuthorizedExecutionContext`
4. Capability 处理器**只**信任 Kernel gateway 传下来的 ctx；**不接受** input 里"人已经批了"的自声明

**明令禁止**：
- ❌ 用聊天记录里的 "GO" 文本当 approval 证据
- ❌ Forge `AuthorizedExecutionContext`（`as unknown as` 强转在 `kernel/__tests__/architecture.test.ts` "no forged contexts" 会被扫出）
- ❌ 绕开 append-only `authorization_decisions` 表直接写 ctx 到 run

一次 approval 一次 run：`consumed_at` / `consumed_by` 由 Kernel 现有逻辑写，approval 不可复用。

---

## 7. Idempotency

```ts
idempotency: {
  keyFields: ['page_url', 'page_version_token', 'validated_diff_hash'],
  scope: 'client',
}
```

- 三者共同确定唯一 run
- 同一份 request 重复提交 → 同一把 idempotency_key → 命中同一条 run，不会双发 PR
- snapshot 一变（哪怕字节级差一个空白）→ key 变 → 是另一件事，重新走 authorize
- diff 一变 → 也是另一件事
- **不含 `human_approval_id`**：approval 是过程（谁批的），不是事（要做什么）
- Provider 端幂等键（`CapabilityStepContext.idempotencyKey`）= `sha256(idempotency_key + step_key)`；GitHub `POST /pulls` 里 `head` 就是这个 hash 命名的分支 → provider 端天然幂等

---

## 8. Verification —— **execution-integrity only**（`page_apply_integrity`）

**判据（run 内完成，`delayMs:0`）**：

`page.apply_optimization_request` 的成功 = **这次受授权的执行是否正确发生**。**不是** "Growth 结果是否变好"。

**新 `VerificationMethod` 值**：
```ts
export type VerificationMethod = 'package_integrity' | 'page_apply_integrity'
```

**`VerificationSpec`**：
```ts
verification: { method: 'page_apply_integrity', delayMs: 0 }
```

### 8.1 `page_apply_integrity` 的具体断言（`record` step 内、run 结束前完成）

按 `VerificationResult.checks` 逐项落，任一 fail 则整体 fail：

1. **PR 确实创建**：回读 GitHub `GET /pulls/{number}`，`state='open'` 且 `draft=true` 且 `head=<idempotency-key branch>` 且 `base='main'`
2. **PR 基于批准时的版本**：`GET /pulls/{number}/files` 里目标文件的 `sha` 前值（`patch` 里的 blob 前 SHA）**等于** input 的 `page_version_token`
3. **PR diff 等于 approved validated diff**：把 PR files 里的 patch 转成 field-level diff（复用 `extractGithubFieldValue` 从 PR 分支 head 上重取一次目标文件），canonical JSON + SHA-256 → **等于** input 的 `validated_diff_hash`
4. **`doNotTouch` 字段被守住**：对 `do_not_touch` 里每个字段，PR 分支 head 上的值 = base main 上的值（未变化）
5. **receipt / lineage 可回读**：`action_run_steps.output` 里 `run_reference` 能被 `GET /pulls/{number}` 200 返回；`action_runs.authorization_decision_id` 能被 `authorization_decisions.id` 200 命中

**都通过** → `verification.passed = true`，run 转 `succeeded`

**任一失败** → `verification.passed = false`, `failure_reason` = 触发条编号 + 具体不匹配值，run 转 `failed`

### 8.2 明确划边界 —— Kernel Verification vs Growth Verification

| 层 | 判据 | 契约位置 | 触发时机 |
|---|---|---|---|
| **Kernel Verification** (`page_apply_integrity`, 本 spec) | 这次受授权的执行是否正确发生 | `ActionDefinition.verification` | run 内 `record` step，`delayMs:0` |
| **Growth Verification** (下游，不属于本 Action) | GEO qualified mention share 有没有真动 | `GrowthVerificationDefinition` (`PageOptimizationRequest.verification`) | merge/release 之后，由**现有** GEO Measurement 链在 `windowDays` 后跑一次 baseline 复测；Attribution 层消费复测结果 |

**本 spec 的 Kernel Verification 不做 Growth 复测**。真正的 GEO matched remeasurement 走现有 WP03 GEO measurement pipeline，触发方式沿用当前 GEO baseline 已有的路径（cron / 手工 re-trigger），**不由本 Action 调度、不由本 Action 承担**。

### 8.3 为什么这样切

- Kernel `verification` 是 **ActionDefinition 执行契约**的一部分，语义 = "这一次 run 是否兑现了它宣称要做的事"
- Growth 层的"这次改动值不值得"是 **outcome 层**的事，跟"执行是否正确"是两个正交问题
- 混合两者的成本：apply capability 会背 QuerySetVersion / engine / model / locale / market / sample 一堆 measurement 依赖，同时 Kernel 也会背延迟触发调度 —— 两边都超范
- 分开的收益：apply 层保持窄；Growth outcome 层保持自己的时间窗与判据，能被独立复用（比如未来 CRM apply 也不需要重新造 Growth 复测机制）

---

## 9. Steps（`ActionRunStep.step_key`）

| step | 做什么 | 失败 = |
|---|---|---|
| `prepare` | 用 provider 客户端**再取一次** snapshot；核对 `page_version_token`；重跑 draft/diff/validate；**capability 自己重算** `validated_diff_hash` 与 input 严格相等；assert `do_not_touch` 无交集 | `stale_snapshot` / `pipeline_regression` / `do_not_touch_violation` |
| `commit` | 在**新分支**（idempotency-key hash 命名）上 commit 修改后的文件 | `commit_conflict` / `github_api_error` |
| `open_pr` | 开 **Draft** PR: `head=<idempotency-key hash>`, `base='main'`, `draft:true` | `pr_open_failed` |
| `record` | PR URL 落 `action_run_steps.output`；**执行 §8.1 五条 execution-integrity 断言**；写 `verification.passed` | `page_apply_integrity_failed` |

**`open_pr` 需要的最小 GitHub client 扩展**（本 spec 唯一对现有 shared code 的修改）：
- `GithubClient.createPullRequest` (`src/lib/cms/github-client.ts:150-166`) params 加可选 `draft?: boolean`
- 请求 body 加 `draft: params.draft ?? false`
- GitHub REST API `POST /repos/{owner}/{repo}/pulls` 原生支持

**`commit` 步骤为什么不能 direct main / 不能 auto merge**：
- Draft PR = GitHub UI 不给点 merge → 结构性防止自动或误 merge
- v1 哲学 = "Kernel 决定要不要写，PM 决定要不要发" —— 两个决策点不合并
- 未来若 PM 显式覆盖，加一条 `page.apply_optimization_request_and_merge` 或引入 `outwardAuthorization.autoMerge:boolean`（**本 spec 明确不加**）

---

## 10. Kernel wiring（复用现有，不新造机制）

- **`authorize()`** (`src/lib/kernel/authorize.ts`) —— 无改动
- **`gateway.ts`** —— 无改动，`assertDecisionMatches` 已能挡"input 不合法"/"policy 变了"/"authorization 过期"
- **`outward-authorization.ts`** —— 无改动，`reversible:true + outwardAuthorization != null + requiresHumanApproval:true` 都是它已能识别的
- **`runner.ts`** —— 无改动，按 step_key 索引处理器
- **`lineage.ts`** —— 无改动，`purpose:'growth'` 要求挂 `goal_id`；capability 在 `prepare` step 从 request lineage `findingRefs` 反查 finding → goal，无 goal 则 fail

Kernel v1 明确要求 `reversible === true` 的对外动作才放行 (types.ts:117) → 本 spec 满足。

---

## 11. Provider adapter（capability 处理器）

- 新建目录：`src/lib/capabilities/page-apply-optimization/`
  - `index.ts` — 4 个 step handler
  - `github-adapter.ts` — **v1 唯一 provider 实现**（Draft PR 路径）
  - `__tests__/` — 覆盖 §16 全部测试项

**明确不建**：
- ❌ `wordpress-adapter.ts` —— 今天没有 Customer Zero 需求；未来第二个真实 provider 到来时再抽 (**PM Change 3**)
- ❌ `shopify-adapter.ts`

**为什么放 `src/lib/capabilities/**` 而不是 `src/lib/page-optimization/**`**：
- 与现有物理边界一致（`src/lib/capabilities/page-optimization/snapshot.ts` 已经这样处理："这是本次改动里唯一需要 import provider 客户端的文件"）
- Kernel `architecture.test.ts` 的 `PROVIDER_WRITE_MODULES` 检查会自动覆盖新目录

---

## 12. Action Bridge wiring —— **一行**

`src/lib/action-bridge/mapping-table.ts`:
```ts
export const MAPPING_TABLE: readonly CandidateMappingEntry[] = [
  { domain: 'geo', intent: 'optimize_page_answerability', actionKey: 'page.apply_optimization_request' },
]
```

- **一行**，且这行是 shared runtime 的（无客户 id、无页面 url、无行业判断）
- GEO 域出的 candidate 天然被这条 bridge 映射到本 action
- 未来若 CRM 域 (`{crm, ...}`) 或 Ads 域 (`{ads, ...}`) 也要建同类 outward action，各自加自己的一行 —— 不会互相污染

**⚠️ 与 mapping-table 现有注释兼容性**：mapping-table 的设计原则是"**真实调用方到来才接线**"（[mapping-table.ts:1-8](src/lib/action-bridge/mapping-table.ts:1)）。因此本 spec 的 GO BUILD PR **必须**把 mapping 与真实 capability 处理器**在同一 PR 内落**，避免出现"Bridge 已认领候选、但 Kernel 一执行就 dead-letter"的悬空态。这是 PM Change 4 的直接后果 —— **不接受 registry+mapping 单飞的半成品 PR**。

---

## 13. Client policy —— PM 显式配置，**shared runtime 无默认放行**

`client_automation_policies` 表 (kernel/types.ts:182-195) 是 client-level 的。本 spec:

- **不在 shared runtime 里塞任何客户 id 的默认 policy** —— 特别是不为 Magic Engine (`f1d062ca-...`) 预写
- ME Customer Zero 走通的方式：PM 通过既有 policy 管理面（若无 UI，走 SQL / Supabase Studio）为 ME 加一行：`(client_id=<ME>, action_key='page.apply_optimization_request', mode='require_approval')`
- **默认无 policy = default deny** (types.ts:210 `no_policy` deny code) —— 结构性保证任何新客户第一次跑这个 action 都被拦下等 PM 配

**为什么不 auto_approve**：`outwardAuthorization.requiresHumanApproval:true` 是字面量 true，policy 无论配什么，Kernel 都会强制走 human approval → `require_approval` 是唯一合理配置；`auto_approve` 会被 Kernel 落 `outward_requires_human_policy` deny 码。

---

## 14. Reuse Statement (spec 层面，实施 PR 再落一次)

- **复用了什么已有平台能力**：
  - WP01 Growth Contract 全部
  - WP06 pipeline 全部 (`snapshot/draft/diff/validate`, `resolvePage`, `patchStaticHtmlPage`) —— capability 处理器**只调用不重写**
  - Kernel v1 全部 (authorize / gateway / runner / lineage / outward-authorization / human-approval / idempotency)
  - Action Bridge 全部 (`mapCandidateIdentity` / `listGovernedActionVocabulary`)
  - CMS 层现成 client (`GithubClient`, `resolvePageUpgradeExecution`) —— 只**修**一处 (`createPullRequest` 加 `draft?:boolean` 参数)
  - **现有 GEO Measurement 链**（不改）—— post-merge Growth 复测走它，不由本 Action 调度
- **本 spec 新增的 shared 内容**（**总量 = 4 项 + 1 目录**）：
  - 1 个新 ActionKey (`page.apply_optimization_request`) —— `kernel/types.ts:26` union 加一项
  - 1 个新 ActionDefinition (`kernel/registry.ts` 加约 40 行 literal)
  - 1 个新 `VerificationMethod` union 值 (`page_apply_integrity`) —— **execution-integrity only，不做 Growth 复测**
  - 1 行 mapping (`action-bridge/mapping-table.ts`)
  - 1 个新 capability 目录 (`src/lib/capabilities/page-apply-optimization/`) —— **只含 GitHub adapter，无 WP/Shopify 占位**
- **本 spec 修改的 shared 内容**（**总量 = 2 处**）：
  - `GithubClient.createPullRequest` 加可选 `draft?: boolean` 参数
  - `src/lib/capabilities/index.ts` — `createCapabilities()` 装配表加一项，把 `page.apply_optimization_request` 注册到 Kernel handler 索引（**PM Change A**：不做这一步 Kernel 就找不到 handler，action authorize 通过后一执行就 dead-letter）
- **industry-specific / client-specific 边界**：
  - **零 industry-specific 判断进 shared runtime**
  - **零 client-specific 数据进 shared runtime**（Magic Engine / Roman / Oztop 都通过同一份 shared code，通过 `client_id` 参数化）
  - Client-level 差异（policy `mode`、spend caps、page URLs）落 `client_automation_policies` + `cms_connections`（都是既有 client-configuration 表）
  - 未来行业差异（e.g. real estate 有 listing 页专属检查）落 `Industry Playbook` (spec 未来另立)，**不进本 action**

---

## 15. 显式不在 v1 scope（未来另开 spec 再谈）

- ❌ **WordPress capability 处理器实现**（第二个真实 provider 到来时再抽，v1 连占位空壳都不建 —— PM Change 3）
- ❌ **Shopify capability 处理器**
- ❌ **Verification backlog consumer / 独立复测调度 cron**（第一轮 ME `/geo` 走 `Kernel → Draft PR → human merge → existing GEO Measurement 重跑 → Verification → Attribution` 自然路径；只有当"缺自动消费队列"被实测证明是 blocker 才建 —— PM Change 5）
- ❌ **`page_optimization_remeasurement` 之类的 Growth 判据放进 Kernel VerificationMethod**（Kernel verification 只判执行完整性；Growth 复测归下游 —— PM Change 1）
- ❌ **`OutwardAuthorization.rollback` 加 `'git_revert'` union 值**（post-merge rollback 不是本 v1 责任 —— PM Change 2）
- ❌ **`verification_definition_hash` 进 apply capability input schema**（Growth VerificationDefinition 归下游 Measurement/Verification 链，不该绑死执行能力 —— PM Change 6）
- ❌ **Auto-merge 路径 / `page.apply_optimization_request_and_merge`**
- ❌ **多字段一次性 apply 的 batching 优化**（v1 一次一份 request，多字段合成一个 PR 走同一 run）
- ❌ **PR body 放 AI-generated rationale**（v1 body 只有：机器可读的 `run_id` / `authorization_decision_id` / diff 摘要 / lineage findingRefs）
- ❌ **主动替 PM 点 merge、部署 Cloudflare Pages**
- ❌ **把 verification 结果自动回写 `content_pillar_scores` / `flywheel_outcomes`**
- ❌ **与 #1049 Entity Definition v1 冻结的 redline 集成**（redline registry 是独立 concern，本 action 只**消费** `RedlineCheckInput`，不产生它）

---

## 16. 测试要求（GO BUILD 后 PR 必须含）

**A 级 (安全/隔离/Kernel/migration/资金/发布)** —— 按 `docs/ENGINEERING_QUALITY_GATES.md`：

### 16.1 单元测试
- `prepare` step 命中 stale snapshot 时 fail-closed (`stale_snapshot`)
- `prepare` step 命中 caller-passed hash 与 capability 重算 hash 不等时 fail-closed (`pipeline_regression`)
- `prepare` step 命中 `do_not_touch` 违反时 fail-closed (`do_not_touch_violation`)
- `open_pr` step 一定带 `draft:true`（断言 request body）
- `record` step 5 条 `page_apply_integrity` 断言各自能 fail-closed 触发
- Adversarial: forge `AuthorizedExecutionContext` (走 `as unknown as`) → `architecture.test.ts` "no forged contexts" 扫得出
- Adversarial: caller 在 input 里塞一个**匹配但假造**的 hash → capability 重算真实值时不匹配，仍然 fail-closed（**这是 PM Change 6 的核心断言**）
- Adversarial: policy 配 `auto_approve` → Kernel 落 `outward_requires_human_policy` deny (**不是**放行)
- Idempotent replay: 同一 request 提交两次 → 只开一个 PR
- Mutation: 把 `outwardAuthorization` 改成 `null` → outward-authorization 层拒
- Mutation: 把 `reversible` 改成 `false` → outward-authorization 层拒

### 16.2 集成测试
- 用注入 GitHub reader/writer（v3 dry run 的 `readGithubFile` 注入模式扩展到 write 侧）端到端跑一次，不发真 GitHub 请求
- 完整走 `authorize → pending_approval → human decision → authorize → prepare → commit → open_pr → record → succeeded`

### 16.3 架构测试
- `kernel/__tests__/architecture.test.ts` 的 `PROVIDER_WRITE_MODULES` 会自动包含 `src/lib/capabilities/page-apply-optimization/`；确认它是唯一 import provider 客户端的文件

### 16.4 明确要求
- **必须验证：`page_apply_integrity` 只判执行完整性，不判 Growth 结果**（构造一个 diff 完全符合但 Growth 复测未跑的场景 → run 应 `succeeded`；不能因为"没跑 Growth 复测"就 fail）

---

## 17. Q1–Q5 最终决议

**Q1. `outwardAuthorization.rollback` 值**
- **原选项**：A = `snapshot_restore`；B = 加 `git_revert` union
- **PM 决议 (Change 2)**：**都不选** —— 用 **`provider_native`**，`OutwardAuthorization.rollback` union 保持不动
- **落 spec 位置**：§6

**Q2. Verification backlog 存哪**
- **原选项**：A = 新独立表；B = 复用 `action_run_steps.verification`
- **PM 决议 (Change 5)**：**问题消失** —— v1 不建任何 backlog / 独立复测消费队列；post-merge Growth 复测走**现有** GEO Measurement 链，本 spec 不介入
- **落 spec 位置**：§8.2 边界表，§15 不在 v1 scope 清单

**Q3. GEO baseline remeasurement 的调度触发**
- **原选项**：A = 复用 GEO baseline cron 加一个 run-specific 入口；B = 新建独立 cron
- **PM 决议 (Change 5)**：**问题消失** —— v1 apply capability **不调度任何后续任务**；merge/release 后走 GEO Measurement 已有触发路径（cron 或手工 re-trigger），不是本 spec 的接线点
- **落 spec 位置**：§8.2，§15

**Q4. GO BUILD 前是否要 子牙 + 魏征 双审 spec**
- **原推荐**：Yes（A 级 = 大任务：碰 Kernel 授权核心 + 跨多文件 + 影响已上线功能）
- **PM 决议**：**待 PM 明确**（这一版 spec 修完之后请一并确认；狄仁杰在实施 PR 阶段介入 outward + authorize 攻击验证，这一条我建议保留）

**Q5. ME Customer Zero `/geo` 首个用例是否等本 action 落地才走**
- **原选项**：A = 等本 action 落地端到端跑一次；B = PM 手工编辑一次，本 action 单独排期
- **PM 决议 (Change 5)**：**A** —— "第一轮 ME `/geo` 完全可以：Kernel → Draft PR → human merge → existing GEO Measurement 重跑 → Verification → Attribution。**先真实走一次。**"
- **落 spec 位置**：§8.2 明确列出这条自然路径；ME `/geo` 就是它的首个 verifiable 端到端

---

## 18. 最小 PR 切片（PM Change 4 后的最终形态）

**唯一一个 Draft PR**（**不拆**，PM Change 4：不接受 registry+mapping 单飞的半成品）：

**PR: `feat(kernel): page.apply_optimization_request v1 (ActionKey + GitHub Draft PR handler + apply-integrity verification)`**

内容（一次到位，形成"认识这个动作，也真的有能力承接它"的完整最小切片）：

1. **Types + Registry**
   - `src/lib/kernel/types.ts` — `ActionKey` union 加 `'page.apply_optimization_request'`；`VerificationMethod` union 加 `'page_apply_integrity'`
   - `src/lib/kernel/registry.ts` — 加 ActionDefinition literal（§3 表）
2. **Bridge mapping**
   - `src/lib/action-bridge/mapping-table.ts` — 加一行
3. **GitHub Client 最小扩展**
   - `src/lib/cms/github-client.ts` — `createPullRequest.params` 加 `draft?: boolean`，body 加 `draft: params.draft ?? false`
4. **Capability handler**
   - `src/lib/capabilities/page-apply-optimization/index.ts` — 4 个 step handler
   - `src/lib/capabilities/page-apply-optimization/github-adapter.ts` — Draft PR 路径实现（含 §8.1 五条 integrity 断言）
5. **Capability registration**（**PM Change A**：必须与 handler 同 PR）
   - `src/lib/capabilities/index.ts` — 在 `createCapabilities()` 里按现有装配模式把 `page.apply_optimization_request` 注册进去；只做最小扩展。没有这一步，Kernel 找不到 handler，本 action authorize 通过后一执行就 dead-letter
6. **Tests** —— §16 全部
7. **不含**：WordPress adapter、backlog table/migration、复测调度、任何非本 action 相关的改动、任何新 caller/orchestrator（未来 audit 现有路径证明缺再补）

**这一个 PR merge 后进入 Production Readiness Gate**（PM Change B）—— 只有以下**四条同时成立**才允许首个 `/geo` authorize/apply：
- Kernel production migration 已 apply，`action_runs` / `action_run_steps` / `authorization_decisions` / `client_automation_policies` 等对象在**生产库按对象存在性**核查通过（不能因为代码在 main 就假定生产 Kernel 已 ready；见 `docs/STATE.md` 与 [memory-migration-ledger-version-is-regenerated](~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory/feedback-migration-ledger-version-is-regenerated.md)）
- ME `client_automation_policies` 里有一行 `(client_id=<ME>, action_key='page.apply_optimization_request', mode='require_approval')`
- 存在**真实的 submit/caller 路径**能把一份 approved `PageOptimizationRequest` 送进 Kernel（本 PR **不建** caller/orchestrator；GO BUILD 完成后先 audit 现有 GEO Module → Kernel 的路径，缺哪根再让下一根 blocker 证明）
- 上述三项由 PM 显式 confirm（不在本 PR 范围）

**任一项缺失 = 停在 Production Readiness Gate，本 PR 保持 Draft，不 merge 到 main、不启用。**

### 18.1 Review 阶段发现的 Kernel-side 前置修复（**必须**在启用本 action 之前落）

**A · 狄仁杰 Attack #1 · intents tamper race（Kernel 层）**

授权后 / prepare 前，若攻击者能对 `action_runs.input` 直接 UPDATE 把 `intents` 换成新值、同时把 `validated_diff_hash` 换成 `canonicalDiffHash(新 diff)`，capability 侧的 hash 重算只能验证 input 自我一致，**无法**验证 input 与 human 授权时看到的东西一致（因为 `authorization_decisions.policy_snapshot` 没 pin `intents_hash` / `input_hash`）。本 capability **不能**自己修 —— 需要以下二选一的 **Kernel 层 follow-up PR**：

- **方案 A**（优先）：`src/lib/kernel/authorize.ts` 的 `snapshotOf()` 加一列 `input_hash` = `sha256(canonical(action_runs.input))`，落进 `authorization_decisions.policy_snapshot`；capability 侧 `prepare` step 拿 decision policy_snapshot 反查 `input_hash`，本次 `action_runs.input` 重算不等 → fail-closed `INVALID_INPUT('input_tampered_since_authorize')`
- **方案 B**：`supabase/migrations/` 加 `action_runs.input` immutable 触发器（`AFTER UPDATE OF input` 且 old.status IN ('authorizing','pending_approval','authorized','running') → RAISE EXCEPTION）

**B · 狄仁杰 Attack #3 · dead_letter rollback 未实现（Kernel 层）**

本 spec §6 声明 `rollback:'provider_native'`，语义 = "未合并 Draft PR = close PR + delete branch"，但**触发这条 rollback 的动作在 Kernel dead_letter 处理链里，本 capability 不承担**。目前 Kernel 侧无 `outward-rollback-runner`。需要 **Kernel 层 follow-up PR** 增加：

- Kernel `runner.ts` 或独立 `outward-rollback.ts`：run 转 `dead_letter` 且 `ActionDefinition.outwardAuthorization.rollback === 'provider_native'` 时，从 `action_run_steps` 找到本 run 已产生的 provider 副作用（本 action = `open_pr` step 的 output.pr_number + `commit` step 的 branch_name），调用 provider 的原生撤回接口（GitHub: close PR + delete branch）
- capability 侧可能需要暴露一个 `rollback` 处理器（在 `CapabilityImplementation.steps` 之外或独立字段）

**C · 子牙 Nit #2 · 缺 `PageProviderAdapter` 抽象（本 action tech debt）**

本 v1 把 provider 调用直接塞在 `src/lib/capabilities/page-apply-optimization/index.ts` 的 step handler 里，没有 `PageProviderAdapter` 抽象。今天无第二个 provider 所以不建（PM Change 3），但 v2 加 WordPress adapter 时**必须先抽 adapter**再加实现 —— 否则会形成 provider 分支散在 index.ts 里的形状。**登记为 v2 PR 的第一件事**。

**这三条是"在启用本 action 之前必须先落的 Kernel-side 修复"**（A/B 是安全，C 是设计），跟 Production Readiness Gate 的 4 条基础设施条件是**互补**的：
- 基础设施 4 条不满足 = 无法运行
- 上面 A/B 不修复 = 可以运行但**存在已知安全缺口**
- C 是启用 v2 时的债，v1 启用不受影响

---

## 19. 一句话总结（给 PM 审）

**建一个 ActionKey (`page.apply_optimization_request`)，一行 mapping，一个 GitHub-only capability 处理器（Draft PR，不 auto-merge），一条新的 `page_apply_integrity` verification method（只判执行完整性，不做 Growth 复测）；shared runtime 里不写任何客户 id、不写任何页面 URL、不写任何行业语义、不建 WP 空壳、不建 backlog、不动 rollback union；一个 Draft PR 一次到位，不拆半成品；ME Customer Zero `/geo` 就是它的首个真实端到端。**

请你回一个：
- `SPEC APPROVED — GO BUILD` (含 Q4 的最终选择)
- `SPEC APPROVED WITH CHANGES: <逐条>`
- `DEFER SPEC — <理由>`
