# ADR: 最小 Kernel 不可逆对外动作契约（IrreversibleOutwardContract）

**状态：DESIGN ONLY，R2 修订版 —— 设计已提交，尚未冻结，等 Build Control 聚焦复审**
**日期**：2026-08-20 首版 / 2026-08-20 R2 修订（Build Control R1 BLOCKER + 三项裁决）
**关联**：`docs/adr/2026-08-20-me-ads-hub-v1-reversibility-recovery-contract.md`（被本文档取代的早期方案）、
`src/lib/kernel/registry.ts` 的 `ads.meta_boost_sandbox_reel`（M3，已实施，边界只到 PAUSED+verified+linked，本设计不碰它）

## R2 修订说明

R1 复审抓到一个真实的信任边界错误：首版设计要求 **Capability** 在执行时重算内容
指纹跟 `run.input` 比对。这只能证明"执行时读到的 input 跟数据库里的 input 一致"
（而 `action_runs.input` 本来就不可变，这条**已经**自动成立，不需要 Capability
再证明一次）——它**证不出**"人工批准时看到并批准的，正是这份 input"。

正确的绑定点必须在**审批记录**里，由 **Gateway**（授权与执行之间唯一可信的边界）
强制校验，不能让 Capability 自证"我没被篡改"——那等于让嫌疑人自己写无罪证明。

本次修订：①重新设计批准快照绑定，绑定点搬进 `authorization_decisions`；
②按裁决重写 `costReservation`（不再死板要求 steps[0]）；
③按裁决重写 `stopFutureEffect` 的完整状态机（含"事故态"，复用既有
`dead_letter`+`needs_human` 机制，不新增 RunStatus 枚举值）；
④明确七项要求全部由 **Gateway 强制执行**，不是 ActionDefinition 声明后就自动成立。

## 背景（不变，见首版）

Build Control 否掉了"激活走独立 route 绕过 Kernel"的方案，要求扩展 Kernel 自己
的契约词汇表，让它能诚实 authorize 一个真正不可逆的对外动作——这是
`outward-authorization.ts` 代码注释自己留的口子："真要放开不可逆的对外动作，
那是一次单独的、要重新评估风险的决定"。Build Control 现在做这个决定，本 ADR 是
这个决定的最小化设计。

## 一、批准快照绑定：重新设计（R2 核心修订）

### 现状核实（R2 新增，读代码不是猜）

- `AuthorizationDecision.policy_snapshot` 的类型是 `Record<string, unknown>`
  （`kernel/types.ts:245`）——**已经是自由格式的 JSONB**，扩展它的内容是纯应用层
  改动，不需要新列、不需要 migration
- `snapshotOf()`（`authorize.ts:66-91`）目前只把 `policy` 和 `definition` 的元信息
  塞进这个字段，`run.input` 完全没有参与——这是要补的洞
- Gateway 侧已经有"执行前重新核对决策"的先例：`gateway.ts` 的
  `assertDecisionMatches`（`kernel/types.ts` 头注释提到）——本设计新增的
  input hash 核对，是**同一个信任模型下的新增一项检查**，不是发明新模式

### 设计

**1. 创建 run 时计算 `input_hash`**——对规范化后的输入（`JSON.stringify` 前先按
key 排序，同 `computeBlogContentHash` 的规范化手法）算 SHA-256，只在
`definition.reversible === false` 时触发（这条分支不影响其余所有 `reversible:
true` 的动作，包括已实施的 `ads.meta_boost_sandbox_reel`）：

```typescript
// src/lib/kernel/input-hash.ts（新文件，纯函数，不连网、不连库）
export function computeInputHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort())
  return createHash('sha256').update(canonical).digest('hex')
}
```

**2. 审批页面展示由同一份输入生成的关键摘要**——这是 M6（仍冻结）的活，本设计
只声明契约：审批 UI 必须直接读 `run.input`（不能读别的缓存/衍生表），展示的每一
个字段都必须是 `computeInputHash` 实际纳入计算的那些字段，不能"展示的"和"算
hash 的"是两份不同的数据（那样 hash 校验通过也证明不了人看到的是真的）。

**3. 批准时把下列内容写进 `authorization_decisions.policy_snapshot`**（只在
`definition.reversible === false` 时；`reversible: true` 的动作走原有
`snapshotOf()`，一行不改）：

```typescript
// authorize.ts 的 insertDecision 调用点，reversible===false 分支新增逻辑
policy_snapshot: {
  ...snapshotOf(policy, definition),  // 原有的 policy/definition 元信息，照样留着
  approval_binding: {
    run_id: run.id,
    input_hash: computeInputHash(run.input),
    definition_action_key: definition.actionKey,
    definition_version: definition.version,
    // 下面这些字段本来就在 run.input 里（对"激活"动作而言，provider object id /
    // reservation id / 金额本来就是它的输入——见下方"对未来激活动作的影响"）；
    // 在这里再摘一份出来，是为了让审批记录本身可读——人/审计翻这一行 JSON
    // 就能看懂批的是什么，不用反查 run.input 再解一次 hash。
    provider_object_ids: extractProviderObjectIds(run.input),  // 例如 {campaign_id, ad_set_id, creative_id, ad_id}
    reservation_id: run.input.reservation_id,
    money: run.input.money,  // {amountNzd, amountUsd, rate, rateSource, lockedAt}——M2 money-contract.ts 的产物
  },
}
```

**4. Gateway 执行前重新计算并比对**（新逻辑，插在 Gateway 拿到 `AuthorizedExecution
Context` 之后、真正调用 `capability.steps[...]` 之前）：

```typescript
// gateway.ts，仅对 definition.reversible === false 的动作生效
if (definition.reversible === false) {
  const decision = await loadDecision(deps.supabase, ctx.decisionId)
  const currentInput = await loadRunInput(deps.supabase, ctx.runId)  // 重新从库里读，不信任何缓存
  const currentHash = computeInputHash(currentInput)
  const approvedHash = (decision.policy_snapshot as { approval_binding?: { input_hash?: string } })
    .approval_binding?.input_hash
  if (currentHash !== approvedHash) {
    // 🔴 不一致：立即拒绝，capability 一次都不许被调用
    return denyRun(deps, ctx, 'INPUT_HASH_MISMATCH', // 新 KernelErrorCode，见下
      '这次执行的输入跟当初批准时的不是同一份——已停手，不会调用 capability')
  }
}
```

**5. `KernelErrorCode` 新增一个码**：`INPUT_HASH_MISMATCH`——跟已有的
`STALE_DECISION`（"看到的是上一版审批请求"）语义不同：`STALE_DECISION` 说的是
"审批流程本身过期了"，`INPUT_HASH_MISMATCH` 说的是"内容变了"，两者原因和处置都
不一样，不能共用一个码（同 `KernelErrorCode` 现有的 `STALE_DECISION` vs
`INVALID_STATE` 拆分的那条理由）。

### 为什么这样能证明"人批的就是这份"

`action_runs.input` 写入后不可变（现状核实②已确认）→ `computeInputHash(run.input)`
在 run 存在的整个生命周期里是**同一个值** → 批准那一刻把它记进
`authorization_decisions`（append-only，同样不可变）→ Gateway 执行前重新算一次、
跟当初记的比 → 两次算的是同一个不可变值的同一个函数，只要中间没人在数据库层面
直接改写 `run.input`（那已经是另一个更严重的问题，不在这份契约能防的范围内，是
数据库层面的完整性保证），"人批的" = "现在要执行的"就是**同一件事**，不再需要
Capability 自证。

## 二、`costReservation`：按 Build Control 裁决重写

否掉"必须是 `steps[0]`"这条死板要求。正确表述：

> 在第一次会产生费用或不可逆影响的 provider 写操作之前，必须已经存在一个有效
> 且额度充足的 reservation。允许在它之前有纯读取、校验、reconcile 类的步骤，
> 但这些步骤本身不许产生费用、不许产生不可逆影响。

```typescript
export interface IrreversibleOutwardContract {
  // ...其余字段不变（见下方完整定义）...
  readonly costReservation: {
    /**
     * 契约作者必须在这里列出"这个动作里哪些 step 允许发生在预留之前"，
     * 每一个都要标注为什么它不产生费用/不产生不可逆影响。
     * 校验函数不能自动判断"这一步花不花钱"（那是业务语义），
     * 只能强制作者显式声明、逼作者当场回答这个问题。
     */
    readonly stepsAllowedBeforeReservation: readonly {
      readonly step: string
      readonly whyNoIrreversibleEffect: string
    }[]
    /** 预留发生在哪一步（可以不是 steps[0]，但必须在上面豁免清单之外）。 */
    readonly reservedAtStep: string
    readonly mechanism: string
  }
}
```

校验函数对应改为：`reservedAtStep` 不许出现在 `stepsAllowedBeforeReservation` 里
（自相矛盾），且 `reservedAtStep` 必须排在"第一个不在豁免清单里的 provider 写步骤"
之前——这条时序关系靠 `steps` 数组的顺序判断（`steps.indexOf(reservedAtStep) <=
steps.indexOf(firstNonExemptStep)`）。

## 三、`stopFutureEffect`：完整状态机（按 Build Control 裁决重写）

**Gateway 不无条件自动调用 `stopFutureEffect`。** 正确顺序：

```
激活结果未知（provider 调用超时/网络错误/HTTP 5xx）
  │
  ▼
按 deterministic tag / provider object id 做 reconcile
（复用 M1 已实施的 findByTag 同款手法：查明 provider 端真实状态）
  │
  ├─ 确认「未激活」（provider 端查无此对象的 ACTIVE 状态，或对象仍是 PAUSED）
  │    → run 结束，不调用 stopFutureEffect（没什么好停的，压根没激活）
  │    → reservation 从 committed 移回 reserved（钱确实没花出去）
  │
  ├─ 确认「已激活」（provider 端查到对象确实是 ACTIVE）
  │    → 立即调用 stopFutureEffect（例如 pause）
  │    ├─ pause 成功 → run 落 failed（不是 succeeded——本来想做的是"激活并保持"，
  │    │                实际做成了"激活又停了"，跟批准的不是同一件事）；
  │    │                needs_human: true（人要看一眼这期间到底产生了多少影响）；
  │    │                reservation 保持 committed（钱确实花了，如实记账，
  │    │                不因为"及时停了"就假装没花）
  │    └─ pause 失败 → **不得标成安全失败**。落 dead_letter + needs_human: true
  │                     （复用既有机制，见下）；reservation 继续 committed 不释放；
  │                     立即进 Operating Brief/告警管道；禁止自动重试激活
  │
  └─ 查到多个 / 状态本身还是查不出来（reconcile 自己也失败或结果有歧义）
       → 同上：dead_letter + needs_human: true，reservation 继续占用，
         立即告警，禁止自动重试
```

**"事故态"复用既有机制，不新增 `RunStatus` 枚举值**（R2 新增核实）：

`gateway.ts` 的 `failRun()`（`gateway.ts:1087-1110`）已经把失败统一落
`status: 'dead_letter'` + `needs_human: true`，而 `kernel/handoff.ts` "靠
`needs_human=true` 把死信捞进今日待办"（`gateway.ts:1084` 原话）——这正是
"立即进入 Operating Brief/告警"要求的现成管道，不需要发明新状态、不需要碰
`RunStatus` 这个封闭枚举（改它会牵动所有按 status 判断的既有代码和 UI，属于
被否掉的"大型重构"范畴）。本设计只要求：**pause 失败 / reconcile 歧义** 这两条
路径必须走 `failRun()` 的形状（`dead_letter` + `needs_human: true` +
`last_error` 写清楚是"provider 端可能已经在花钱、需要人工去核实/手动停"），
不能被误判成 Kernel 现有的其他"可恢复"deny 码（`RECOVERABLE_DENY_CODES` 那个
白名单——`dead-recovery.test.ts` 已经证明过白名单外的码连自动恢复都不许发生，
这条边界本身够用，不用改）。

```typescript
export interface IrreversibleOutwardContract {
  // ...
  readonly stopFutureEffect: {
    readonly capability: string
    readonly description: string
    /**
     * reconcile 判"已激活"之后调 stopFutureEffect；它自己失败时必须落
     * dead_letter + needs_human:true，不许算成 failed 的"普通失败"，
     * 也不许自动重试。这条要求写在契约里，靠 Gateway 强制（见下一节），
     * 不是 capability 自愿遵守。
     */
    readonly onStopFailure: 'dead_letter_needs_human'  // 目前只有这一个合法值，
                                                         // 写成字面量联合类型是为了
                                                         // 未来万一要加别的处置方式
                                                         // 时编译期看得见改动点
  }
}
```

## 四、Gateway 强制执行（R2 新增：声明式契约配执行层）

**Capability 只负责 provider 操作和 provider 状态解释，不能自己担任授权证明人。**
以下六项由 **Gateway** 统一强制，不依赖 Capability 自觉、也不只是 ActionDefinition
声明了就自动成立：

| # | 要求 | Gateway 怎么强制 |
|---|---|---|
| 1 | approval input hash 验证 | 见"一、批准快照绑定"§4，执行前比对，不一致直接拒绝，capability 不被调用 |
| 2 | reservation 有效性验证 | 执行第一个"豁免清单之外"的 provider 写步骤前，Gateway 查 `ads_spend_reservations`（或未来其他动作各自的预留表）确认存在一条状态为 `reserved` 且额度覆盖本次 `costModel.estimate()` 的记录；查不到/额度不够，拒绝执行该步骤 |
| 3 | `maxAttempts === 1` | Gateway 的重试逻辑读 `definition.retryPolicy.maxAttempts`；对 `irreversibleOutwardContract` 非空的动作，Gateway 在**代码层面**（不只是校验函数）拒绝任何 `attempt > 1` 的调用尝试——即使有人手工触发 dead-letter 重跑，也在 Gateway 入口挡住，不能指望 `retryPolicy` 字段"自觉" |
| 4 | `verification` 非空 | 已有机制：`gateway.ts:1034` 的 `if (definition.verification)` 块——本设计要求这条对 `irreversibleOutwardContract` 非空的动作从"如果声明了就检查"变成"必须声明"（`irreversibleOutwardBlockReason` 里已经强制），Gateway 侧不用改，注册闸已经保证前提成立 |
| 5 | 未知结果强制进 reconcile | Gateway 捕获 provider 调用的"结果不确定"类异常（超时/5xx/网络错误——同 `RetryableCapabilityError` 但语义是"不知道"不是"能重试"）时，**不允许**该异常沿用现有"记 KernelError 直接 failRun"的路径，必须先路由进契约声明的 `reconcileOnUnknownOutcome.mechanism` 对应的处理函数，由它产出确定性结论（已激活/未激活/仍不确定）后，Gateway 才继续往下走三、里的状态机 |
| 6 | `stopFutureEffect` 路径存在性检查 | 注册时（不是运行时）：`irreversibleOutwardBlockReason` 校验 `stopFutureEffect.capability` 指向的函数在 `capabilities/` 目录下真实存在且被对应的 `CapabilityImplementation` 引用——防止"契约里写了一个不存在的函数名"这种声明与实现脱节 |

## 五、完整类型定义（整合 R2 全部修订）

```typescript
// src/lib/kernel/types.ts 新增（不改动任何既有字段含义，纯加法）

export interface IrreversibleOutwardContract {
  readonly requiresRequireApprovalMode: true

  readonly costReservation: {
    readonly stepsAllowedBeforeReservation: readonly {
      readonly step: string
      readonly whyNoIrreversibleEffect: string
    }[]
    readonly reservedAtStep: string
    readonly mechanism: string
  }

  readonly approvalSnapshotBinding: {
    /** 恒为 true：批准快照绑定现在是 Gateway 强制的，不是可选项。 */
    readonly enforcedByGateway: true
  }

  readonly maxAttempts: 1

  readonly reconcileOnUnknownOutcome: {
    readonly mechanism: string
  }

  readonly verification: VerificationSpec

  readonly stopFutureEffect: {
    readonly capability: string
    readonly description: string
    readonly onStopFailure: 'dead_letter_needs_human'
  }
}

export interface ActionDefinition<K extends ActionKey = ActionKey> {
  // …现有全部字段一个不改…
  readonly irreversibleOutwardContract: IrreversibleOutwardContract | null
}

export type KernelErrorCode =
  | /* 现有全部码不变 */
  | 'INPUT_HASH_MISMATCH'  // 新增
```

`irreversibleOutwardBlockReason()` 的完整校验清单（R2 版）：

```typescript
export function irreversibleOutwardBlockReason(definition: ActionDefinition): string | null {
  if (definition.sideEffect !== 'outward') return null
  if (definition.reversible === true) return null

  const c = definition.irreversibleOutwardContract
  if (!c) return '…没有 IrreversibleOutwardContract，不放行…'
  if (c.requiresRequireApprovalMode !== true) return '…'
  if (!c.approvalSnapshotBinding?.enforcedByGateway) return '…批准快照绑定必须声明由 Gateway 强制…'

  const exempt = new Set(c.costReservation?.stepsAllowedBeforeReservation?.map(s => s.step) ?? [])
  if (exempt.has(c.costReservation?.reservedAtStep)) {
    return '预留发生的那一步不能同时在豁免清单里 —— 自相矛盾'
  }
  const firstNonExempt = definition.steps.find(s => !exempt.has(s) && s !== c.costReservation?.reservedAtStep)
  if (firstNonExempt && definition.steps.indexOf(c.costReservation?.reservedAtStep) > definition.steps.indexOf(firstNonExempt)) {
    return '预留必须发生在第一个非豁免步骤之前'
  }

  if (c.maxAttempts !== 1 || definition.retryPolicy.maxAttempts !== 1) return '…maxAttempts 必须是 1…'
  if (!c.reconcileOnUnknownOutcome?.mechanism) return '…必须声明 reconcile 机制…'
  if (!c.verification || !definition.verification || c.verification.method !== definition.verification.method) {
    return '…verification 必须存在且跟 ActionDefinition.verification 一致…'
  }
  if (!c.stopFutureEffect?.capability || c.stopFutureEffect.onStopFailure !== 'dead_letter_needs_human') {
    return '…必须声明 stopFutureEffect 且失败处置是 dead_letter_needs_human…'
  }
  return null
}
```

## 对 `ads.meta_boost_sandbox_reel` 的影响：零（不变）

已实施动作 `reversible: true`，走原有路径，本 ADR 全部内容都不碰它——包括新增
的 `input_hash` 批准绑定逻辑（只在 `reversible === false` 分支触发）。

## 对未来"激活"动作的影响（举例，不实施）

```typescript
const ADS_META_ACTIVATE_SANDBOX_REEL: ActionDefinition<'ads.meta_activate_sandbox_reel'> = {
  sideEffect: 'outward',
  reversible: false,
  outwardAuthorization: null,  // reversible:false 时必须是 null，走 irreversible 那条路
  irreversibleOutwardContract: {
    requiresRequireApprovalMode: true,
    costReservation: {
      stepsAllowedBeforeReservation: [
        { step: 'reconcile_current_state', whyNoIrreversibleEffect: '只读 Meta 当前状态，不写' },
      ],
      reservedAtStep: 'commit_spend',  // commit()：把 reserved 移到 committed
      mechanism: 'ads_spend_reservations.commit()（M2 已实施）',
    },
    approvalSnapshotBinding: { enforcedByGateway: true },
    maxAttempts: 1,
    reconcileOnUnknownOutcome: { mechanism: 'post-boost-publisher.findByTag()（M1 已实施）' },
    verification: { method: 'meta_ad_activation_readback', delayMs: 0 },
    stopFutureEffect: {
      capability: 'post-boost-publisher.pauseBoostAd（新函数，activateBoostAd 的逆操作）',
      description: '把三层对象重新 PAUSED，停止后续展示/点击/花费',
      onStopFailure: 'dead_letter_needs_human',
    },
  },
  // input 里必须含：object_story_id 对应的 campaign_id/ad_set_id/creative_id/ad_id
  // （来自 ads.meta_boost_sandbox_reel 的 output）、reservation_id、money 快照
}
```

## 明确不做的事（不变，逐条对应指令）

- 不做大型 `reversibilityScope` 重构：`reversible: boolean` 一个字不改，
  `reversible===true` 路径（含已实施动作）完全不受影响
- 不新增 `RunStatus` 枚举值：复用既有 `dead_letter` + `needs_human` 机制
- 不调用 Meta、不 apply migration（`policy_snapshot` 是既有 JSONB 列，扩展内容
  不是 schema 改动）、不部署
- 本次会话到此为止，等 Build Control 聚焦 R2 复审；若上述绑定闭环成立，
  就可以冻结最小不可逆 outward 契约

## 仍然开放的问题（R2 缩小范围后剩下的）

- [ ] `INPUT_HASH_MISMATCH` 这个新 `KernelErrorCode` 加进去之后，
      `RECOVERABLE_DENY_CODES` 白名单要不要收它——直觉是**不收**（内容变了必须
      重新走一遍完整审批，不是"环境问题改一下规则就能恢复"那一类），但这条
      需要复审确认，不是我能单方面拍板的技术细节（它决定了"内容变更后要不要
      重新算一次 idempotency key"这类下游行为）
- [ ] "reservation 有效性验证"（Gateway 强制清单 #2）目前只对 M2 已实施的
      `ads_spend_reservations` 表写死；如果未来出现第二个不可逆对外动作用
      不同的预留机制，Gateway 这段逻辑需要变成按 `costReservation.mechanism`
      分派，而不是硬编码查一张表——本设计不展开这个分派机制怎么做，等真的
      出现第二种预留机制时再设计
- [ ] `stopFutureEffect` 路径存在性检查（Gateway 强制清单 #6）说的是"注册时
      静态检查函数存在"，没有覆盖"这个函数的实现是不是真的做对了"（那是测试
      的职责，不是注册闸的职责）——这条边界本设计认为合理，但值得在复审里
      确认没有遗漏
