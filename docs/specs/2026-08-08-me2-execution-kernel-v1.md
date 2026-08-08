# Magic Engine 2.0 · Execution Kernel v1

> Issue [#859](https://github.com/bigbigraydeng-maker/magic-engine/issues/859) · ADR-001 / ADR-002 / ADR-004
> 状态：**已实现，未启用**。建表迁移写好了但**没跑**；没有任何 cron 调用它；
> 没有任何现有代码路径经过它。合并 + apply migration + 启用各需要 PM 单独 `go`。
> migration 版本号是 `20260808000003` —— 原本用 000001，跟并行的 PR #862 撞了。
> 第三轮（Codex review）：视图权限收口 · 授权绑定政策行身份 + 模式复核 ·
> 可恢复 deny 的显式重授权 · Goal 跨客户双层防护 · 政策时间窗（见 §5.x / §6.x / §13）。

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
         pending_approval → (人点同意) → authorized | denied
         dead_letter → (人点重跑) → queued → …             ← 断点续跑
生命周期旁支：superseded
```

**重跑走的是跟第一次完全相同的授权路径**（回到 `queued` 重新授权），
不是「人点了所以直接放行」—— 死信之后世界可能已经变了（客户改了规则、契约升版）。
已经成功的步骤连同产物原样保留，只把没跑成的放回待跑；谁发起的重跑记进 `evidence`。

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

### 🔴 人工批准盖不过当前政策（P1-1）

`approveRun` 跟自动放行**走同一套闸**（`preflight`）。人点同意能做的只有一件事：
把「当前仍是 `require_approval`、而且跟当初挂起时同一版」的政策，从「等你点头」变成「可以做」。

它**不能**覆盖：没有政策 / 政策改成禁止 / 政策换了版本 / 契约升版 / 输入已不合法 /
purpose 不符 / 对外副作用 / 超预算。任何一项变了一律 fail closed，
并落一条说清「变了什么」的拒绝记录。

最阴的那条路是政策**被删掉**：早先会签出 `policy_version = null` 的放行，
Gateway 重读也拿到 null，`null === null` 直接过。现在「没有生效政策」在
授权层和数据库 RPC 里都是硬拒。

### 🔴 授权绑定的是「那一行政策」，不只是版本号（C2）

决策表记 `policy_id`（签发依据的具体那一行）。版本号只在同一行政策内有意义：
「auto v1 → 删掉 → 重建 deny v1」时两条政策版本号完全一样，只有行身份分得开。

执行前（Gateway 与 `kernel_begin_authorized_run` 两层各查一遍）**政策三连**：

1. 当前必须存在生效政策（被删 = 拒，不是「两边都是 null 所以对得上」）；
2. `当前政策.id === decision.policy_id`（行身份）；
3. `policy_version` 一致；
4. **模式复核**：`decided_by='policy'` 的放行要求当前仍是 `auto_approve`；
   `decided_by='human'` 的放行要求当前仍是 `require_approval` ——
   这一条兼任版本触发器失灵时的最后防线。

### 🔴 可恢复的 deny 能显式重新授权（C3）

「客户没配规则 → 被拒 → 人配好了规则 → 同样输入永远命中旧 denied」是死路。
`recoverDeniedRun(runId, 谁, 为什么)`：

- **普通重复提交不会偷偷恢复** —— 恢复必须是显式动作；
- 白名单（只这四个）：`no_policy` / `policy_expired` / `policy_changed_since_request` / `over_cost_cap`；
- 不可恢复：`invalid_input` / `unknown_action` / `unknown_action_version` /
  `outward_side_effect_blocked` / `purpose_not_allowed` / **人明确点过「不做」的**（系统不替人改主意）；
- 旧 deny 决策原样保留（append-only），run id / 幂等键不变，恢复人 / 原因 / 时间记进 `evidence`，
  然后回到 `queued` 走**跟第一次完全相同**的授权路径。

### 🔴 Goal 必须属于同一个客户（C4）

双层：提交层查 `goals.client_id === run.client_id`（说人话的安全告警）；
数据库层复合外键 `FOREIGN KEY (client_id, goal_id) REFERENCES goals (client_id, id)`
（前置 `CREATE UNIQUE INDEX idx_goals_client_id_id` —— `goals.id` 本身是主键，
这个索引不可能因历史数据冲突而失败）。MATCH SIMPLE 语义下非 growth 任务（goal_id NULL）不受影响。

### 🔴 政策生效判据是时间窗（C5）

`effective_from <= now AND (effective_to IS NULL OR effective_to > now)` ——
带结束时间但没到期的政策一样生效。应用层 `store.isPolicyActive` 与 RPC 的 SQL 完全一致，
有架构测试盯着两边不许分家。到期的政策拒绝时说「过期了，去续一条」，
从没配过的说「去新配一条」—— 两句话引导人做的事不一样。

### 🔴 lineage 视图按调用者权限读底表（C1）

`kernel_action_lineage` 带 `WITH (security_invoker = true)` + 显式
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT SELECT ... TO service_role`。
没有 security_invoker 的话，视图以 owner 权限读底表 —— anon 经 Data API 查视图
就能把跨客户的目标 / 授权理由 / 操作人 / 步骤产物一锅端走。**不赌底表 RLS 恰好都配对。**

### 🔴 政策版本由数据库强制演进（P1-3）

Gateway 的 stale-policy 防护完全建立在「政策一变，`policy_version` 就变」上。
这条不变量**不能靠调用方自觉** —— 将来任何一个忘了 bump 的写入方，都会让
「客户刚把自动改成禁止」对已签发的授权完全没有效果。

所以 `client_automation_policies` 带一个 `BEFORE UPDATE` 触发器：
授权相关字段（`mode` / 两个花钱上限 / `spend_cap_period` / `decision_ttl_seconds` /
生效窗口）任何一项变化 → `policy_version = OLD + 1`，**无视调用方传进来的值**；
没变则版本原样保持（防止有人靠改号码批量作废或复活授权）。
`client_id` / `action_key` 是身份字段，**不许原地改** —— 要换就新建一条。

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

所以就算伪造一个字段齐全的 ctx，也过不了第二步。
而且这一层**在去领执行权之前**就拒了 —— 有测试直接断言此时
`kernel_begin_authorized_run` 一次都没被调用（不然「两道闸各自都在」这句话就没有证据）。

### 🔴 原子领取执行权（P1-2）

上面那套重读比对是为了**说清楚为什么不让跑**（给人看的理由）。
真正的并发正确性在 `kernel_begin_authorized_run` 这一个 RPC 里：

```
锁 run（FOR UPDATE）→ 锁 decision → run 必须停在 authorized
→ run.authorization_decision_id 必须正好是这条 decision（双向绑定）
→ 客户 / action_key / version / 幂等键 / verdict / 未消费 / 未过期 逐项校验
→ 当前政策必须存在且版本仍匹配
→ 一次性：consume decision + run → running + started_at
```

**不能拆成「先兑换 decision、再把 run 改成 running」**：那两句之间有窗口，
而且兑换的是决策、不是执行权 —— 同一个 run 若存在两份 allow 决策，
「各自原子地兑换各自那条」照样能让两个 capability 同时开跑。

提交侧同理：`SELECT → INSERT` 不是原子幂等。真正的闸是
`UNIQUE(client_id, idempotency_key)` + **撞了就回读赢家**
（把正常竞争当 500 抛出去也是错的）。已存在且还在推进中的 run
一律返回 `in_progress`，**绝不再签第二份授权**。

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

`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql`

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
| 4 | **`spend_cap_per_period_usd`：RESERVED · NOT ENFORCED · 设置页先别暴露** | 只有列，没有任何判定逻辑。单次上限（`spend_cap_per_run_usd`）已生效。在 enforcement 落地之前，任何 UI 把它显示成「已生效的安全上限」= 给人一个假的安全感 |
| 5 | `kernel_claim_run_step` 建好了但当前执行路径是进程内直跑，还没走认领 | 多 worker 并发时才需要。RPC 先建好，免得将来又要一轮 migration |
| 6 | L3（受限 Postgres 角色）未评估 | ADR-002 已裁定不阻塞 v1，单独出 Security ADR |
| 7 | **`approvedByUser` 现在只是一个字符串参数** | 真正接 API / UI 时**必须**从认证过的会话 / 操作者身份取，绝不能信任请求体。现在没有调用方，所以还没有可被伪造的入口 |
| 8 | **`effective_to` 的完整时间窗语义还没做** | `getActivePolicy` 目前只取 `effective_to IS NULL` 的行，然后在授权层判过期。有限期政策的完整 UX 留给 Settings UI PR |
| 9 | 卡在 `queued` 的孤儿 run 没有回收 | 首次提交后进程崩在授权之前，这条 run 会一直停在 `queued`，而后续提交只会拿到 `in_progress`。需要一个 `purpose='recovery'` 的清扫任务 —— 留给启用 PR（现在没有调用方，构不成实际问题） |
| 10 | **仓库里已有 23 组重复的 migration 版本号** | 查重时发现的旧账（`origin/main` 上就有，多的一组 3 个文件）。本 PR 不改存量（改已 apply 过的文件名会打乱生产账本），只加了 CI 查重保证**不再新增**，存量冻结在 `boundaries.ts` 的清单里 |
