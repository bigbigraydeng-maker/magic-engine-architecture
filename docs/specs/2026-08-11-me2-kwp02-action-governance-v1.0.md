# Magic Engine 2.0 · K-WP02 动作治理 v1.0

> Issue [#882](https://github.com/bigbigraydeng-maker/magic-engine/issues/882)（K-WP02）· 父史诗 [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872)
> 上游：[WP00 契约冻结 v1.0](./2026-08-10-me2-wp00-contract-freeze-v1.0.md) · [执行内核 v1](./2026-08-08-me2-execution-kernel-v1.md)
> 下游消费者：[#881 K-WP01](https://github.com/bigbigraydeng-maker/magic-engine/issues/881)（审批界面渲染这里定义的词汇）· [#880 WP07](https://github.com/bigbigraydeng-maker/magic-engine/issues/880)（第一个真实对外动作）· [#879 WP05](https://github.com/bigbigraydeng-maker/magic-engine/issues/879)（生成端消费词汇表 API）
> 状态：**代码已合并，零调用方、零生产 ActionKey 新增。**
> 含一条兼容性前向 migration（见 §7）—— **合并这个 PR 不代表授权或执行了 migration apply**，
> 把它 apply 到任何环境（开发 / 预览 / 生产）是单独的运维决定。

---

## 1. 这个 WP 解决的那一件事

域模块提出的是**候选**（`{domain, intent}` 这样的意图），内核认的是**封闭的 `ActionKey`**。
在这之前，两者之间没有任何东西 —— 而"没有东西"在实践中会变成"谁想接谁自己接一根线"，
最终就是 WP00 §6 记录的那个现状：36 种自由文本，同义词重复，跟注册表对不上。

本 WP 交付**一根受治理的线**，外加**让对外动作有可能存在**的那道逐动作许可。

**不交付**：调用方、dispatcher、编排器、审批界面、任何新的生产 ActionKey。

---

## 2. 依赖方向（冻结）

```
src/lib/growth/**          →  不 import kernel，也不 import bridge
src/lib/action-bridge/**   →  只 import kernel 的 types 与 registry
src/lib/kernel/**          →  不 import growth，也不 import bridge
```

**为什么 bridge 不放进 Kernel**：放进去之后，Kernel 每接一个新域就要多 import 一个域模块 ——
治权的那一层反过来挂在被它治理的那些层上。第二个域模块进来时这条路就走不通了。

**为什么 bridge 不 import Growth**：bridge 自己声明 `CandidateIdentity`（`{domain, intent}`）。
`GrowthActionCandidateIdentity` 结构上就是这个形状，所以 TypeScript 的**结构化类型**让它直接满足，
两边谁都不用 import 谁。将来 WP05 或任何域模块带自己的候选类型过来，只要形状一样就能过，
bridge 一个字都不用改。

三条都由 `boundaries.ts` + 架构测试机器强制（`KERNEL_FORBIDDEN_MODULE_IMPORTS` /
`ACTION_BRIDGE_FORBIDDEN_IMPORTS`），两侧各有独立断言：删掉任意一侧，另一侧仍然拦得住自己那半边。

---

## 3. 候选身份 → ActionKey

### 3.1 判别联合是诚实的

```ts
type CandidateMappingResult =
  | { readonly outcome: 'mapped'; readonly actionKey: ActionKey; readonly actionVersion: number }
  | { readonly outcome: 'rejected'; readonly code: CandidateMappingRejectionCode; readonly reason: string }
```

早先设计过 `{ ok: boolean; actionKey?; reason? }`。那个形状允许 `{ok: true}` 不带 key，
也允许失败结果带着 key —— 两种都不该表达得出来。现在 `mapped` 必须完整带上 key 与版本，
`rejected` **结构上**带不了成功字段（有运行时断言盯着这两条）。

`actionVersion` 从**注册表**读，不从配对表读 —— 配对表里存版本号 = 契约升版之后两边悄悄对不上。

### 3.2 三种拒绝，分得开

| code | 含义 | 谁该动手 |
|---|---|---|
| `malformed_identity` | 身份根本不成立：缺字段 / 不是字符串 / 去掉空白后是空的 | 修调用方 |
| `unmapped_identity` | 身份是好的，只是没有受治理的配对认领它 | 走治理加一条配对（改代码、过 PR） |
| `registry_drift` | 配对指向的 ActionKey 注册表里没有 | 配置漂移，把两边对齐 |

压成一句"映射失败"的话，这三件事的处置就没法分开了。

### 3.3 精确配对，不拼字符串

配对表是**数组**，两个字段各自 `===`：

```ts
table.find(c => c.domain === identity.domain && c.intent === identity.intent)
```

用 `${domain}:${intent}` 当键会让 `{domain:'geo:x', intent:'y'}` 和 `{domain:'geo', intent:'x:y'}`
撞成同一个键 —— 一个分隔符就能把两个不同的候选映射到同一个动作。有专门的用例盯着这条。
不做大小写规范化、不 trim 后匹配、不模糊匹配：**受治理**的意思就是"逐字对上才算"。

### 3.4 入参是 `unknown`

公开的 mapper 不假设调用方满足了 TypeScript 类型 —— 类型在运行时不存在，
`null` / 数组 / 缺字段 / 数字全都能穿过一个声明成 `CandidateIdentity` 的形参。
所有输入先安全读，读不成返回 `malformed_identity`，**不抛异常**。

### 3.5 当前状态：配对表是空的

没有真实调用方之前不预注册任何 GEO / Page / SEO 动作。
预注册等于把"将来大概会用到"写成"现在已经批准了"。

**拒绝只是一个返回值。** 本模块不写库、不落审计。将来的调用方负责把结构化拒绝持久化留痕；
当前没有调用方，所以现在什么也没被留痕 —— 这句话必须如实说。

---

## 4. 受治理的词汇表 API

```ts
listGovernedActionVocabulary(): readonly GovernedActionVocabularyEntry[]
```

由**配对表 ⋈ 注册表**派生：`domain` / `intent` 来自配对表，`title` / `sideEffect` 来自注册表。
全仓不存在第二份手写的动作清单 —— 手写第二份的下场就是 Kernel spec §11 缺口 #1 写的那句：
"从 36 种自由文本变成 36 种自由文本 + 一张对不上的表"。

- 注册表漂移**当场抛** `GovernedVocabularyConfigurationError`，不静默过滤、不返回残缺清单。
  悄悄跳过一条，生成端拿到的就是少了东西的词汇表，而没有人会发现少了什么。
- 当前返回 `[]`（配对表是空的）。
- **零生产调用方。** legacy 的 `zhuge/conductor.ts` 不在此列 —— 本 WP 不碰它。

**冻结**：将来的 ME2 域模块（WP05 起）**必须**消费这个 API，不许自己发明动作名。

---

## 5. 逐动作的对外副作用授权

### 5.1 换掉了什么

| | 之前 | 现在 |
|---|---|---|
| 注册表 | 一律不许出现 `outward` 动作（架构测试硬拦） | 允许出现，**但必须逐条说清凭什么** |
| 授权层 | 无条件拒绝所有 `outward` | 判 `outwardBlockReason()`，缺一项就拒 |
| Gateway | 无条件拒绝所有 `outward` | 同一个判据独立再判一次 + 复核放行是不是人签的 |
| 默认 | 拒绝 | **仍然是拒绝** |

变的是"不可能"→"除非逐条说清楚"。**没变的是默认拒绝，以及不存在任何全局开关。**
放宽的唯一方式是给某一个 `ActionDefinition` 补一份完整声明 —— 那是一行写在版本控制里、必须过 review 的 diff。

### 5.2 声明

```ts
readonly outwardAuthorization: OutwardAuthorization | null   // null = 不放行，这是默认

interface OutwardAuthorization {
  readonly declaredIn: string                                 // 出处，空白不算
  readonly requiresHumanApproval: true                        // 字面量 true
  readonly rollback: 'provider_native' | 'snapshot_restore'   // 说不清怎么撤回的不许存在
}
```

判据是这份声明**在不在**，不是某个字段的值 —— 给字段一个默认值会让"忘了声明"和"明确批准了"
在代码里长得一模一样（跟客户政策"查不到 = 拒绝"同一个道理）。

### 5.3 完整判据（`outwardBlockReason`）

非 `outward` 的动作直接返回 `null`（这道闸只管对外许可这一件事）。`outward` 的动作要全部满足：

1. `outwardAuthorization !== null`
2. `declaredIn` 去掉空白后非空 —— 出了事要能追到这条许可是谁、按哪份文件给的
3. `requiresHumanApproval === true`
4. `rollback` 是两个合法值之一
5. 🔴 **`reversible === true`** —— v1 只放行可逆的对外动作
6. `providerIdempotency !== 'not_applicable'` —— 对外动作说自己不调外部服务是自相矛盾
7. **每一个 step 都有显式、有限、非负的 `stepCeilingUsd`**

**第 5 条要单说：声明不许盖过事实。** 一个自称 `reversible: false` 的动作，
填一个 `snapshot_restore` 也**不放行** —— 撤回路径写得再清楚，也改不了"它自称撤不回来"这个事实。
真要放开不可逆的对外动作，那是一次单独的、要重新评估风险的决定，不是填字段能换来的。

**第 7 条要单说：不吃内部动作那个兜底。** `nextStepCostCeiling`（gateway.ts）对内部动作有一条
"整体 estimate 为 0 就视为每步 0"的兜底。对外动作**不适用** —— "它不花钱"对一个真的会打到
外部服务的动作来说，是要逐步写下来的承诺，不是推断出来的。

### 5.4 三道闸，各自独立

| 闸 | 位置 | 只有它能拦的是什么 |
|---|---|---|
| 授权层结构闸 | `authorize.ts` preflight ⑤ | 提交阶段就拒，capability 一次都不调，决策表留 `outward_side_effect_blocked` |
| 授权层人工闸 | `authorize.ts` preflight ⑥b | `outward` + 客户政策是 `auto_approve` → 拒（自动永远不足以放行对外动作） |
| Gateway 结构闸 | `gateway.ts` ③ | 授权签发**之后**声明被抽走 / 注册表被换掉 |
| Gateway 人工闸 | `gateway.ts` `assertDecisionMatches` | 放行不是人签的（授权层被改坏、被绕过、或将来多一条签发路径时） |

**Gateway 结构闸的位置是刻意的**：在第 ④ 步重读决策、第 ⑥ 步 `kernel_begin_authorized_run`
兑换授权**之前**。被它拦下的对外动作，授权一次都不会被消费掉。

**为什么共用一个 predicate**：防两边判据漂移（本仓有"两处清单不许分家"的先例）。
**为什么仍算两道独立的闸**：拆掉任意一处，另一处仍然拦得住，且各自有一个**只有它能满足**的用例
—— 见 §6。

### 5.5 `auto_approve` 为什么是拒绝而不是"自动升级成要审批"

把客户明确配成自动的规则在背后改判成人工，会让设置页显示的和实际发生的成两回事。
配错了就说清楚该怎么配，而不是替他兜着。

---

## 6. 遮蔽闸：这一轮又撞上了一次

本仓一路在防的形状是「一道闸被它前面那道遮住，拆掉都没人发现」。这一轮写 Gateway 人工闸的测试时又撞上了：

第一版把决策的 `decided_by` 改成 `policy`，政策却还留在 `require_approval` ——
于是**既有**的模式复核（"机器签的放行只在政策仍是 auto_approve 时有效"）先报了 `POLICY_CHANGED`，
新加的那道闸整个被遮住，**拆掉它测试照样绿**。

补法跟前几轮一致：把库状态摆成「既有那道闸看着完全正常」的样子 ——
机器签的放行 **+ 政策确实是 `auto_approve`**。这样既有的模式复核不开火，
唯一还站着的就是新那一句。

每道闸都配了单独的变异探针（见 `scripts/kernel-mutation-check.py` 的 K-WP02 段），
判据是"**这道闸和它前面那道，观测到的差别是什么**"，不是"测试是不是绿的"。

---

## 7. 明确不在本 WP 范围内

- 任何新的生产 `ActionKey`（配对表和注册表都没加东西）
- 任何 stub / placeholder capability
- 调用方、dispatcher、编排器、审批 UI / API
- schema、生产查询 —— `action_key` 在三张表上是普通 `text` 列，本 WP 治理映射本身不需要任何 schema 改动
- `zhuge/conductor.ts`、`execution/auto-run.ts`、`src/lib/growth/**`、`src/lib/capabilities/**` 一律不碰
- `.eslintrc.json` 不动（既有的架构测试机制足以表达这两条新边界）

> **例外（有 migration）**：修复 BCR blocker「auto_approve 错配会永久锁死同一幂等动作」时，
> `kernel_claim_run_recovery` 的可恢复白名单需要加一个新拒绝码 `outward_requires_human_policy`。
> 已合并进 main 的历史 migration（`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql`）
> 保持不可变，改动落在新增的**兼容性前向 migration**
> `supabase/migrations/20260811040000_kernel_recovery_outward_requires_human_policy.sql`
> （`CREATE OR REPLACE FUNCTION` 重建同一个函数，白名单加一条，函数体其余部分逐字相同 ——
> 已经 apply 过历史 migration 的环境也能拿到新白名单）。
> **这条 migration 随本 PR 的代码一起合并，但 apply 与否是独立的操作授权，不因合并而自动发生。**

---

## 8. WP07 接第一个真实对外动作时要做什么

**只做一件事：写一个合规的 `ActionDefinition`。**

不用改任何闸、任何判据、任何测试断言 —— 架构测试用的是
`expect(outwardBlockReason(def)).toBeNull()`，对新动作自动生效。

清单：

1. `sideEffect: 'outward'`、`reversible: true`
2. 完整的 `outwardAuthorization`（`declaredIn` 写 WP07 的 issue / spec）
3. `providerIdempotency` 逐个 provider 确认后如实填 `supported` / `unsupported`
   （WP00 §8.4 与 Kernel spec §11 缺口 #11：不支持幂等键的要么不接，要么显式标注只保证 at-least-once）
4. 每一步的 `stepCeilingUsd`
5. `createCapabilities()` 里加上对应实现（架构测试盯着两个集合完全对齐）
6. 客户政策配成 `require_approval`（`auto_approve` 会被拒）
7. 在 `MAPPING_TABLE` 里加一条配对，域模块才提得出它

**并且它仍然需要 K-WP01 的审批入口才能真正跑起来** —— 对外动作一律要人点头，
而"等人点头"这条路在 K-WP01 之前没有入口（`KERNEL-E7-APPROVAL-SURFACE`）。

---

## 9. 未决 / 留给后续

| # | 未决 | 谁来决 | 卡住谁 |
|---|---|---|---|
| K1 | 不可逆的对外动作要不要放开、按什么条件 | Build Control Room | 只在出现"确实撤不回来但必须做"的动作时才需要决 |
| K2 | 配对表要不要支持一个候选身份映射到多个 ActionKey（按客户 / 按 provider 分流） | Build Control Room | WP05 提出真实需求时再决；当前一对一 |
| K3 | `declaredIn` 要不要做成结构化引用（issue 号 + spec 路径）而不是自由文本 | Build Control Room | 不卡任何 WP |

三条都以未决形态存在，任何 WP 把它当既定假设直接实现即为越界。
