# ADR: Money Contract（NZD/USD，ME2 广告中枢 v1）

**状态：设计已实现（代码 + 测试），等 M7 前的窄范围复审**
**日期**：2026-08-20（v1 首版）/ 2026-08-20 修订（Build Control 木桶原则第二轮裁决）
**关联**：Codex 复审 BLOCKER #3（Kernel 记 USD，Meta 账户是 NZD，两边没有换算契约）

## 背景

Kernel 的 `CostModel` / `spend_cap_per_run_usd` 明确按美元记账，`authorize.ts` 判断超顶时
直接拿 USD 数字比大小，没有任何货币转换逻辑。但 v1 的硬顶（总 NZ$300）是**纽币**，
CTS 广告账户也是纽币计费。Day 1 计划草稿曾直接把 `NZ$100` 塞进 `spend_cap_per_run_usd`，
这是一个数字层面的错误 —— 100 不是 100，两个字段单位不一样。

## 决策（v1 简版，不动 Kernel 核心）

**Capability 层做换算 + 汇率锁，Kernel 继续按 USD 记账**。不改 `authorize.ts` 到
`{amount, currency}` 结构 —— 那会影响所有已有的 outward 动作（比如 `seo.build_publish_package`），
v1 阶段风险太大，留到 v1 之后。

**Build Control 第二轮裁决**：最初"精简"方向想把这里砍到只剩 2 个常量 + 1 个 helper，
被裁决明确否掉——审批记录必须能追溯"当时这个数是怎么换算出来的"，缺了来源/锁定时间就
没法回答"批的到底是多少钱"。已实现 `src/lib/ads/money-contract.ts`：

```typescript
interface MoneyAmount {
  amountNzd: number
  amountUsd: number
  rate: number
  rateSource: string   // 人话说明，不是抽象来源枚举——v1 只有一个真实来源
  lockedAt: string      // ISO timestamp
}

export const V1_SANDBOX_NZD_TO_USD_RATE = 0.6
export const V1_SANDBOX_RATE_SOURCE = 'PM 口径 2026-08-20：...'  // 完整文案见源码

function lockV1SandboxMoney(amountNzd: number, now?: Date): MoneyAmount
```

**保留完整记录，但不做可插拔的多来源抽象**（`source: 'config' | 'wise_api'` 枚举被砍掉）——
v1 只有一个真实来源，做策略模式是在为"以后可能接汇率 API"这件事预先设计接口，属于
上游没有需求、下游没有消费方的精度，被 Build Control 第一轮裁决点名"不提前建设"。
等真的要接 API 时，`lockV1SandboxMoney` 这一个函数签名不变，内部实现换掉即可。

`policy_snapshot`（存进 `action_runs` / `authorization_decisions`）记录完整换算证据，
直接是 `MoneyAmount` 序列化后的样子（`{amountNzd, amountUsd, rate, rateSource, lockedAt}`）。

Kernel 侧：`spend_cap_per_run_usd` 用 `lockV1SandboxMoney(300).amountUsd`（终身额度换算成
美元，向上舍入到分）。

审批 UI 双币显示：`"NZ$300 (~US$180 @ 0.60)"`，避免 PM 只看到一个数字误判花了多少。

## 为什么向上/向下舍入方向不同

`convertNzdToUsd` 用在"这笔钱换算成 Kernel 看到的美元上限"——如果舍入让 Kernel 的上限
比实际纽币上限低，等于收紧了预算（安全）；如果舍反了，Kernel 会放行一笔实际超出纽币硬顶
的支出（不安全）。所以 NZD→USD 向上舍（让 Kernel 上限看起来更宽松，但真正拦截仍然发生在
`ads_spend_reservations` 那张表的纽币判断上——Kernel 那层美元数字只是估算展示，不是最终拦截点）。

**这条决策的前提是"最终拦截点在纽币预留表，不在 Kernel 的美元 cost cap"**——这点必须在
A 级复审里明确确认，否则舍入方向的安全论证不成立。

## Reuse Statement

- 新增 platform-shared：`MoneyAmount` 记录形状 + `lockV1SandboxMoney` 的函数签名
  （任何未来用别国货币结算的客户都能复用，只是内部实现换汇率来源）
- CTS-specific：`V1_SANDBOX_NZD_TO_USD_RATE` 常量值 + `V1_SANDBOX_RATE_SOURCE` 文案，
  这是临时值，v1 之后接汇率 API
- 不动：Kernel `types.ts` 的 USD 记账主干（v1 决定不升级到多币种）

## 开放问题（等 M7 前窄范围复审拍板）

- [ ] "最终拦截点在纽币预留表，Kernel 美元 cap 只是估算展示"这个前提——`ads-meta-boost-
      sandbox` capability 的 guard step 必须真的按这个前提实现（先查纽币预留表，
      Kernel 的美元 cap 只是审批 UI 展示用），M3/M5 实现时要对着这条走查一遍
- [ ] 固定汇率 0.60 是否需要 PM 从财务口径确认一个具体数字，还是随便定一个能用就行
      （v1 sandbox 用 ME 自己的钱，误差在可接受范围）
- [ ] 汇率漂移（config 值跟 Meta 真实扣款时的汇率不一致）导致的账目误差，v1 是否需要
      监控或只是接受这个已知的近似
