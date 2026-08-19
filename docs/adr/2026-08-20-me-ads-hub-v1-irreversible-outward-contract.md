# ADR: 最小 Kernel 不可逆对外动作契约（IrreversibleOutwardContract）

**状态：DESIGN ONLY —— 等 Build Control Review，本文档之外零代码改动**
**日期**：2026-08-20
**关联**：`docs/adr/2026-08-20-me-ads-hub-v1-reversibility-recovery-contract.md`（被本文档取代的早期方案）、
`src/lib/kernel/registry.ts` 的 `ads.meta_boost_sandbox_reel`（M3，已实施，边界只到 PAUSED+verified+linked）

## 背景：为什么不能延用"两条动作"的路子

Day 1 → R2 → M3 的推进过程中，我最初提议"激活"（真花钱那一步）完全绕开 Kernel，
走一条独立的、不经过 Kernel 授权机制的手工 API 路由。**Build Control 明确否掉了这条路**：
不许建立绕过 Kernel 的 activate route。

被否的理由是对的：Kernel 存在的意义就是"所有会影响客户外部资产的动作，都要经过
同一套授权 + 审计 + 幂等 + 恢复机制"。如果"最危险的那一步"（真的花钱）反而是唯一
绕开这套机制的动作，Kernel 的治理范围就出现了一个洞——而且是刻意开在风险最高处的洞。

正确的方向不是把"激活"挪出 Kernel，是**扩展 Kernel 自己的契约词汇表**，让它能够
诚实地、有节制地authorize 一个真正不可逆的对外动作 —— 这正是
`outward-authorization.ts` 代码注释自己留的口子：

> "真要放开不可逆的对外动作，那是一次单独的、要重新评估风险的决定"

Build Control 现在做的就是这个决定。本 ADR 是这个决定的最小化设计。

## 现状核实（读代码，不是猜的）

在设计前核实了三件事，避免重新发明已经存在的机制：

1. **`requires_approval` 已经是既有铁律，不需要新契约重复保证**
   `src/lib/kernel/authorize.ts:351-368`：任何 `sideEffect==='outward'` 的动作，只要
   `policy.mode==='auto_approve'`，一律被 `outward_requires_human_policy` 拒绝
   ——不区分 `reversible` 真假。这条闸**已经**对不可逆对外动作生效，新契约不用
   重新实现它，只需要显式声明"我知道这条已经保护着我"（逼写契约的人确认，而不是
   假设）。

2. **"批准快照绑定"目前是真的空的**
   `src/lib/kernel/authorize.ts:66-91` 的 `snapshotOf()` 只快照 `policy` 和
   `definition` 的元信息（mode / cost cap / risk / reversible / capability…），
   **不包含 `run.input` 的具体内容**。也就是说，人批准的是"这类动作、这条政策、
   这个成本上限"，不是"这次具体要建的这条广告草案"。对 `seo.build_publish_package`
   这种 `internal_write` 动作，这够了——出问题能事后改。对不可逆对外动作不够——
   人点头那一刻必须看到的是"即将真实发生的这件事"，不是"这类动作的抽象规则"。

3. **`action_runs.input` 天然不可变，但从没被当作一份契约来利用**
   全仓库搜不到任何对 `action_runs.input` 列的 UPDATE（`store.ts`/`runner.ts` 都
   没有）——写入后不可变已经是事实，只是没人正式把这个事实当成"批准快照绑定"的
   地基来用。`seo.build_publish_package` 的 `build` 步骤自己重新算一次
   `content_hash` 跟 `input.content_hash` 比对（`build-publish-package.ts:160-170`）
   ——这是**capability 自己加的自觉**，不是 Kernel 强制的契约。不可逆动作不能靠
   "自觉"，必须是契约里的硬性要求。

## 设计：`IrreversibleOutwardContract`

**只在 `sideEffect==='outward' && reversible===false` 时生效。`reversible===true`
的对外动作（含已实施的 `ads.meta_boost_sandbox_reel`）完全不受影响，走原有的
`outwardAuthorization`/`outwardBlockReason` 路径，一行都不改。**

这不是把 `reversible: boolean` 换成一个连续的 `reversibilityScope`——那是被
Build Control 明确否掉的"大型重构"方向。这是给"`reversible===false` 还想申请
对外授权"这一种**特例**，开一条门槛更高的窄路，两条路径互不干扰。

```typescript
// src/lib/kernel/types.ts（新增类型，不改动任何既有类型的字段含义）

/**
 * 不可逆对外动作能存在的唯一合法路径。
 *
 * 🔴 每一项都不是文档——`irreversibleOutwardBlockReason()`（新函数，镜像
 *    `outwardBlockReason()` 的写法）会逐项校验，缺一项就整个动作注册不进去。
 */
export interface IrreversibleOutwardContract {
  /**
   * 文档化一个已经存在的保证（`authorize.ts:361` 的 outward_requires_human_policy
   * 闸），不是新增控制。要求显式声明 = 逼写契约的人确认自己知道这条保护存在，
   * 不是想当然。
   */
  readonly requiresRequireApprovalMode: true

  /**
   * 成本必须走原子预留，不能只是 `costModel.estimate()` 给的一个数字。
   * `reservedAtStep` 必须等于 `steps[0]`——预留必须是第一件事，不能先做点别的
   * 再补预留（那样万一中途失败，"已经做了但没预留"这个状态没人管）。
   */
  readonly costReservation: {
    readonly reservedAtStep: string
    /** 指到具体实现，不许写"待定" —— 例如 'ads_spend_reservations table + atomic RPC' */
    readonly mechanism: string
  }

  /**
   * 批准快照绑定：解决"现状核实②"发现的空档。`contentHashField` 指明 input 里
   * 哪个字段是这份"即将发生的事"的内容指纹；`recomputedAndCheckedAtStep` 指明
   * 哪一步必须重新计算这个指纹并跟 input 里携带的比对——不一致就拒绝执行
   * （同 `build-publish-package.ts` 的 content_hash 自觉检查，但这里是契约强制，
   * 不是 capability 自愿加的）。
   */
  readonly approvalSnapshotBinding: {
    readonly contentHashField: string
    readonly recomputedAndCheckedAtStep: string
  }

  /** 不许自动重试。必须跟 `retryPolicy.maxAttempts` 保持一致（校验函数会比对两者）。 */
  readonly maxAttempts: 1

  /**
   * 结果不确定时（超时/网络错误/回读对不上）必须先查明真实状态，
   * 不能直接判定失败、不能直接判定成功、更不能自动重试。
   */
  readonly reconcileOnUnknownOutcome: {
    /** 指到具体 probe，不许写"待定" —— 例如 'post-boost-publisher.findByTag' */
    readonly mechanism: string
  }

  /**
   * 验证在这里必填（`ActionDefinition.verification` 本身允许 `null`，
   * 不可逆动作不允许）。校验函数会比对这里的 method 跟
   * `ActionDefinition.verification.method` 是不是同一个。
   */
  readonly verification: VerificationSpec

  /**
   * 停止未来影响的具体能力。过去已经发生的（已花的钱、已产生的展示/点击）
   * 撤不回来，但必须能拦住"继续发生"——这是让"不可逆"这件事在道德/风险上
   * 可以被接受的唯一理由：伤害有上限，不是无限累积。
   */
  readonly stopFutureEffect: {
    /** 哪个 capability/函数负责执行"停止未来影响"。 */
    readonly capability: string
    readonly description: string
  }
}
```

**`ActionDefinition` 的改动**（唯一触及既有类型的地方，且是纯加法）：

```typescript
export interface ActionDefinition<K extends ActionKey = ActionKey> {
  // …现有全部字段一个不改…

  /**
   * 只在 `reversible===false` 时必须给一份完整契约；`reversible===true` 时
   * 必须是 `null`（校验函数会拒绝"明明可逆却声明了不可逆契约"这种自相矛盾）。
   *
   * 跟 `outwardAuthorization` 同一个哲学：默认是 null，"没有"就是没有资格，
   * 不给默认值兜底，因为那会让"忘了声明"和"明确批准了"长得一样。
   */
  readonly irreversibleOutwardContract: IrreversibleOutwardContract | null
}
```

**校验函数**（新增，镜像 `outward-authorization.ts` 的写法和调用方式）：

```typescript
// src/lib/kernel/outward-authorization.ts（新增函数，不改动 outwardBlockReason 一行）

export function irreversibleOutwardBlockReason(definition: ActionDefinition): string | null {
  if (definition.sideEffect !== 'outward') return null
  if (definition.reversible === true) return null // 这类走 outwardBlockReason，不归这条管

  const c = definition.irreversibleOutwardContract
  if (!c) {
    return '这个动作声明了自己不可逆（reversible:false）又是对外动作，' +
      '但没有 IrreversibleOutwardContract —— v1 不放行没有这份契约的不可逆对外动作'
  }
  if (c.requiresRequireApprovalMode !== true) {
    return 'IrreversibleOutwardContract.requiresRequireApprovalMode 必须是字面量 true'
  }
  if (!c.costReservation?.mechanism || c.costReservation.reservedAtStep !== definition.steps[0]) {
    return '成本预留必须发生在第一步（steps[0]），且必须指明具体机制'
  }
  if (!c.approvalSnapshotBinding?.contentHashField || !c.approvalSnapshotBinding.recomputedAndCheckedAtStep) {
    return '必须声明批准快照绑定：哪个输入字段是内容指纹、在哪一步重新校验'
  }
  if (c.maxAttempts !== 1 || definition.retryPolicy.maxAttempts !== 1) {
    return '不可逆对外动作的 maxAttempts 必须是 1（契约声明和 retryPolicy 都要是），不许自动重试'
  }
  if (!c.reconcileOnUnknownOutcome?.mechanism) {
    return '必须声明"结果不确定时"的 reconcile 机制，指到具体 probe'
  }
  if (!c.verification || !definition.verification || c.verification.method !== definition.verification.method) {
    return '验证方法必须存在，且契约声明的跟 ActionDefinition.verification 是同一个'
  }
  if (!c.stopFutureEffect?.capability) {
    return '必须声明"停止未来影响"的具体能力 —— 过去撤不回，但必须能拦住继续发生'
  }
  return null
}
```

**调用点**：`authorize.ts` 和 `gateway.ts`（当前调用 `outwardBlockReason` 的两处）
各自改成：

```typescript
const blockReason = definition.reversible
  ? outwardBlockReason(definition)
  : irreversibleOutwardBlockReason(definition)
```

延续"一个 predicate、两处独立调用"的既有哲学（`outward-authorization.ts` 文件头
原话）——拆掉任意一层，另一层仍然拦得住。

## 对 `ads.meta_boost_sandbox_reel` 的影响：零

已实施的这个动作 `reversible: true`，走原有 `outwardBlockReason`，本 ADR 完全不碰它。
本设计服务的是**未来**要提的"激活"动作（真花钱那一步），那个动作会是：

```typescript
const ADS_META_ACTIVATE_SANDBOX_REEL: ActionDefinition<'ads.meta_activate_sandbox_reel'> = {
  // ...
  sideEffect: 'outward',
  reversible: false,  // 诚实：钱花出去了撤不回来
  outwardAuthorization: null,  // 🔴 reversible:false 时这个字段必须是 null——
                                //    对外授权走 irreversibleOutwardContract，
                                //    两条路径不能同时声明（校验函数会拒绝二者都非空）
  irreversibleOutwardContract: {
    requiresRequireApprovalMode: true,
    costReservation: { reservedAtStep: 'commit_spend', mechanism: 'ads_spend_reservations.commit()（M2 已实施）' },
    approvalSnapshotBinding: { contentHashField: 'draft_summary_hash', recomputedAndCheckedAtStep: 'confirm' },
    maxAttempts: 1,
    reconcileOnUnknownOutcome: { mechanism: 'post-boost-publisher.findByTag()（M1 已实施）' },
    verification: { method: 'meta_ad_activation_readback', delayMs: 0 },
    stopFutureEffect: { capability: 'post-boost-publisher.activateBoostAd 的逆操作（pause）', description: '把三层对象重新 PAUSED，停止后续展示/点击/花费' },
  },
  // ...
}
```

**这不是本 ADR 要实施的内容**——只是证明这份契约设计出来之后，"激活"确实能
诚实地、经过 Kernel 完整授权链路地存在，不需要绕开任何东西。具体这个动作何时
设计、何时提交，等本 ADR 通过复审、且 Build Control 决定要往前推进"真钱激活"
这一步时再单独出。

## 明确不做的事（跟指令逐条对应）

- **不做大型 `reversibilityScope` 重构**：`reversible: boolean` 字段一个字不改，
  `outwardBlockReason` 一行不改，`reversible===true` 的路径（含已实施的
  `ads.meta_boost_sandbox_reel`）完全不受影响
- **不调用 Meta**：本 ADR 只是类型 + 校验函数的设计草案，未落地为代码
- **不 apply migration**：本设计不涉及任何数据库 schema 改动
- **不部署**：本次会话到此为止，等 Build Control Review

## 开放问题（等 Review 拍板）

- [ ] `costReservation.reservedAtStep` 要求是 `steps[0]`——是否要放宽成"必须在
      任何真正花钱的 provider 调用之前"，而不是死板要求"第一步"（如果未来某个
      不可逆动作需要先做一次只读检查再预留，死板要求 steps[0] 会挡住合理设计）
- [ ] `stopFutureEffect` 声明的是"有这个能力"，但没有强制"执行失败时 Kernel
      自动调用它"——这次设计只要求**声明存在**，真正"失败时自动触发 stop"
      是否要做成 Gateway 层的强制行为，还是留给每个 capability 自己在失败路径
      里调用（当前设计倾向后者，因为不同动作"stop"的语义可能不一样，Gateway
      强制调用需要一个统一接口，那是进一步的设计，本 ADR 不展开）
- [ ] `approvalSnapshotBinding` 校验"这一步做了重新计算 + 比对"，但校验函数
      本身没法在**类型层面**验证 capability 真的做了这件事（只能验证契约声明
      了"在哪一步做"）——真正的执行时校验只能靠 code review 或运行时测试，
      这是声明式契约的固有局限，不是本设计能解决的
