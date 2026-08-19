# ADR: Money Contract（NZD/USD，ME2 广告中枢 v1）

**状态：DRAFT，等 A 级设计复审（子牙 + 魏征）——未经复审，Day 2 不得实施**
**日期**：2026-08-20
**关联**：Codex 复审 BLOCKER #3（Kernel 记 USD，Meta 账户是 NZD，两边没有换算契约）

## 背景

Kernel 的 `CostModel` / `spend_cap_per_run_usd` 明确按美元记账，`authorize.ts` 判断超顶时
直接拿 USD 数字比大小，没有任何货币转换逻辑。但 v1 的硬顶（日 NZ$20 / 周 NZ$100 / 总 NZ$300）
是**纽币**，CTS 广告账户也是纽币计费。Day 1 计划草稿曾直接把 `NZ$100` 塞进
`spend_cap_per_run_usd`，这是一个数字层面的错误 —— 100 不是 100，两个字段单位不一样。

## 决策（v1 简版，不动 Kernel 核心）

**Capability 层做换算 + 汇率锁，Kernel 继续按 USD 记账**。不改 `authorize.ts` 到
`{amount, currency}` 结构 —— 那会影响所有已有的 outward 动作（比如 `seo.build_publish_package`），
v1 阶段风险太大，留到 v1 之后。

新建 `src/lib/ads/money-contract.ts`：

```typescript
type MoneyAmount = {
  amountNzd: number
  amountUsd: number
  rate: number          // NZD → USD 汇率
  lockedAt: string       // ISO timestamp，锁定这个汇率的那一刻
  source: 'config' | 'wise_api'
}

lockRate(): MoneyAmount   // v1: 从环境变量/config 读固定汇率；v2: 接 Wise/Google Currency API
convertNzdToUsd(nzd, rate): number   // 向上舍入 —— 安全方向：宁可 Kernel 记得比实际多，不能记得比实际少
convertUsdToNzd(usd, rate): number   // 向下舍入 —— 同理
```

`policy_snapshot`（存进 `action_runs` / `authorization_decisions`）记录完整换算证据：

```json
{
  "budget": {
    "daily_nzd": 20, "weekly_nzd": 100, "lifetime_nzd": 300,
    "daily_usd": 12, "weekly_usd": 60, "lifetime_usd": 180,
    "rate": 0.60, "locked_at": "2026-08-20T09:00:00Z", "source": "config"
  }
}
```

Kernel 侧：`spend_cap_per_run_usd = 60`（周上限换算成美元，向上舍入到整数）。

审批 UI 双币显示：`"NZ$100 (~US$60 @ 0.60)"`，避免 PM 只看到一个数字误判花了多少。

## 为什么向上/向下舍入方向不同

`convertNzdToUsd` 用在"这笔钱换算成 Kernel 看到的美元上限"——如果舍入让 Kernel 的上限
比实际纽币上限低，等于收紧了预算（安全）；如果舍反了，Kernel 会放行一笔实际超出纽币硬顶
的支出（不安全）。所以 NZD→USD 向上舍（让 Kernel 上限看起来更宽松，但真正拦截仍然发生在
`ads_spend_reservations` 那张表的纽币判断上——Kernel 那层美元数字只是估算展示，不是最终拦截点）。

**这条决策的前提是"最终拦截点在纽币预留表，不在 Kernel 的美元 cost cap"**——这点必须在
A 级复审里明确确认，否则舍入方向的安全论证不成立。

## Reuse Statement

- 新增 platform-shared：`money-contract.ts` 本身（任何未来用别国货币结算的客户都能复用）
- CTS-specific：v1 汇率写死在 config（`source: 'config'`），这是临时值，v1 之后接汇率 API
- 不动：Kernel `types.ts` 的 USD 记账主干（v1 决定不升级到多币种）

## 开放问题（等 A 级复审拍板）

- [ ] "最终拦截点在纽币预留表，Kernel 美元 cap 只是估算展示"这个前提是否被复审接受 ——
      如果不接受，需要重新设计 Kernel 侧的拦截逻辑，本 ADR 的舍入方向论证需要重写
- [ ] 固定汇率 0.60 是否需要 PM 从财务口径确认一个具体数字，还是随便定一个能用就行
      （v1 sandbox 用 ME 自己的钱，误差在可接受范围）
- [ ] 汇率漂移（config 值跟 Meta 真实扣款时的汇率不一致）导致的账目误差，v1 是否需要
      监控或只是接受这个已知的近似
