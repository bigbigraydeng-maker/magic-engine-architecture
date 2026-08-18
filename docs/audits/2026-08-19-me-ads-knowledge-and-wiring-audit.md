# ME 广告能力盘点：判据存在哪 · 模块接线状态

**日期**：2026-08-19 · **性质**：只读盘点，未改任何生产代码（本次对 CTS 广告的两处实际改动另见 §7）
**证据来源**：仓库 main 实现（逐文件 import 溯源）· Supabase 真实表行数 · Meta Graph 实时回读（CTS 账户 `2775766642787274`）
**触发**：Product Owner 2026-08-19 提出「不能总是靠我自己的经验和记忆来服务客户广告业务，没有长期性、稳定性和前瞻性」

---

## 0. 跟 [2026-08-14 方向审计](./2026-08-14-meta-ads-direction-audit.md) 的分工

那份 804 行的审计答的是「**投放方向对不对**」（是否 Andromeda 打法、闭环通没通、钱分布如何）。
**本文不重复它的任何结论**，只补它没覆盖的一个问题：

> **广告这件事的「判据」和「知识」目前存在哪里？为什么每次都要靠人回忆？**

两份一起读才完整。冲突时以更晚的实测为准，并在此注明。

---

## 1. 一句话结论

**ME 有「看」的能力，有一半「判」的能力，但几乎没有「知识沉淀」的能力。**

采集稳定在跑；健康判定只会跟自己过去比；而**决定怎么投的那些判据——每条测试臂多少钱、探索池占几成、跑多久才能看、什么信号才算数——一条都没进代码**，全部活在一份不会自我更新的文档和人的记忆里。

---

## 2. 判据存在哪（本文核心）

广告决策所依赖的知识，目前散在三个地方，**没有一个是活的**：

| 存放处 | 装了什么 | 会不会自我更新 | 谁能读到 |
|---|---|---|---|
| **SOP 文档**<br>`docs/sops/meta-ads-angle-test-and-budget.md` | 一条臂 = 100 次点击 ≈ NZD 68 · 探索池 = 月预算 × 20% · 最少跑 7 天 · 前 4 天不许看 · 各 objective 对应的判定信号 | ❌ **不会**。文档自己写了「每季度重算一次，别当常量」，**没有任何代码或定时任务会去执行那句话** | 只有主动去读文档的人 |
| **代码里的散落常量** | `guardrails.ts` 的 ±20% 预算变更上限；`ad-publisher.ts:116` 写死的 `advantage_audience: 0`；设置页写死的 `× 0.2` | ❌ 不会 | 只有读源码的人 |
| **人的记忆** | 哪个说法上次管用 · 哪个账户是真的 · 哪个坑踩过 | ❌ 不会 | **只有那个人本人** |

### 2.1 实测：SOP 的数字已经漂了，没人发现

| 判据 | SOP 记的值（2026-06-21~08-13 实测） | 2026-08-19 实测 | 偏差 |
|---|---|---|---|
| 单次点击成本上界（CTS） | NZD **0.68** | NZD **0.85**（再营销近 7 天） | **+25%** |
| 一条测试臂预算（CTS） | ≈ NZD **68** | 应为 ≈ NZD **85** | 低估 20% |
| 每个留资成本（CTS） | NZD **5.2**（`$2,231.59 / 429`） | NZD **9.09**（`$3,910.73 / 430`，四条留资类 campaign 累计）<br>近 7 天 **9.19** | **+75%** ⚠️ |

⚠️ **留资成本这条两边口径对不上**：留资笔数几乎一样（429 vs 430），花费差 NZD 1,679。
两个口径必有一个错，**尚未查清**，不要拿任一数字直接做预算决策。
这正是问题本身——**没有任何机制会发现这种漂移**，是人手工翻出来的。

### 2.2 后果

按 SOP 那个 68 去算臂数，会**系统性高估**能开几条臂，然后钱被摊薄——
而摊薄正是 SOP §0 开篇要禁止的那件事。**判据不自动重算，SOP 就会亲手制造它要防的问题。**

---

## 3. 告警链路的断点

### 3.1 全部停投时，系统选择沉默

`src/lib/ads-strategy/digest.ts` 的 `decideSend()`：

```
// insufficient_history or any unexpected value → never email on a non-verdict.
return 'skip'
```

当一个客户所有广告都不在投时，整体判定为 `insufficient_history`，**直接跳过、不发邮件**。

**实测**：CTS 在 2026-08-03~08-13 连续 **11 天**写下「所有 4 条广告都已停投」，
`ad_health_narratives` 每天一条如实记录，**一封邮件都没发**。
（该次停投系 Product Owner 主动停预算，未造成损失 —— 但**同一段代码分不出「刻意停」和「投放挂了」**。）

🔴 **「拿不到数据」有三种来路，今天全归成一种：**

| 来路 | 长什么样 | 应该怎么办 | 今天怎么办 |
|---|---|---|---|
| 真的没有 | 人主动停了预算 | 不报警，记住谁何时停的 | 沉默 |
| 没查到 | 取数失败 / 账户 ID 指错 | **是故障，必须报** | 沉默 |
| 不该没有 | 昨天还在花钱，今天变 0，没人下过指令 | **是钱在出事，最该报** | 沉默 |

### 3.2 止损必须人工点

`stop-loss.ts`（277 行）功能完整、有测试、有 UI，**但只挂在后台页面上，没有任何定时任务**。
必须有人主动打开广告健康度页面点一下才会执行。**系统不会自己刹车。**

---

## 4. 模块接线全表

31 个广告相关模块的真实可达性（`src/app` 层 import 溯源 + 传递闭包）：

> ⚠️ **判据说明**：「无 app 层调用」≠ 死代码 —— 多数是被其他 lib 模块相对引用后间接可达。
> 本表已做传递闭包，**只有传递后仍无入口的才标孤儿**。

### 4.1 有定时任务（每天自动跑）

| 模块 | 由谁触发 | 频率 |
|---|---|---|
| `ads-strategy/daily-insights` | `cron/google-data-pullback-daily` | `0 3 * * *` |
| `ads-strategy/evaluate`（→ `baseline` → `prescription`） | 同上 | 同上 |
| `ads-strategy/digest` | 同上 | 同上 |
| `ads-strategy/config` | 同上 | 同上 |
| `ads-strategy/readback-sweep`（→ `launch-readback`、`meta-readback-adapter`、`meta/readback`） | `cron/ad-readback-sweep` | `40 20 * * *` |
| `meta/client`（→ `objective-metrics`） | `cron/google-data-pullback-daily` | `0 3 * * *` |
| `meta/leads-sync`、`meta/token-manager` | `cron/meta-leads-sync` | `25 * * * *` |

### 4.2 只能人工触发（页面 / 手动调 API）

`ads-strategy/stop-loss` · `ads-strategy/draft-and-gate`（→ `meta/ad-publisher`）· `ads-strategy/ad-draft`（→ `play-vocabulary`）·
`ads-strategy/ad-level-breakdown` · `ads-strategy/listing-draft-builder` · `meta/adsets` · `meta/asset-upload` ·
`meta/guardrails` · `meta/lead-forms` · `meta/page-posts` · `meta/ads-posts` · `meta/comments`

### 4.3 🔴 孤儿（传递闭包后仍无任何调用方）

| 模块 | 行数 | 它本该干什么 |
|---|---|---|
| **`meta/audience-ladder.ts`** | **333** | 「把手工建的意图受众建成阶梯 —— Audience Asset Engine (P18.D)」。**全仓 0 处引用。** |

🔴 **这一条最能说明问题**：2026-08-19 本人手工往 CTS 再营销广告组里加了一个受众
（`CTS - FB Page engaged - 365d`）—— **这个文件本来就该自动做这件事。写好了，没接线，然后用手做了一遍。**

> 📎 与 8-14 审计的关系：那份审计已指出 `audience-ladder.ts` 是**行为分层**而非**意图建模**（§6）。
> 本文补充的是另一件事：**它连行为分层这件事也没在跑**，因为根本没接线。两条结论不冲突。

（`meta/ads-manager` 曾疑似孤儿，核实后由 `winner-reel-sync/engine.ts` 引用，**不是孤儿**。）

---

## 5. 数据现状（全库行数，2026-08-19 实测）

| 表 | 行数 | 说明 |
|---|---|---|
| `ad_daily_insights` | 607 | ✅ 每天在写 |
| `meta_ads_snapshots` | 117 | ✅ 每天在写 |
| `ad_health_narratives` | 75 | ✅ 每天在写 |
| `flywheel_outcomes` | 197 | 有数据 |
| **`ad_strategy_configs`** | **0** | 🔴 **整张表空的**，一个客户的配置行都没有 |
| **`ad_creative_links`** | **0** | 🔴 空表 —— 系统不知道「哪个**说法**赢了」，只知道「哪条**广告**便宜」 |

`ad_strategy_configs` 空表的直接后果：[#1036](https://github.com/bigbigraydeng-maker/magic-engine/pull/1036)
要往这张表加的 4 个月预算列在生产**尚不存在**（实测 `column ad_strategy_configs.monthly_ad_budget does not exist`），
PR 处于 draft + BLOCKED。**所以今天全库没有任何地方记着任何客户的月广告预算**，
而 SOP 的第一个公式就要用它。

---

## 6. 三个断层（对应 Product Owner 提的三件事）

| 诉求 | 断在哪 | 证据 |
|---|---|---|
| **稳定性** | 关键动作全靠人点 | 止损无定时任务（§3.2）· 改受众后 Meta 强制暂停，不手工恢复就静默停投（§7） |
| **长期性** | 知识不在系统里 | SOP 判据 0 条进代码（§2）· 数字已漂 25~75% 无人发现（§2.1） |
| **前瞻性** | 不知道「谁赢了」 | `ad_creative_links` 0 行（§5）· 每换一批素材，学到的东西归零 |

---

## 7. 本次实操留下的两条硬事实（Meta 接口行为）

2026-08-19 对 CTS 广告的实际改动中实测：

1. **`ads_update_entity` 改 `targeting` 会强制暂停广告组** —— 返回 `"status_forced_to_paused": true`，
   必须紧接 `ads_activate_entity` 才恢复。**不补这一刀，广告静默停投。**
   （此前只知道改预算会触发，改受众同样触发。）
2. **`age_min` 不能设到 25 以上**，只要广告组算 Advantage+ 受众。
   ⚠️ 触发条件比想象宽：`targeting_automation.advantage_audience = 0` 也照样被拒，
   因为 `targeting_relaxation_types.custom_audience = 1` 同样会被判定为 Advantage+。报错 subcode `1870188`。
3. **`targeting` 是整体替换不是合并** —— 必须把 geo / custom_audiences / excluded_custom_audiences /
   targeting_relaxation_types / targeting_automation 全部原样带上，漏哪个哪个就没了。改前完整回读，改后回读核对。

---

## 8. 本文哪些是实测、哪些是主张

**实测（可复现）**：
§2.1 全部数字（Meta Graph 实读 + SOP 原文对照）· §3.1 的 11 天沉默（`ad_health_narratives` 逐日查询）·
§4 全部接线状态（`grep` import 溯源 + 传递闭包）· §5 全部行数（REST `count=exact`）· §7 三条（实际调用返回）

**主张（可以反驳）**：
§1 的「几乎没有知识沉淀能力」是对 §2 事实的概括 ·
§6 三个断层与三个诉求的对应关系是本文的归因，不是唯一解释 ·
§2.2「判据不自动重算会亲手制造摊薄」是推论，尚无实际摊薄事故佐证（Oztop 那次摊薄发生在 SOP 成文之前）

**明确未查清、不要引用**：
§2.1 留资成本两个口径差 NZD 1,679 的原因 · CTS 广告 2026-08-01~08-13 停投的具体触发方
（已知系主动停预算，但未核实是哪次操作）
