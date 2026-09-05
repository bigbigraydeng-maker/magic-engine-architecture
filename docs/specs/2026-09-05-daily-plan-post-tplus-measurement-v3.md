# Facebook 帖子 T+4 / T+72 效果回流 — 设计 v3

**状态**：设计文档。**不含代码、不改库、不动 #1393、不开 PR、不合并。** 等审过再进实现。
**替代**：v2（`feat/meta-auth-health-check` 分支上的 `2026-09-04-...-measurement.md`，已作废，见 §9.7）。

---

## 0. v3 改了什么（对 Codex 四项 + 归因证明）

| # | v2 的错 | v3 |
|---|---|---|
| 1 | 读 `event.data.published[0]` | 读真实**扁平**事件（§1），一事件一帖 |
| 2 | 用 `published_at + 4/72h` 重算测量时间 | **只用事件里的 `measure_at[]`**，永不重算；它已按 #1380 锚在 `scheduled_publish_time ?? published_at` |
| 3 | 无法测量写 `metric_value = NULL` | `flywheel_metrics.metric_value` 是 `NOT NULL`（skeleton.sql:52）。**无法测量不写指标行**，写进动作行的回执 `payload.measurements[]`（§3） |
| 4 | #1393 加 268 行生产路由做一次性探针 | 路由方案撤销。改为 `scripts/` 下一次性脚本（§6），只输出脱敏 JSON；#1393 里的分类逻辑与 23 项测试迁到 lib（实现阶段做） |
| + | 未证明归因能否按单帖归因 | **证明了不能**（§4）：`latestMetricValue` 只按 `client_id + metric_key + 时间窗` 找，会串帖。设计用 `expected_metric = NULL` 让通用归因**完全不碰**这些动作 |

另外两处 v2 分类错误一并修：`#100` 不再一律当"帖子被删"（仓库 `comments.ts:83` 早有正确判据：subcode 33 才是）；未知错误码按仓库既有哲学归 transient 而非 permanent（`comments.ts:91-93`），由 Inngest 重试上限兜底。

---

## 1. 最终事件结构（真实、扁平、一事件一帖）

来源：`origin/main` 的发布路由 `src/app/api/clients/[id]/campaign-daily-plan/publish/route.ts:338-351`，每成功发一条帖子 `sendInngestEvent` 一次，`id = idempotency_key`。

```jsonc
{
  "name": "daily_plan.post.published",
  "id": "<idempotency_key>",              // Inngest 事件级去重键
  "data": {
    "client_id":        "c0000000-0000-0000-0000-000000000000",
    "campaign_id":      "6612eabf-…",
    "plan_id":          "f166a5c0-…",
    "plan_revision":    "2026-09-01T15:00:04.513Z",
    "review_revision":  "40b720ac-…",
    "date":             "2026-09-03",
    "idempotency_key":  "campaign_daily::…",   // 耐久动作身份
    "post_id":          "1616575215312482_1750182150247306",
    "page_id":          "1616575215312482",
    "published_at":     "2026-09-03T06:00:00.000Z",     // 提交给 Meta 的时刻
    "permalink":        "https://www.facebook.com/…",
    "scheduled_publish_time": "2026-09-03T20:00:00.000Z",  // 仅排期帖有；#1380 起
    "measure_at": [                                     // #1380 起锚在 scheduled ?? published
      { "hours": 4,  "at": "2026-09-04T00:00:00.000Z" },
      { "hours": 72, "at": "2026-09-06T20:00:00.000Z" }
    ]
  }
}
```

`hours` 来自 `PUBLISH_MEASUREMENT_OFFSETS_HOURS = [4, 72]`（main `daily-plan-publish.ts:35`）。**消费者从事件读 `hours`/`at`，不 import 那个常量**——常量以后改了，在途事件仍按发出时的约定测。

**校验 schema（消费者入口，fail-closed）**：`z.object` 精确对齐上面 15 个字段；`measure_at` 是 `z.array({hours: number, at: datetime}).min(1)`；任一缺失/不合法 → 回执 `rejected:payload_invalid`，不睡、不读、不写。

---

## 2. 消费者设计

文件（实现阶段）：`src/lib/inngest/functions/daily-plan-post-tplus.ts`。

### 2.1 配置

```ts
inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}daily-plan-post-tplus`,
    name: 'Daily Plan Post: T+N engagement snapshot',
    idempotency: 'event.data.idempotency_key',          // 24h 内同键事件只跑一次
    concurrency: { limit: 4, key: 'event.data.page_id' }, // 按主页限并发
    retries: 3,                                          // 只有 transient 才会走到
    onFailure: writeRetriesExhaustedReceipt,             // 3 次都失败 → 回执，不静默
  },
  { event: 'daily_plan.post.published' },
  handler,
)
```

`daily_plan.post.published` **不在** `WORKER_OWNED_EVENTS`（`client.ts:32-38`），云端可独占消费。

### 2.2 步骤

```
1. parse(event.data)                       失败 → receipt rejected:payload_invalid，return
2. step.run('isolation-check')             §2.3；失败 → receipt rejected:page_mismatch，return
3. step.run('ensure-action')               §2.4；幂等写 flywheel_actions 一行，得 action_id
4. for each m of measure_at (按 hours 升序):
     step.sleepUntil(`wait-${m.hours}h`, m.at)          // 过去的时刻立即返回（迟测仍测）
     step.run(`measure-${m.hours}h`, () => measureOnce(m))   §2.5
5. return { ok: true, idempotency_key, measured: [...] }   // Inngest 持久化为运行输出
```

`step.sleepUntil` 是持久睡眠：部署、重启、重放都不丢。`step.run` 成功结果被记忆，重试只从失败步继续。

### 2.3 隔离校验（fail-closed）

三条都过才继续，任一不过 → `receipt rejected:page_mismatch`，**不调 Graph、不写任何表**：

1. `clients.facebook_page_id`（按 `client_id` 查）`=== event.data.page_id`
2. `event.data.post_id.startsWith(event.data.page_id + '_')`
3. `getStoredPageToken(client_id, page_id)` 非空（只认存下来的主页授权；**不走**环境变量与全局兜底——理由同 Meta 授权体检 `auth-health.ts` 文件头规矩 2）

### 2.4 动作行（`flywheel_actions`）

```ts
{
  client_id, flywheel: 'social', action_type: 'social.publish_post',   // 复用词条 vocabulary.ts:317
  execution_mode: 'in_house', vendor: 'meta_graph',                    // ≠ logSocialPublishedAction 写死的 third_party/publer
  expected_metric: null,   // 🔴 故意 NULL —— 见 §4；通用归因据此完全跳过本动作
  expected_delta: null,
  executed_at: scheduled_publish_time ?? published_at,                 // 公开时刻，不是提交时刻
  payload: {
    source: 'daily_plan', idempotency_key, post_id, page_id,
    published_at, scheduled_publish_time?, permalink,
    campaign_id, plan_id, plan_revision, review_revision, date,
    measure_at,                 // 原样保存发出时的约定
    measurements: []            // 回执数组，§3
  }
}
```

幂等：先 `select id where client_id=? and action_type='social.publish_post' and payload->>'idempotency_key'=?`，有则复用；无则 insert，`23505` 视为并发已写、重查。`logSocialPublishedAction` 因写死 `vendor:'publer'`/`source:'ai_factory'`/`expected_metric:'social.posts.published_count'`（social-post-publish.ts:286-296）**不能直接复用**，实现阶段写一个带参变体或同形状 insert。

### 2.5 单次测量 `measureOnce(m)`

```
token = getStoredPageToken(client_id, page_id)
  ├─ null → receipt {hours, status:'unmeasurable', reason:'token_unavailable'}; return   // 72h 里被撤是常态；交授权体检
GET /v20.0/{post_id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=…
  ├─ fetch 抛异常 / 5xx / 非 JSON → throw（transient；Inngest 重试；第 3 次仍失败 → onFailure 写 retries_exhausted）
  └─ body.error → classify（§2.6）
        ├─ permanent → receipt {status:'unmeasurable', reason, graph_code, graph_subcode}; return
        └─ transient → throw
  └─ body 正常 → 三字段各自读（§2.7）→ 写指标（只写有数字的）+ receipt
```

**回执里同时记 `target_at`（事件约定）与 `measured_at`（实际读取时刻）**，`late_by_seconds` = 差值；迟测不算错，但要看得见。

### 2.6 Graph 错误分类（对齐 `comments.ts:73-93` 既有判据）

| code / subcode | 归类 | 消费者动作 |
|---|---|---|
| 190 | `token_invalid` | permanent；回执；授权体检会下发待办 |
| 10 / 200 | `permission_denied` | permanent；回执 |
| 100 + subcode 33，或 message 含 "does not exist" | `object_gone` | permanent；回执（删帖 / 令牌看不见，外部不可分辨） |
| 100 其它 | `transient` | throw → 重试 |
| 4 / 17 / 341 | `transient`（限流）| throw → 重试 |
| 5xx / 网络 / 非 JSON | `transient` | throw → 重试 |
| **其它未知** | `transient` | throw → 重试（仓库既有哲学：多重试几次便宜，永久跳过一条本可测的贵；`retries: 3` 封顶） |

重试耗尽 → `onFailure` 写回执 `{status:'unmeasurable', reason:'retries_exhausted', last_error}`。**没有任何路径静默丢失一次测量。**

### 2.7 三字段独立读取

| 字段 | Graph 形状 | 读法 | 缺席时 |
|---|---|---|---|
| reactions | `{summary:{total_count:N}}` | `total_count` 是 number → N | `field_absent` → **不写指标行**，回执记 |
| comments | 同上 | 同上 | 同上 |
| shares | `{count:N}` 或**整个字段省略** | `count` 是 number → N | **假设 A1**（§6）：省略 ⇒ 0。**A1 未经实证前**，消费者对省略记 `omitted_unverified`，**不写 shares 指标行** |

`field_absent` 与 `omitted_unverified` 都进回执，不进指标。

---

## 3. 成功 / 部分成功 / 无法测量分别写在哪

| 结果 | `flywheel_metrics` | `flywheel_actions.payload.measurements[]` | Inngest 运行输出 |
|---|---|---|---|
| **成功**（三字段都有数字） | 3 行：`social.post.likes` / `.comments` / `.shares`，`metric_value` 为实数，`source = 'meta_graph'`，`source_ref = {idempotency_key, post_id, page_id, action_id, age_hours, target_at, measured_at}`，`measured_at` = 实际读取时刻 | `{hours, target_at, measured_at, late_by_seconds, status:'ok', values:{likes, comments, shares}}` | 同回执 |
| **部分成功** | 只写有数字的字段（1–2 行） | `{…, status:'partial', values:{likes:3}, missing:{comments:'field_absent', shares:'omitted_unverified'}}` | 同回执 |
| **无法测量** | **零行**（`metric_value NOT NULL`，不伪装） | `{…, status:'unmeasurable', reason, graph_code?, graph_subcode?, last_error?}` | 同回执 |
| **拒绝**（payload 非法 / 隔离不过） | 零行 | 动作行可能尚未建：回执只在 Inngest 运行输出 | `{ok:false, reason:'rejected:…'}` |

回执数组按 `hours` 幂等追加：同 `hours` 已存在则覆盖（同一 `step.run` 记忆化保证正常不会重入；重放时以最新为准）。写法：读动作行 `payload` → 改 → `update where id = action_id`。

**`metric_value` 只承载 Meta 真实返回的数字。0 只在 Meta 返回 0（或 A1 实证后的省略）时写。**

---

## 4. 归因串帖：证明 + 设计决策

### 4.1 证明（现有 attribution 不能按单帖归因）

`src/lib/flywheel/attribution/job.ts`：

- `latestMetricValue(clientId, metricKey, bounds)`（290-310 行）查 `flywheel_metrics`，过滤条件**只有** `client_id`、`metric_key`、`measured_at` 窗口；不看 `source_ref`、不看 `action_id`、不看任何帖子身份。
- `processAction`（345-365 行）：baseline = 该 metric 在 `executed_at` **之前最近一条**；after = `[executed_at, +window_days]` 内**最近一条**。
- `resolveAuthoritativeEvaluator('social.post.likes')`（outcome-identity.ts:127-140）：`social.post.` 不属任何外部家族 → 归通用评估器 → **通用任务会处理它**。

推演（同一客户两帖）：A 于 9/3 公开、B 于 9/4 公开，各在 T+4/T+72 写 `social.post.likes`。
- B 的 baseline = 9/4 之前最近一条 = **A 的 T+4 读数**；B 的 after = 窗口内最新一条 = 谁最后写谁算。
- A 的 baseline = 9/3 之前 = 更早某帖或 null。
- 结论：`delta` 是"本帖最新 − 上一帖某读数"，**语义无效**。

现有归因是给**账号级时间序列**（一客户一时刻一值）设计的；`social.post.*` 是**实体级**。结构性不匹配，不是 bug。

### 4.2 设计决策：让通用归因完全不碰

`loadAttributableActions`（job.ts:130-134）：`.not('expected_metric', 'is', null)` —— **`expected_metric = NULL` 的动作根本不被加载。**

所以本设计的动作行 `expected_metric = NULL`（§2.4）。效果：
- 通用归因任务对本动作 0 次查询、0 行输出、0 串帖。
- `social.post.*` 指标行仍在 `flywheel_metrics`，但**只有本消费者写、只通过 `source_ref.action_id` / `idempotency_key` 读**，永不走时间窗。
- 仓库里现有唯一写 `social.publish_post` 动作的 `logSocialPublishedAction` 用的 `expected_metric` 是 `social.posts.published_count`（账号级计数，social-post-publish.ts:294），不是 `social.post.likes`——**没有任何现存动作会让通用归因去查 `social.post.*`**。

**守卫**：实现阶段加一条契约测试——扫描仓库所有 `flywheel_actions` insert，断言 `expected_metric` 不含 `social.post.likes/comments/shares`。谁将来这么写，测试红。

### 4.3 `flywheel_outcomes`：本期不写，原因

写 outcome 需要：新评估器键 → 扩 `flywheel_outcomes_evaluator_key_check`（expand.sql:175-176，只允许 `'flywheel_metrics'|'gsc_snapshots'`）与第二条家族绑定 CHECK（201-203 行）→ **两处 CHECK 迁移**；且 `window_days SMALLINT`（天）表达不了 T+4h。这是独立设计（phase 2）。本期单帖"效果"= 动作行回执 + 按 `source_ref` 关联的指标行，已可查、可审、不串帖。

---

## 5. 幂等三层 + migration 判定

| 层 | 机制 | 覆盖 |
|---|---|---|
| Inngest 事件 | `idempotency: 'event.data.idempotency_key'` + 发布侧 `id = idempotency_key` | 24h 内重放 |
| Inngest 步骤 | `step.run` 记忆化 | 同一运行内重试不重做 |
| 应用 | 动作行 select-then-insert（23505 → 重查）；指标行 select-then-insert 按 `(client_id, metric_key, source_ref->>idempotency_key, source_ref->>age_hours)` | 跨运行重放 |
| **DB（可选）** | 2 条**部分唯一索引**（下）| 并发重放的竞态窗口 |

```sql
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_ikey
  ON flywheel_actions (client_id, action_type, (payload->>'idempotency_key'))
  WHERE action_type = 'social.publish_post' AND payload->>'idempotency_key' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS flywheel_metrics_post_tplus_ikey
  ON flywheel_metrics (client_id, metric_key, (source_ref->>'idempotency_key'), (source_ref->>'age_hours'))
  WHERE source_ref->>'idempotency_key' IS NOT NULL AND source_ref->>'age_hours' IS NOT NULL;
```

对现有行零影响：现有 `social.publish_post` 行 payload 无 `idempotency_key`；现有 `flywheel_metrics` 行 `source_ref` 无这两键。

**是否确实需要 migration？**
- 新表：**否**。新列：**否**。CHECK 变更：**否**（本期不写 outcomes）。
- 部分唯一索引：**功能正确性不依赖它**（前三层已覆盖正常与重放）；它把"一帖一龄期一指标一行"从应用纪律变成结构保证。**我的判断：包含**——两条索引、无数据变更、无锁风险，换来的是审计口径的硬保证。若审查方倾向零 migration 先上，去掉它设计仍成立，风险只剩"同键事件 >24h 后重放且两运行在 select 与 insert 之间交错"这一窄窗。

---

## 6. 假设登记 + 一次性探针脚本（替代 #1393 路由）

| 假设 | 内容 | 未实证前消费者行为 | 实证方式 |
|---|---|---|---|
| **A1** | Meta 对未被分享的帖子省略 `shares` 字段，省略 ⇒ 0 | 记 `omitted_unverified`，不写 shares 指标 | 探针跑两条帖：一条 shares>0、一条 0；看 0 的那条字段是否省略 |
| **A2** | 当前 CTS 存下来的 Page Token 仅凭 `pages_read_engagement` 能读三个 `summary` | —（A2 不成立则消费者天然走 `permission_denied` 回执，不会错写） | 同一探针 |

**脚本规格** `scripts/meta-post-engagement-probe.ts`（照 `scripts/ga4-key-events-probe.ts` 形状）：

- 跑法：`CLIENT_ID=<uuid> POST_IDS=<id1>,<id2> npx tsx --env-file=.env.local scripts/meta-post-engagement-probe.ts`
- 服务端取 `getStoredPageToken`，对每个 post_id 打一次 §2.5 的 GET
- **输出脱敏 JSON**：`{post_id, http_status, graph_error?:{code,subcode,type,message}, reactions:{kind,value?}, comments:{…}, shares:{kind,value?}, raw_keys:[…]}`；**URL、token 一律不打印**
- 不写库、不发帖；可在本地（有 `.env.local`）或 Render one-off job 跑
- 分类逻辑与 #1393 共用（迁到 `src/lib/meta/post-engagement.ts`）

---

## 7. 实现阶段准确文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/meta/post-engagement.ts` | **新增** | `readTotalCount` / `readShareCount` / `classifyGraphError`（从 #1393 迁入，判据对齐 `comments.ts:reasonFor`） |
| `src/lib/meta/__tests__/post-engagement.test.ts` | **新增** | #1393 的 23 项迁入 + A1 双态 + #100 subcode 分支 |
| `src/lib/inngest/functions/daily-plan-post-tplus.ts` | **新增** | §2 消费者 |
| `src/lib/inngest/functions/__tests__/daily-plan-post-tplus.test.ts` | **新增** | §10 变异清单全覆盖 |
| `src/lib/inngest/functions/index.ts` | +1 行 | 注册 |
| `src/lib/flywheel/__tests__/no-post-level-expected-metric.test.ts` | **新增** | §4.2 契约守卫 |
| `scripts/meta-post-engagement-probe.ts` | **新增** | §6 一次性探针 |
| `supabase/migrations/2026MMDD000001_flywheel_post_tplus_idempotency.sql` | **新增（可选）** | §5 两条部分唯一索引 |
| `src/app/api/clients/[id]/post-metrics-probe/**` | **删除** | #1393 路由方案撤销（在实现 PR 里做，不在本期） |
| `docs/STATE.md` | +2 行 | 登记云端函数 |

**不改**：发布路由、`daily-plan-publish.ts`、`attribution/*`、`vocabulary.ts`、`comments.ts`、`social-post-publish.ts`、`inngest/client.ts`、任何现有表结构。

---

## 8. #1393 处置

按裁决：**保持 Draft，不合并、不部署。** 本期不动它。实现 PR 里：删路由文件，分类函数与测试迁到 §7 的 lib 位置，PR 描述改成"已被 lib + 一次性脚本取代"。

---

## 9. 未解决问题

1. **A1 / A2 未实证**（§6）。实现前跑一次探针；A1 不成立则 `shares` 省略永远按 `field_absent` 处理。
2. **`flywheel_outcomes` 单帖 outcome**（§4.3）：phase 2 独立设计，需两处 CHECK 迁移 + 小时级窗口表达。
3. **`logSocialPublishedAction` 不能复用**（§2.4）：实现时定"带参扩展"还是"同形 insert"。
4. **已发的 7 条帖子**（9/4）：事件在消费者存在前已发出，Inngest 不会自动重放给新函数。要么手动重放，要么接受这 7 条无 T+N 数据。
5. **Inngest Cloud 登记 `/api/inngest`**：运维配置，不是代码。
6. **迟到事件**：`measure_at[0].at` 已过时 `sleepUntil` 立即返回，仍测；回执 `late_by_seconds` 可见。是否对"迟超过 X 小时"另设上限——待定，本期不设。
7. **v2 文档仍在 `feat/meta-auth-health-check`（PR #1362）**：已作废，应在 #1362 合并前撤掉（一条 revert）。本期按"不动其它 PR"未处理。
8. **排期帖被取消**：`measure_at` 锚在 `scheduled_publish_time`，到点帖子若被取消，Graph 回 #100/33 → `object_gone` 回执，覆盖；无需额外处理。

---

## 10. 变异测试清单（实现 PR 必须全部被抓）

| 变异 | 应挂 |
|---|---|
| 从 `published_at` 重算测量时刻而非读 `measure_at[].at` | sleep 目标断言 |
| `published[0]` 式读取 | payload 校验断言 |
| 无法测量时写 `metric_value = null` | 指标零行断言 |
| `shares` 省略在 A1 未实证时写 0 | omitted_unverified 断言 |
| `#100` 无 subcode 33 当 permanent | 分类断言 |
| `#200` 走 throw | permanent 不重试断言 |
| 隔离校验任一条去掉 | page_mismatch 断言（含 post_id 前缀） |
| `expected_metric` 写成 `social.post.likes` | §4.2 契约测试 |
| 重试耗尽不写回执 | onFailure 断言 |
| `concurrency.key` 去掉 | 配置断言 |
| 用 `getMetaTokenForClient`（含全局兜底）替代 `getStoredPageToken` | 隔离断言 |

---

**到此为止。** 等审。通过后另开窗口实施。
