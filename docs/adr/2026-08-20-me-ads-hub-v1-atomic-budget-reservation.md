# ADR: 原子预算预留（ME2 广告中枢 v1）

**状态：DRAFT，等 A 级设计复审（子牙 + 魏征）——未经复审，Day 2 不得实施**
**日期**：2026-08-20
**关联**：Codex 复审 BLOCKER #2（NZ$300 不是硬顶）

## 背景

v1 硬顶：日 NZ$20 / 周 NZ$100 / 总 NZ$300。Codex 复审指出最初设计（从 `ad_daily_insights`
汇总历史花费判断是否超顶）不是真硬顶：

- `ad_daily_insights` 只有**昨天以前**的数据（pullback cron 是次日跑的）
- 同一天多次批准会**都读到同一份"昨天的"余额**，理论上能冲穿周顶
- Meta 的 `daily_budget` 本身是**均值**，单日实际花费可能比设定值高到 75%

## 决策

新建 `ads_spend_reservations` 表，做**授权前原子预留**（不是事后对账）：

```sql
CREATE TABLE ads_spend_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  scope_key TEXT NOT NULL,          -- 'me_sandbox_v1_cts' 等
  period TEXT NOT NULL,             -- 'daily' | 'weekly' | 'lifetime'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  cap_amount_nzd NUMERIC(12,2) NOT NULL,
  reserved_amount_nzd NUMERIC(12,2) NOT NULL DEFAULT 0,
  spent_amount_nzd NUMERIC(12,2) NOT NULL DEFAULT 0,
  released_amount_nzd NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NZD',
  policy_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, scope_key, period, period_start)
);
-- RLS: FOR ALL TO service_role USING (true) —— 铁律 7 模板，别漏 TO service_role
```

`reserveAmount()` 用 `SELECT ... FOR UPDATE` 锁行，串行化并发请求：

```
reserveAmount(clientId, scopeKey, amountNzd):
  BEGIN TX
    SELECT ... FOR UPDATE   -- 锁住这一行，同时来的请求排队
    检查 daily/weekly/lifetime 三层 cap 是否够
    够就 reserved += amount，返回 reservationId
    不够就 return over_cost_cap，不修改任何行
  COMMIT
```

`commitReservation(id, actualSpentNzd)` 广告真正建成后调用；
`releaseReservation(id)` 失败时调用，把预留额还回去；
`reconcileFromMeta(clientId, scopeKey)` 次日跑，用 `ad_daily_insights` 的真实花费纠偏
`spent_amount_nzd`（这层只做**对账**，不做**授权判断**——授权判断永远走 reservation 表）。

## 为什么"预留"而不是"记账"

记账（先花后查）本质是异步的，查询窗口内可以被并发请求击穿。预留（先占后花）是同步的，
`FOR UPDATE` 保证同一时刻只有一个请求在改这一行 —— 5 个并发 propose 请求会排队依次判断，
不会都读到"还有 NZ$20 额度"这个过期快照。

## Reuse Statement

- **这是全新的 platform-shared 表**，不是 v1 专属（Codex 复审 #17 指出：这才是真正的
  spend governance contract，`ad_daily_insights` 只能当对账输入，不能当权威余额账本）
- Oztop/Roman 接入时复用同一张表，只是 `scope_key` 换个值，不需要重建
- CTS-specific 的只有 policy_snapshot 里的具体数值（NZ$20/100/300），不是表结构本身

## 开放问题（等 A 级复审拍板）

- [ ] `period_end='infinity'` 表示 lifetime cap 是否是 Supabase 支持的写法，要不要改成
      `9999-12-31` 之类的哨兵值
- [ ] `reconcileFromMeta` 发现"实际花费 > 预留额"（Meta 日预算均值特性导致）时，
      是自动补预留还是直接触发止损（pause campaign）——这个决策影响 v1 的止损脚本
- [ ] `ads_spend_reservations` 的 `FOR UPDATE` 锁在 Supabase 连接池 + serverless 环境下
      持锁时间过长会不会拖垮别的请求，需要设置合理超时
