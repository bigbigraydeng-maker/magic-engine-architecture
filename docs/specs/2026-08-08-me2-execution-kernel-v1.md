# Magic Engine 2.0 · Execution Kernel v1

> Issue [#859](https://github.com/bigbigraydeng-maker/magic-engine/issues/859) · ADR-001 / ADR-002 / ADR-004
> 状态：**已实现，未启用**。建表迁移写好了但**没跑**；没有任何 cron 调用它；
> 没有任何现有代码路径经过它。合并 + apply migration + 启用各需要 PM 单独 `go`。

---

## 1. 这个 PR 做了什么（一句话）

把 `content_work_orders` 里**已经跑对过**的执行模式抽出来，变成一个域无关的执行内核：
**没有授权就执行不了任何东西**，而且第一条真实动作（做发布包）从头到尾真跑通了一遍。

## 2. 不做什么

- ❌ 不发布客户网站 / 不提交谷歌收录 / 不发社媒 / 不改广告 —— v1 **零对外副作用**，
  且这一条是**代码级硬闸**（`sideEffect: 'outward'` 的动作在授权层和 Gateway 各被拒一次）
- ❌ 不迁移 `content_work_orders`，不重载 `execution_items`（它继续是人看的意图卡）
- ❌ 不接 cron、不改 `render.yaml`
- ❌ 不动那 500 多个 `supabaseAdmin` 调用点

---

## 3. `content_work_orders → Kernel` 提取矩阵（落地版）

ADR-001 要求的 field-by-field 矩阵，这里只列**实现结果**（完整论证见 Issue #859 的 DESIGN-SUPPLEMENT-1 §2）。

| 源 | 判定 | 落到哪 |
|---|---|---|
| `id` / `client_id` / 时间戳 | KEEP | `action_runs` 同名 |
| `goal_id NOT NULL` | **ADAPT** | `purpose` + 可空 `goal_id` + 双向 CHECK |
| `signal_id`（只能指一张表） | ADAPT | `triggered_by` + `triggered_by_ref` |
| `brief jsonb`（无校验） | ADAPT | `input` + `ActionDefinition.inputSchema` 校验 |
| `angle` / `angle_source` / `rationale_one_liner` | ADAPT（保形状换词汇） | `rationale` + `evidence` |
| `budget_cap_usd DEFAULT 2.00` | ADAPT（去掉默认值） | `cost_cap_usd`，授权时从政策快照下来 |
| `actual_cost_usd` | ADAPT（下移） | `action_run_steps.cost_actual_usd` |
| 16 态 `status` | **SPLIT** | 通用状态留 `action_runs.status`（10 态）；域阶段进 `step_key` |
| `claimed_by/at` · `heartbeat_at` · `attempt_count` · `reclaim_count` | KEEP（下移到 step） | `action_run_steps.*` |
| `max_attempts` 存在行上 | ADAPT（移出行） | `ActionDefinition.retryPolicy.maxAttempts` |
| `factory_claim_work_order` RPC | **原样提取** | `kernel_claim_run_step()`（同样 `SECURITY DEFINER` + `FOR UPDATE SKIP LOCKED` + 客户白名单 + REVOKE 收口） |
| `review_ref jsonb` | ADAPT | `authorization_decision_id` FK → append-only 决策表 |
| `master_brief_id NOT NULL` · `winner_structure_id` · `order_type` · `published_ad_id` · `reject_category` 枚举 · `publish_attempt_count` | **REJECT** | 内容域语义，不进通用内核 |

### 为什么 `goal_id` 必须可空

仓库已经因为「强制挂 Goal」造过一个假 Goal：`strategy/goals.ts` 里有个
`[Migration] Unassigned Backlog` 占位目标，每个查询还得把它过滤掉。
所以 `action_runs` 用的是**双向** CHECK：

```sql
CONSTRAINT goal_matches_purpose CHECK ((purpose = 'growth') = (goal_id IS NOT NULL))
```

- `growth` 没挂目标 → 拒绝（防「增长动作不挂目标」）
- `maintenance` / `compliance` / `recovery` / `housekeeping` 挂了目标 → **也拒绝**（防伪造 Goal）

这条约束在数据库层就让「给维护任务编个目标」不可能，不靠人自觉。

---

## 4. 状态机

```
queued → authorizing → { authorized | pending_approval | denied }
         authorized  → running → { succeeded | dead_letter }
         pending_approval → (人点) → authorized | denied
         dead_letter → (人点重跑) → pending_approval → …   ← 断点续跑
生命周期旁支：superseded
```

**阶段不在这里。** 阶段是 `action_run_steps.step_key`（`build` / `persist` / `verify` / 将来的
`publish` / `measure`）。接新域不用往这个枚举里加值。

---

## 5. 三层契约

| 层 | 住哪 | 谁能改 |
|---|---|---|
| `ActionDefinition` | **代码**（`src/lib/kernel/registry.ts`） | 走 PR。agent 运行时改不了 |
| `client_automation_policies` | **数据库** | PM / FDE |
| `authorization_decisions` | **数据库，append-only** | 谁都不能改（触发器强制） |

### 默认 deny 的实现方式

**「查不到政策行」= 拒绝**，不是给 `mode` 一个默认值。
默认值会让「忘了配」和「明确配成自动」在库里长得一模一样。

### 未知动作

AI 可以**提出**任何动作，但注册表认不出的一律 deny，**并落一条 `deny_code='unknown_action'` 的决策记录**。
不是静默跳过 —— 否则「AI 提了个我们没实现的动作」这件事没人看得见。

---

## 6. 写操作绕不过授权层（L1 + L2）

ADR-002 裁定 v1 只做 L1 + L2，L3（DB 角色隔离）单独做安全评估。

### L1 —— 静态边界

只管 **provider write module**（10 个模块，34 个 importer），**完全不碰 `supabaseAdmin`**（500+ importer）。
「怎么避免一次打爆 500 多个 import」的答案是：不去动那 500 多个。真正会伤到客户的是对外写。

- `.eslintrc.json` 的 `no-restricted-imports`（可以被 `// eslint-disable` 关掉）
- `src/lib/kernel/__tests__/architecture.test.ts` 的文件系统扫描（**关不掉**，跑在 `npm test` 里）
- 两处清单的唯一真相源是 `src/lib/kernel/boundaries.ts`，有一条测试专门盯着 ESLint 配置跟它对不对得上

历史 importer 用**精确路径**豁免（26 条），不是通配目录 —— 这样新文件默认撞规则，清单只会变短。
`execution_items` 的 15 个直接写入方同理。

### L2 —— 运行时门面

`AuthorizedExecutionContext` 用一个**只声明不导出**的 `unique symbol` 打标，模块外写不出满足该类型的对象。
唯一的绕过是 `as unknown as …`，那是一行显式代码，架构测试会扫出来。

但真正兜底的不是类型：**Gateway 把 ctx 只当索引**，执行前把每一条授权事实从
append-only 的决策表里重读一遍再逐项比对：

| 检查 | 失败行为 |
|---|---|
| 跨客户（ctx / run / decision 三方不一致） | 抛错 + 安全告警，**排在所有检查最前面** |
| verdict 不是 allow | 抛错 |
| action_key / action_version 对不上 | 抛错 |
| 幂等键对不上 | 抛错 |
| 已被兑换（重放） | 抛错 |
| 授权过期 | 抛错 |
| 政策版本变过（stale） | 抛错 |
| run 状态不对 | 抛错 |
| 原子兑换（`WHERE consumed_at IS NULL`）拿不到行 | 抛错 |

所以就算伪造一个字段齐全的 ctx，也过不了第二步。

---

## 7. Safe capability：`seo.build_publish_package`

**真跑，不是 no-op。** 三步：

| step | 做什么 | 失败即 |
|---|---|---|
| `build` | 读真稿子 → 算内容指纹 → 跟提交时的指纹比对 → 取品牌底稿 → 组装 | 读炸了可重试；稿子被改过 / 不存在 → 不重试 |
| `persist` | 写 `production_packages`（**永远 `draft`**，带 kernel 标记） | 写炸了可重试 |
| `verify` | 回读 + 指纹比对 + 必填断言 + **外键可解析断言** | **不重试**，直接死信 + 下发人工任务 |

### 为什么它没有对外副作用

- 只写 `production_packages`，且**永远是 `draft`**。
  `flywheel/package-publish.ts` 的发布钩子只在 `status='published'` 上触发。
- 后台首页的「待审」计数只数 `ready_for_review`（已核对 `src/app/dashboard/page.tsx`），
  所以 Kernel 造的行**不会**混进 PM 的待审数字。
- 测试里把 `globalThis.fetch` 打了桩，跑完断言它一次都没被调用。

### 污染缓解 / 一键清理

每一行都带 `source_payload.produced_by = 'execution_kernel'` + `kernel_run_id`：

```sql
DELETE FROM production_packages
WHERE source_payload->>'produced_by' = 'execution_kernel'
  AND status = 'draft';
```

⚠️ 已知且刻意保留的可见性：客户production 列表接口
（`/api/clients/[id]/production`）不按 status 过滤，所以 FDE 在那一页**会**看到这些草稿包。
这是对的 —— 系统做了什么，FDE 该看得见。

---

## 8. Lineage

```
goals.id
  → action_runs.goal_id
  → action_runs.authorization_decision_id → authorization_decisions
  → action_run_steps.run_id → steps → steps.verification
  → flywheel_actions.action_run_id  (本迁移新增的一列，可空，对归因作业零行为变化)
  → flywheel_outcomes.action_id
```

两个等价实现：
- SQL：`kernel_action_lineage` 视图（一条 SQL 走通，给运维和 PM）
- TS：`loadActionLineage(sb, runId)`（给应用），带一句人话摘要

---

## 9. 管道不许断头

死信 / 等审批 / 被规则挡下 → `action_runs.needs_human = true` →
`kernel/handoff.ts` 捞出来 → 接进**今日待办**（`pm-todo/manual-items.ts` 的
`kernel_needs_human`），三件套齐全（what 带影响 / how 具体到点哪里 / href 直达）。

没有这一环，一次死信就只是 `action_runs` 里一行状态 —— 没有人会去翻。

---

## 10. 运维手册

### Apply migration（需要 PM `go`）

`supabase/migrations/20260808000001_me2_execution_kernel_v1.sql`

**Preflight**（应该都是 0 / 不存在）：

```sql
SELECT to_regclass('public.action_runs'),
       to_regclass('public.action_run_steps'),
       to_regclass('public.authorization_decisions'),
       to_regclass('public.client_automation_policies');
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'flywheel_actions' AND column_name = 'action_run_id';
```

**Apply 之后自验**：

```sql
-- 1. 四张新表 RLS 都必须写了 TO service_role（漏掉 = 对匿名访客敞开）
SELECT tablename, policyname, roles FROM pg_policies
 WHERE tablename IN ('action_runs','action_run_steps',
                     'authorization_decisions','client_automation_policies');
-- 期望：roles = {service_role}

-- 2. 认领 RPC 的执行权限必须收口
SELECT proname, proacl FROM pg_proc WHERE proname = 'kernel_claim_run_step';
-- 期望：不含 anon / authenticated

-- 3. append-only 触发器在
SELECT tgname FROM pg_trigger WHERE tgrelid = 'authorization_decisions'::regclass;

-- 4. 双向目标约束真的挡得住（两条都必须报错）
INSERT INTO action_runs (client_id, purpose, triggered_by, action_key, action_version, idempotency_key)
VALUES ('<某个真客户>', 'growth', 'human', 'seo.build_publish_package', 1, 'probe-1');   -- 期望：违反 CHECK
INSERT INTO action_runs (client_id, purpose, goal_id, triggered_by, action_key, action_version, idempotency_key)
VALUES ('<某个真客户>', 'maintenance', '<某个真目标>', 'human', 'x', 1, 'probe-2');       -- 期望：违反 CHECK
```

### 回滚

新表无数据、无调用方，可直接 drop：

```sql
DROP VIEW IF EXISTS public.kernel_action_lineage;
DROP FUNCTION IF EXISTS public.kernel_claim_run_step(text, uuid[]);
DROP TABLE IF EXISTS public.action_run_steps;
DROP TABLE IF EXISTS public.authorization_decisions CASCADE;
DROP TABLE IF EXISTS public.action_runs CASCADE;
DROP TABLE IF EXISTS public.client_automation_policies;
ALTER TABLE public.flywheel_actions DROP COLUMN IF EXISTS action_run_id;
```

代码侧 revert commit 即可 —— 没有任何现有路径依赖它。

### 启用（**本 PR 不做**，需要单独授权）

1. 给**一个**客户插一条政策（灰度）：
   ```sql
   INSERT INTO client_automation_policies
     (client_id, action_key, mode, spend_cap_per_run_usd, updated_by)
   VALUES ('<client>', 'seo.build_publish_package', 'require_approval', 0, '<你的邮箱>');
   ```
   —— 首轮建议 `require_approval` 而不是 `auto_approve`：先看它排出来的东西对不对。
2. 接一个调用方（cron 或后台按钮），**同一个 PR 内**加 `render.yaml` + `cron/registry.ts` 条目。
3. 观察两轮，确认 `action_runs` / `authorization_decisions` 的行长得对，再考虑放开 `auto_approve`。

---

## 11. 已知缺口（留给下一个 PR）

| # | 缺口 | 影响 |
|---|---|---|
| 1 | 注册表还没反向注入 agent prompt | `zhuge/conductor.ts` 仍要求模型「action_type 是一个 snake_case 短词」，生成端还是开放词汇表。不补的话，注册表会从「36 种自由文本」变成「36 种自由文本 + 一张对不上的表」 |
| 2 | 没有政策的 Settings UI | 现在只能写 SQL 插政策行。按 CLAUDE.md「FDE/PM 要填的字段必须连 Settings UI 一起做完」，启用前必须补 |
| 3 | 没有调用方 | 内核建好了但没人提交动作。这是刻意的（v1 = 零运行时接线） |
| 4 | 期间花费上限（`spend_cap_per_period_usd`）只建了列，没实现判定 | 单次上限已生效；周期累计上限还没接 |
| 5 | `kernel_claim_run_step` 建好了但当前执行路径是进程内直跑，还没走认领 | 多 worker 并发时才需要。RPC 先建好，免得将来又要一轮 migration |
| 6 | L3（受限 Postgres 角色）未评估 | ADR-002 已裁定不阻塞 v1，单独出 Security ADR |
