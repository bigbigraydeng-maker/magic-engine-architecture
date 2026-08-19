# ADR: 原子预算预留（ME2 广告中枢 v1）

**状态：设计已实现（代码 + 测试），未 apply migration，等 M7 前的窄范围复审**
**日期**：2026-08-20（v1 首版）/ 2026-08-20 修订（Build Control 木桶原则第二轮裁决）
**关联**：Codex 复审 BLOCKER #2（NZ$300 不是硬顶）

## 背景

v1 硬顶：总 NZ$300（Build Control 木桶原则裁决：v1 锁定单一已发布 Reel、单一投放路径，
不是长期循环投放系统，日/周分档意义不大，改为单一终身额度）。Codex 复审指出最初设计
（从 `ad_daily_insights` 汇总历史花费判断是否超顶）不是真硬顶：

- `ad_daily_insights` 只有**昨天以前**的数据（pullback cron 是次日跑的）
- 同一天多次批准会**都读到同一份"昨天的"余额**，理论上能冲穿顶
- Meta 的 `daily_budget` 本身是**均值**，单日实际花费可能比设定值高到 75%

## 决策（Build Control 第二轮裁决修订版）

新建 `ads_spend_reservations` 表：**单条（client_id, scope_key）终身额度记录**，
不做 daily/weekly 分周期表；**四态桶**表达全部状态（不是最初设计的
authorised/reserved/spent/released 四字段）：

```sql
CREATE TABLE ads_spend_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,          -- 'me_sandbox_v1_cts' 等
  currency TEXT NOT NULL DEFAULT 'NZD',
  cap_amount_nzd NUMERIC NOT NULL,
  reserved_amount_nzd NUMERIC NOT NULL DEFAULT 0,
  committed_amount_nzd NUMERIC NOT NULL DEFAULT 0,
  released_amount_nzd NUMERIC NOT NULL DEFAULT 0,
  failed_needs_reconcile_amount_nzd NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, scope_key)
);
-- RLS: FOR ALL TO service_role USING (true) —— 铁律 7 模板，别漏 TO service_role
```

**四态语义**：
- `reserved` —— 已占用但还没真正写到 Meta 的额度
- `committed` —— Meta 写入确认成功（建成 + 回读校验过）的额度
- `released` —— 失败但确定没有产生任何外部副作用，退回去的额度
- `failed_needs_reconcile` —— Meta 写入结果不确定（超时/网络错误/回读对不上），**仍然
  算在硬顶里**，直到人工核实清楚移去 committed 或 released。这是 Build Control 第二轮
  裁决明确要求的第四态——"不确定"比"确定没花"危险，宁可拦下一笔也不能让不确定的钱溜过硬顶

**硬顶判定公式**：`reserved + committed + failed_needs_reconcile <= cap`（`released` 不算）

## 为什么是"单条语句原子读改写"，不是"SELECT FOR UPDATE + 应用层判断再 UPDATE"

最初设计想用 `SELECT ... FOR UPDATE` 锁行 + 应用层判断 + 再 UPDATE，这是两次往返，中间
有窗口。实际实现（见 `supabase/migrations/20260820000001_me2_ads_spend_reservations_v1.sql`）
把"检查 + 更新"写进**同一条** UPDATE 语句的 WHERE 子句：

```sql
UPDATE ads_spend_reservations
   SET reserved_amount_nzd = reserved_amount_nzd + p_amount_nzd
 WHERE client_id = p_client_id AND scope_key = p_scope_key
   AND (reserved_amount_nzd + committed_amount_nzd + failed_needs_reconcile_amount_nzd + p_amount_nzd)
       <= cap_amount_nzd
 RETURNING *;
```

Postgres 对单条语句里同一行的读-判-写是原子的，不需要显式加锁，也没有"判完到写之间"的窗口。

## 真实并发竞争测试（Build Control 第二轮裁决明确要求保留）

`src/lib/ads/__tests__/spend-reservations.concurrency.test.ts` 用两组对照证明这不是摆设：

1. **原子版**（读-判-写在同一个不含 `await` 的同步临界区内，忠实模拟单语句 UPDATE 的
   保证）：20 次并发 `reserve($20)`、cap=$300 → 恰好 15 次成功，reserved 总额恰好 $300
2. **对照组 · 非原子版**（读和写之间故意插一个 `await`，模拟"先 SELECT 再另开一条
   UPDATE"的错误实现）：同样 20 次并发调用 → **20 次全部成功，reserved 总额冲到 $400**，
   硬顶被真实绕过——证明这个测试真能分辨"原子"和"不原子"，不是一个自动通过的摆设

## Money Contract 联动（Build Control 第二轮裁决要求保留完整字段）

`src/lib/ads/money-contract.ts` 的 `lockV1SandboxMoney()` 记录 `{amountNzd, amountUsd,
rate, rateSource, lockedAt}` 五项，写进 Kernel 审批记录的 `policy_snapshot`。`rateSource`
是人话说明（PM 口径 + 为什么允许误差），不是抽象的来源枚举——因为 v1 只有一个真实来源。

## Reuse Statement

- `ads_spend_reservations` 表结构 + 四个 RPC 函数是 platform-shared：Oztop/Roman 接入时
  复用同一张表，只是 `scope_key` 换个值
- `money-contract.ts` 的 `MoneyAmount` 记录形状是 platform-shared；`V1_SANDBOX_NZD_TO_USD_RATE`
  常量和 `rateSource` 文案是 CTS sandbox v1 专属，v1 之后接汇率 API 时只换实现不换接口
- 不建：daily/weekly 周期表（v1 单一投放路径不需要）、汇率来源策略模式（上游没有多来源需求）

## 关闭的开放问题（原 DRAFT 版本遗留，已在本次修订解决）

- ~~`period_end='infinity'` 写法~~ —— 已改掉分周期设计，不再需要
- ~~`reconcileFromMeta` 发现实际花费超预留额时的处理~~ —— `failed_needs_reconcile` 状态
  桶就是这个问题的答案：不确定就停下来算在硬顶里，不自动补预留也不自动止损，等人工核实
- ~~`FOR UPDATE` 持锁时间~~ —— 已改成单语句原子 UPDATE，不再需要显式锁

## 仍然开放的问题

- [ ] `ads_reserve_spend_v1` 首次调用建行时传入的 `cap_amount_nzd` 之后被忽略（后续调用
      不能改 cap）——这是刻意设计（改 cap 应该是独立的管理动作），但目前没有独立的
      "改 cap"入口，如果 v1 期间真的需要调整硬顶，得手工 UPDATE 或另写一个函数
- [ ] `failed_needs_reconcile` 状态目前没有配套的人工处理流程/UI——M7 如果真的撞上这个
      状态，需要一个明确的"怎么核实、核实完调哪个函数"的手册，不能停在"状态存在但没人管"
