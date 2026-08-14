# Magic Engine Meta Ads Direction Audit — Andromeda-era 对照

**日期**：2026-08-14 · **性质**：只读审计，未改任何生产代码
**证据来源**：仓库 main 实现 · Supabase `ad_daily_insights` / `ad_creative_links` / `winner_structures` / `flywheel_actions` 等真实表 · Meta Graph 实时回读（CTS 账户 `2775766642787274`，26 个 ad set 的 live targeting）

---

## 1. Verdict

## 🟡 YELLOW — 方向正确，但实现仍偏传统

四句话：

1. **投放侧（delivery）实际上已经在 Andromeda 打法上** —— 但这个结论**只覆盖 CTS 一家、总花费的 47.7%**（$3,733.59 / $7,822.57）：回读到的 26 个 ad set 里 23 个开着 `advantage_audience: 1`（**条数比，不是花费比**），最大那条 $2,251 的 campaign 是纯 broad + Advantage+ 受众。**Oztop（46.1%）和 Roman（6.1%）的账户都查不到 targeting**，合计 52.3% 的花费无证据（见 §3.1 对账表与附录 1）。
2. **但那不是 ME 做的** —— 是人在 Ads Manager 里点出来的。ME 自己唯一的建广告代码 `ad-publisher.ts:116` 写死 `targeting_automation: { advantage_audience: 0 }`，即**主动关掉** Advantage+ 受众。这条代码路径至今建过 0 条广告，所以冲突还是潜在的，不是已发生的。
3. **创意侧是真正传统的那一半**：钱最多的三条 campaign（$5,300，占总花费 67.8%）总共只有 **4 条创意**；而做了真多角度测试的两次（Oztop 13 条 hook、Roman 15 条 angle）加起来只花了 $799，占 10.2%。**创意多样性只发生在没钱的地方。**
4. **闭环没有通电**：`ad_creative_links` 0 行、`contacts.attr_creative_ref` 0 行（39 条已归因 lead 无一条能说清是哪条素材）、`winner_structures` 0 行、`variant_from_winner` 工单 0 条、`flywheel_actions` 里 `ads.create_ad` 0 条。**数据结构全都建好了，一个都没被写过。**

不是 RED，因为架构没有和 Andromeda 打架 —— 该有的表、该有的 ad 级日度数据（376 行）、该有的角度生成器都已经存在。不是 GREEN，因为**从"发现赢家"到"生成下一轮"这半圈，一次都没有真实跑通过**。

---

## 2. Current Reality — 我们目前实际上是怎么投广告的

真实流程（2026-06-21 ~ 2026-08-13，$7,822.57，17 条 campaign，56 条广告）：

```
人在 Ads Manager 里手工建 campaign / ad set / 创意
        ↓（ME 完全没参与建的过程）
ME 每天 cron 拉回 campaign 级 + ad 级日度数据 → ad_daily_insights
        ↓
ME 用「跟自己历史比」的相对基线判疲劳 → ad_health_narratives（63 行）
        ↓
出一条处方（补素材 / 换人群 / 查报价）+ 一个止损按钮（降 20% 预算或暂停）
        ↓
人决定要不要按
```

也就是：**ME 现在是一个"看广告的仪表盘 + 止损手"，不是一个"投广告的引擎"。**

三条 ME 自己能建广告的路径都存在，但实际产出接近零：

| 路径 | 代码 | 真实产出 |
|---|---|---|
| `boost_post_api` 给帖子投流 | `meta-ads/boost-post/route.ts` | `ad_creative_links` 0 行 → 未用过 |
| `winner_reel_sync` 自然爆款自动进广告组 | `winner-reel-sync/engine.ts` | 日跑，30 天内只成功建过 1 条（2026-07-23），之后每次 `create_failed` 或被闸门挡住 |
| ME 起草→建成暂停→过闸门→人点头 | `ads-strategy/draft-and-gate.ts` | `ads.create_ad` **0 条** |

---

## 3. Evidence

### 3.1 投放确实是 broad + Advantage+（live 回读，不是文档）

Meta Graph 实时读 CTS 账户 `act_2775766642787274` 的 26 个 ad set：

| 事实 | 数字 |
|---|---|
| `targeting_automation.advantage_audience = 1` | **23 / 26** |
| `advantage_audience = 0` | 2（`Retargeting - VideoViewers + FormOpeners`、一条 boost）|
| 完全没有兴趣/行为定向（`flexible_spec` 与 `interests` 均空） | 18 / 26 |
| 带兴趣定向的 ad set 合计花费 | **$635.63 / $5,066.52 ≈ 12.5%**（⚠️ 分母见下方警告，**不是**覆盖率）|

> 🔢 **两个数不能相加**（Codex 复审第五轮 P2，核实成立；上一版把它们混用了）。
>
> `$5,066.52` 是 **Meta 侧**广告账户 `2775766642787274` 里 26 个 ad set 的合计（NZD）。而 `act_2775766642787274` 是本仓记录在案的**混账户** —— `docs/strategy/meta-flywheel-risk-and-sequencing.md`（2026-06-06）写明「所有 boost 都在这里，CTS 旅游帖 + Oztop flooring 帖混跑」。**它既混客户又混币种，不能当覆盖率的分母。**
>
> 覆盖率必须在**同一个分母**上算，即 ME 库 `ad_daily_insights` 的 campaign 级花费（§2 的 $7,822.57）：
>
> | | 花费 | 占比 | targeting 是否回读 |
> |---|---|---|---|
> | CTS 的 campaign | **$3,733.59** | **47.7%** | ✅ 已回读 |
> | Roman 的 campaign | $480.71 | 6.1% | ❌ 账户不可查 |
> | Oztop 的 campaign | $3,608.27 | 46.1% | ❌ MCP 未放量 |
> | **未回读小计** | **$4,088.98** | **52.3%** | ❌ |
> | 合计 | $7,822.57 | 100% | — |
>
> （$3,733.59 + $4,088.98 = $7,822.57，与 §2 精确对账。）
>
> ⚠️ **Roman 这一行是第七轮才改对的**：上一版把 Roman 算进"已回读"，但他 $480.71 的花费在 `act_1018365291238494`，而 `ads_get_ad_accounts` 对该账户返回 `is_queryable: false` / `not_queryable_reason: "Unknown error"`（账户状态 UNSETTLED）。本次实际读到的那条 Roman ad set（`North Shore 15km · Message Leads · 4-Creative Race`）在另一个账户、且花费为 **$0.00**，代表不了那 $480.71。
>
> **所以本审计关于 broad / Advantage+ 的结论，证据只覆盖 CTS 一家、$3,733.59、总花费的 47.7%。**
>
> 还有两个数**不能当覆盖率用**，只描述"已回读的那 26 个 ad set 内部"：
> - `23 / 26` 是**条数比**，不是花费比；
> - `12.5%` 的分母是 `$5,066.52`，那是混账户的 Meta 侧合计（混客户 + 混币种），**跟 $3,733.59 不是一回事**。
>
> 本审计**没有**把 targeting 按 CTS 的 $3,733.59 重新汇总（跨账户口径对不齐，见上），所以文中任何"某某比例的花费是 broad"的说法都只对那批 ad set 成立，不对客户花费成立。

最大那条：

```
Reborn-Winner-Stand-in-Front-20260624
  optimization_goal = LEAD_GENERATION
  spend  NZ$2,251.80   results 219
  targeting = { age 18-65, geo NZ, 无兴趣, 无 custom audience,
                targeting_automation: { advantage_audience: 1 } }
```

Roman 的 `North Shore 15km · Message Leads · 4-Creative Race` 还带 `targeting_optimization: "expansion_all"` —— 这已经是 Andromeda 想要的形态。

> ⚠️ Oztop 账户 `1735240120460765` 的 `is_ads_mcp_enabled = false`（Meta 尚未放量），**它的 targeting 这次没读到**。Oztop 占总花费 $3,608.27（46.1%），所以"broad 占比"这个结论目前只对 CTS/Roman 侧成立，Oztop 侧是 inference（campaign 名字叫 `Cold Broad`，但名字不算证据 —— `play-vocabulary.ts` 自己写过"最花钱那条名字零信息量"）。
>
> **两条路都实测过，都不通**（2026-08-14 本次审计内重试）：
> - Meta MCP 直接拒绝：`This ad account is not enabled for the Ads MCP. Ad account ID: 1735240120460765`
> - 替代路（直调 Graph）也走不了：本次审计所在的环境**没有 `META_SYSTEM_USER_TOKEN`**（仓库里只有 `.env.example`）
>
> 所以这个缺口**必须在有生产 token 的环境里补**，不是"再试一次就好"。见 §7 第 0 步。

### 3.2 ME 自己的代码在反方向（唯一的结构性冲突点）

`src/lib/meta/ad-publisher.ts:105-118`：

```ts
function targetingFor(d: AdDraft): Record<string, unknown> {
  return {
    geo_locations: geo,
    age_min: d.ageMin ?? 25,
    age_max: d.ageMax ?? 65,
    // 明确关掉 Meta 的自动放宽。
    targeting_automation: { advantage_audience: 0 },
  }
}
```

无差别对所有草案关闭 Advantage+ 受众。注释写的理由是"关了也不一定真关，所以要回读"—— 理由本身成立（回读闸门是对的），但**结论选错了默认值**：对冷启动 / 表单 / 攒池类打法，关掉扩量正是 Andromeda 时代最贵的一个开关。

配套的 `launch-readback.ts:231` 把 `advantageAudience = true` 判成 **blocker**，不过只在 `claimsRetargeting` 时触发 —— 那一条是对的（重定向名单被悄悄扩量确实是事故，2026-08-04 Roman $5.88 零结果）。**问题只在 publisher 那一行的全局默认值。**

### 3.3 钱和创意的分布 —— 最能说明问题的一张表

来自 `ad_daily_insights`（`level='ad'`，376 行，56 条广告）：

| Campaign | 客户 | 创意数 | 花费 | 结果 | 花费占比 |
|---|---|---|---|---|---|
| `Oztop — Lead Form — Cold Broad — 20260709` | oztop | **2**（97.6% 在一条上） | $2,288.52 | 78 | 29.3% |
| `CTS — Lead Form — Reborn — 20260624` | CTS | **1** | $2,231.59 | 429 | 28.5% |
| `CTS - Retargeting - Warm - 20260707` | CTS | **1** | $780.32 | 215 | 10.0% |
| `OZ-THRU-S1-hooktest-202607` | oztop | **13** | $432.50 | 0 | 5.5% |
| `30 Kiteroa · Message Leads Test` | Roman | **15** | $366.26 | 37 | 4.7% |
| `CTS - ThruPlay Reels - Pool builder` | CTS | 6 | $232.62 | 0 | 3.0% |

**4 条创意吃掉 67.8% 的钱；34 条创意抢 13.2%。**

### 3.4 那两次真正的多角度测试，角度是真的不同

不是"换个颜色换个标题"—— Oztop 的 13 条 hook 覆盖了不同痛点 / 人群 / 场景 / 报价：

```
OZ-S1-A-spill（洒水）      OZ-S1-B-warp（起翘）    OZ-S1-C-alex（人物）
OZ-S2-R3-avoidproblems     OZ-S2-R4-lifestylefit   OZ-S2-R6-kidsdog（小孩+狗）
OZ-S2-R9-rentvslive（租 vs 自住）  OZ-S3-T1-savingsmath（算账）
OZ-S3-T2-spillpromo        OZ-S3-T3-julyspecial    OZ-S3-W1-pricetag
OZ-S3-W2-stockscale        OZ-S3-W3-texture        OZ-S1-D-Showroom-SR01
```

Roman 的 15 条同样是真角度：`Rangitoto 学区 hook` / `By negotiation` / `$10k Prezzy offer` / `价格前置` / `Room to grow` / 三语 / 韩语挑战者 / IG 专投。

**这说明"多角度"这件事我们会做，是人做的，而且做对了。问题在别处（见 3.5、3.6）。**

### 3.5 两次多角度测试，ME 都读不出结论（但原因各不相同）

⚠️ **本节初稿把第一条写反了，已更正**（Codex 复审第六轮 P1，核实成立）。原稿写的是「Oztop 13 条 hook 跑的是 `THRUPLAY` 目标 → results 全为 0，测完不知道哪个角度带生意」，把它当成实验设计的缺陷。**这是本仓 2026-08-04 那次误判的重演。**

`src/lib/flywheel/ads-expected-metric.ts:108-123` 原文（就是为这个 campaign 写的）：

> 2026-08-04 真实误判：`OZ-THRU-S1-hooktest`（$432）、`CTS - ThruPlay Reels`（$233）、`OZ-REACH-Warmpool`（$169）三条都是 0 结果，我一度当成「$834 打水漂」报给 PM。实际上它们的目标分别是看完视频和触达 —— **results 列对这类目标本来就恒为 0，0 是对的，报警才是错的。**

`play-vocabulary.ts:55-62` 也写明 `thruplay_pool_build` 的成效是「单次完播成本 + 池子涨了多少人。**results 恒为 0，不是失败**」。

**所以准确的说法是：**

- **Oztop 13 条 hook 的目标选对了。** 它是攒池实验（`OZ-THRU-S1-hooktest`，打法 `thruplay_pool_build`），要筛的是"哪个 hook 能最便宜地让人看完"，`THRUPLAY` 正是该用的目标，results=0 是设计如此。
- **真正的缺陷在 ME 这一侧：这个实验该看的指标，我们一个都没入库。** `ad_daily_insights`（migration `20260721000001`）只有 `spend / impressions / reach / clicks / frequency / cpm / ctr / cpc / leads / messaging_conversations / results / cost_per_result` —— **没有完播次数、没有单次完播成本、没有 `video_p100`、也没有受众池增长**。于是花掉的 $432.50 在 ME 里唯一读得出的结论是「0 结果」，而那个数按仓库自己的规矩根本不该拿来判好坏。
- 这件事**已经登记但没做**：ROADMAP `P21.K.8`（objective 感知 + 视频疲劳正向检测）就是补这批指标的那一条。
- 另外钱确实高度集中：`OZ-S1-A-spill` 一条吃掉 $280.72 / $432.50（65%）—— 这一条与目标无关，是 13 个角度之间没跑成公平竞争。
- **Roman 15 条 angle 总预算只有 $366**，平均每条 $24。最贵的一条 `Ad F · 中文 · Rangitoto 学区` $111.33 拿到 21 个对话（$5.30/对话），最便宜的几条只有 $2.54–$4.82、个位数展示。这个量级下"谁赢了"是掷硬币。仓库自己算过这笔账（`play-vocabulary.ts` 头部注释）：**要测出中英差异的显著性需要 $1,835，而一个楼盘总预算 $2,000。**

### 3.6 ME 自己出的草案，结构上就只能出一条创意

`src/lib/ads-strategy/listing-draft-builder.ts:193` 与 `:254`：

```ts
    creatives: [creative],     // ← 两个 builder 都是硬写单条
```

而且文件头明写 **「一个草案 = 一种语言」**，两种语言 = 两份草案 = **两个 ad set**。也就是说 ME 目前的产出方式，天然就是"少量素材 + 按语言拆组"—— 正是要避免的那个形态。

（`AdDraft.creatives` 本身是数组，`ad-publisher.ts:215` 也已经在循环建创意 —— **管道支持多条，只有 builder 没给。**）

### 3.7 闭环各环节的真实行数

| 表 / 事实 | 行数 | 含义 |
|---|---|---|
| `ad_daily_insights` (campaign) | 201 行 / 17 实体 | ✅ 数据脊柱在跑 |
| `ad_daily_insights` (ad) | 376 行 / 56 实体 | ✅ ad 级也在跑 |
| `ad_health_narratives` | 63 行 | ✅ 每天在判 |
| `ad_creative_links` | **0** | ❌ 「这条广告是哪条片」从没记过一条 |
| `contacts.attr_creative_ref` | **0**（`attr_ad_id` 有 39 条） | ❌ 归因停在广告级，到不了创意级 |
| `winner_structures` | **0** | ❌ 赢家骨架库是空的 |
| `content_work_orders` where `order_type='variant_from_winner'` | **0**（22 条全是 `fresh_angle`） | ❌ 「从赢家扩展下一轮」从没发生 |
| `flywheel_actions` where `action_type='ads.create_ad'` | **0** | ❌ ME 起草建广告那条路从没走过 |
| `ad_strategy_configs` | **0** | ⚠️ 每客户开关表没人填（走默认） |

> **写入方接线到什么程度**（初稿说"已经接好了"，不够准确，按源码逐行更正）：
>
> - `ad_creative_links` 的**素材归因那一半**确实接好了 —— `boost-post/route.ts:122` 与 `winner-reel-sync/engine.ts:214` 都在调 `linkAdToCreative`。它是 0 行是因为这两条路径自 2026-08-01 以来一次都没建成过广告。
> - 但**打法账本那一半没接**：两处调用都没传 `play` / `playSource`，所以 `persistLink` 会把这两列写成 `NULL`。即使这两条路径明天跑起来，打法账本仍然是空的。
> - 而 `ads.create_ad` 那条流水只有 `draft-and-gate.ts` 会写，**它反过来从不调 `linkAdToCreative`** —— 而且不是"忘了调"：那条路径用 `object_story_spec` 建全新创意，**没有帖子 id 可传**，`ad_creative_links.post_id` 又是 `NOT NULL`，所以它今天**在结构上就记不进这张表**（`creative-link.ts:54` 预留的 `'me_ad_launch'` 至今没加，正是因为这个）。
>
> 结论：**这三张表是三条不同的路各写一部分，没有任何一条路能同时写全；而且 draft 那条路缺的不止是调用，是素材身份和一次 migration。** 详见 §7 ①。

### 3.8 winner 判定现在判的是什么

`winner-reel-sync/engine.ts` + `meta/page-posts.ts:105` 的 `rankVideoWinners`：

```ts
posts.filter(p => p.mediaType === 'video').filter(p => p.score >= minScore)
```

`score` 来自**自然帖的互动数**，不是付费成效。疲劳暂停用的是 `CTR < median × 0.5`。也就是说：

- **赢家是按自然互动选的，不是按广告带来的生意选的。**
- 30 天日志里 `insufficient_ctr_signal`（有效 CTR 样本 < 3 条）几乎每次都命中 → 暂停那半边基本没在工作。

`ad-level-breakdown.ts` 是唯一按付费成效比较创意的模块（已接进 `/dashboard/ad-engine`），但它**刻意拒绝宣布赢家**（文件注释：「本模块从不宣称谁赢了，只宣称『这个汇总在掩盖差异，你得自己看』」）。这个克制在当时是对的（2026-08-04 就是因为看汇总下了错结论、挪错了预算），但代价是：**系统永远不给结论，结论永远由人给，于是学习无法沉淀成数据。**

### 3.9 角度生成能力已经存在 —— 但接在内容线上，没接在广告线上

`src/lib/factory/copy-generator.ts` 有按北极星指标切换的 hook / CTA 战略意图生成（`hookIntentFor` / `ctaIntentFor`），`strategist.ts` 有 `normalizeAngle` + 角度去重（`FACTORY_ANGLE_DEDUPE_DAYS`）+ `angle_source` 溯源，`winner_structures` 表有 `hook_segment / middle_segment / cta_segment` 三段骨架。

**这正是"AI 自动生成多个 hooks / angles"要的那套东西 —— 它已经写好了，但它服务的是自然内容工厂（22 条工单，1 条发布），从来没有为广告出过一条创意。**

---

## 4. What We Are Doing Right

1. **实际投放已经是 broad + Advantage+** —— 已回读的 26 个 ad set 里 23 个开着（条数比），其中带兴趣定向的占那批 ad set 花费的 12.5%。这一条最重要，也最容易被自己低估 —— 但**证据只覆盖 CTS 一家、总花费的 47.7%**，Roman + Oztop 合计 52.3% 的账户查不到，口径见 §3.1 的对账表。
2. **ad 级日度数据脊柱是真的**（376 行，每天在写，带 `parent_id`）。绝大多数同类系统只有 campaign 级 —— 没有 ad 级就永远做不了 creative-level 学习。这块地基已经打好了。
3. **不拿汇总骗自己**：`ad-level-breakdown.ts` 会在子项差异 ≥1.5 倍时明说"这个汇总在掩盖差异"，还会拦住"表单留资 + 私信对话被加在同一列"的不可比比较。这是很多投放团队都没有的纪律。
4. **建完必回读**：`launch-readback.ts` 承认"创建接口的回显不含 Meta 自己补上的东西"，强制建成暂停 → 回读 → 人点头。这在 Advantage+ 时代**更重要**，因为平台会自动加的东西只会越来越多。
5. **多角度这件事我们会做**（3.4 的 13 条 hook / 15 条 angle 是真角度，不是换色）。缺的是把它变成系统行为，不是缺能力。
6. **不编造**：`listing-draft-builder` 结构上不可能编价格/战绩，禁用词直接拒绝出稿。这是 Andromeda 时代大批量出创意的前提 —— 量一上来，靠人审文案就来不及了。

---

## 5. What Is Still Wrong

| # | 问题 | 证据 |
|---|---|---|
| 1 | **ME 自己的建广告代码默认关掉 Advantage+ 受众** | `ad-publisher.ts:116` `advantage_audience: 0`，无差别 |
| 2 | **钱全压在单条创意上** | 前三大 campaign $5,300 / 4 条创意 |
| 3 | **视频/攒池类实验该看的指标 ME 一个都没采** —— 目标本身是对的，读不出结论是我们的问题 | `ad_daily_insights` 无完播次数 / 单次完播成本 / `video_p100` / 池子增长；13 条 hook 的 $432.50 在 ME 里只读得出「0 结果」，而那个数按 `ads-expected-metric.ts:108-123` 本就不该用来判好坏。ROADMAP `P21.K.8` 已登记未做 |
| 4 | **多角度测试的预算不足以出结论** | Roman 15 条 / $366，仓库自己算过需要 $1,835 |
| 5 | **ME 出的草案结构上只能有一条创意 + 按语言拆 ad set** | `listing-draft-builder.ts:193,254` |
| 6 | **creative 级归因断链** | 39 条 lead 有 `attr_ad_id`，0 条有 `attr_creative_ref` |
| 7 | **赢家按自然互动选，不按付费成效选** | `rankVideoWinners` 只看 `score`（互动） |
| 8 | **系统刻意不给赢家结论** | `ad-level-breakdown` 明确"从不宣称谁赢了" |
| 9 | **赢家→下一轮的通路是空的** | `winner_structures` 0 行，唯一写入方是 Airtable 人工表单 |
| 10 | **每条帖子一个 campaign + 一个 ad set** | CTS 账户 26 个 ad set 里 14 个是 `帖子："…"` 型 boost，单条 $2–$37，学习数据被彻底打散 |

**关于问题 10 的说明**：这是本仓最典型的 audience fragmentation，但它的成因不是"按兴趣拆人群"，而是"每次 boost 一条帖子就新开一套"。表现一样：小预算跑不出 learning，创意之间无法在同一个竞价里公平竞争。

---

## 6. Missing Loop

| 环节 | 状态 | 依据 |
|---|---|---|
| Offer | **PARTIAL** | `factory_config.verified_offer` + `listing-draft-builder` 的 `ListingFacts` 存在，但没有 offer → 广告的结构化通路 |
| Audience intents | **MISSING** | 无意图建模。`audience-ladder.ts` 是行为分层（看过视频/开过表单）的重定向阶梯，不是"意图 → 角度" |
| Creative angles | **PARTIAL** | `copy-generator.hookIntentFor/ctaIntentFor` + `strategist.normalizeAngle` 存在，但只服务自然内容，广告线无角度概念 |
| Creative generation | **PARTIAL** | 内容工厂 22 条工单，仅 1 条发布；广告线只会模板拼装单条 |
| Campaign deployment | **PARTIAL** | `draft-and-gate` 全链路已实现且有闸门，生产使用 **0 次** |
| Broad / Advantage+ delivery | **DONE（人工）/ CONFLICT（ME 代码）** | live 23/26 开着；但 `ad-publisher.ts:116` 写死关闭 |
| Performance ingestion | **DONE** | `ad_daily_insights` campaign 201 行 + ad 376 行，日 cron |
| Creative-level attribution | **MISSING** | `ad_creative_links` 0 行 / `attr_creative_ref` 0 行。素材归因写入方已接线但从未触发；`ads.create_ad` 那条路径**根本不调它**（见 §3.7 注）|
| Winning-angle detection | **PARTIAL** | 有 divergence 检测但拒绝下结论；winner 判定用的是自然互动分；**且视频/攒池类实验该看的指标（完播成本、池子增长）根本没入库**，那类角度测试在 ME 里天然判不了（ROADMAP `P21.K.8`） |
| Next-generation creative creation | **MISSING** | `variant_from_winner` 工单 0 条 |
| Learning persistence | **MISSING** | `ad_creative_links.play/play_source/play_context` 三列已建但 0 行，且**两条建广告路径都没传 `play`**，跑起来也仍是 NULL；`PLAY_CATALOG.knownTraps` 是手写的，不是学来的 |

**一句话**：右半圈（拿数据、判疲劳、止损）**DONE**；左半圈（出角度、建广告、记素材、学赢家、扩下一轮）**几乎全是 MISSING/PARTIAL**。

断点的性质分三档，别混为一谈（这一点本审计自己写错过两次，见 §7）：**真·接线**只有一处（给两个已有调用点传 `play`，§7 ①a）；**要改数据契约 + migration** 一处（让 ME 起草的广告能记进 `ad_creative_links`，§7 ①b）；**真缺能力、要新增开发**一处（批量出角度，§7 ③）。

---

## 7. Highest-Leverage Next Step（最多 3 个，按优先级）

### ① 先把记账补齐，再让 ME 建出下一条广告

⚠️ **本节初稿写错过一次，已按实际代码更正**（Codex 复审 P1 抓到，核实成立）。原稿说"跑通一条广告会同时点亮四件事"—— **不成立**。逐行核对后的真实接线状况：

| 路径 | `linkAdToCreative` | `play` / `play_source` | `flywheel_actions` (`ads.create_ad`) |
|---|---|---|---|
| `boost-post/route.ts:122` | ✅ 调了 | ❌ **没传**（只给 clientId/adId/postId/pageId/createdBy） | ❌ 不写 |
| `winner-reel-sync/engine.ts:214` | ✅ 调了 | ❌ 没传 | ❌ 不写 |
| `draft-and-gate.ts` | ❌ **从不调** | — | ✅ 写 |

也就是说：**没有任何一条现存路径能同时点亮四件事。** 现在直接去投一条真广告，花掉的是客户预算，而素材归因和打法账本仍然会是空的 —— 正是本审计在批评的那种"各环节都正常、并排看才发现断了"。

⚠️⚠️ **第二次更正**（Codex 复审第二轮 P1，同样核实成立）。上一版说"补两处接线就行"，其中 **`draft-and-gate` 那一处不是接线，是接不上** —— 逐行核对：

- `ad-publisher.ts:120-148` 的 `creativeSpec()` 用 `object_story_spec`（`link_data` / `video_data` + `image_hash` / `video_id`）建**全新创意**。这条路径下**根本不存在帖子**，所以没有 `postId` 可传；
- 而 `linkAdToCreative` 的 `postId` 是**必填**（`creative-link.ts:175`），且 `loadPublishedCandidates` 只从 `content_work_orders.published_ref.post_id` 找候选；
- `draft-listing/route.ts:238` 手里**确实握着 ME 的素材身份**（`client_assets.id`），但它没被带进 `AdDraftCreative` —— 那个类型只有 `imageHash` / `videoId`，到了 publisher 就只剩 Meta 的 hash 了；
- `CreativeSource` 是封闭 union，目前只有 `'content_work_order'`，**`client_assets` 连表示都表示不了**；
- **最硬的一条**：`ad_creative_links.post_id` 在 migration 里是 `text NOT NULL`。**draft 建出来的广告今天在这张表里根本存不下。**

所以正确的拆法是把 ① 拆成两半，成本完全不同：

**①a — 真·小活，先做（不需要 migration）**

把 `play` / `playSource` 传给已有的两个调用点：`boost-post/route.ts:122` 固定 `'boost_organic_post'`、`winner-reel-sync/engine.ts:214` 固定 `'thruplay_pool_build'`，`playSource` 都是 `'declared_at_creation'`。`LinkAdToCreativeArgs` 和 `persistLink` 早就支持这三列，纯粹是调用方没传。

~~首条 ME 自建广告走 `boost-post` 路径~~ ⚠️⚠️⚠️ **第三次更正 —— 这条建议已撤回**（Codex 复审第三轮 P1，核实成立）。

上一版说"boost 路径有 postId，所以让首条广告走它"。**只看了记账那一面，没看它怎么花钱。** 核对 `src/lib/meta/client.ts:665-750` 的 `boostPagePost`：

```
campaign  objective: 'REACH',  status: 'ACTIVE'          ← 直接开
ad set    geo_locations: { countries: ['AU', 'NZ'] },     ← 写死
          status: 'ACTIVE'
ad        status: 'ACTIVE'
```

而且 `boost-post` 路由**不经过** `draft-and-gate` 的 `PAUSED → 回读 → 人点头`。所以照上一版执行会同时踩三条本审计自己列出来的坑：

1. **建成即花钱、无人点头** —— 直接违反本仓「没有任何一条路径能让 ME 自己让广告开始花钱」这条规矩（`ad-draft.ts` / `draft-and-gate.ts` 头部都写着）；
2. **把 CTS（NZ 客户）的广告投到澳洲** —— `geo_locations` 写死 `['AU','NZ']`。§3.1 里那条 `geo_mismatch` blocker，正是为这一类错误存在的（2026-08-04 Roman 把北岸的房投给全新西兰）；
3. **objective 写死 `REACH`，而这条广告的目的是"验证归因链路通不通"** —— 触达类目标的 `results` 恒为 0（`ads-expected-metric.ts:165-171`，这是对的、不是失败），但**首条广告要证明的恰恰是"这条片子带来了哪个客户"**，用一个结构上产不出 lead 的目标去验证，就算 `creative_ref` 记上了也验不到链路的下半截。（注意：这是"目标与本次目的不匹配"，**不是**"REACH/THRUPLAY 是坏目标"—— 见 §3.5。）

**真实结论：今天没有任何一条路径同时满足「安全」和「记得下来」。**

| 路径 | 安全（暂停→回读→人点头） | 记得下 creative_ref |
|---|---|---|
| `boost-post` | ❌ 直接 ACTIVE + 写死 AU/NZ + REACH | ✅ 有 postId |
| `draft-and-gate` | ✅ 闸门齐全 | ❌ 存不下（见上文 NOT NULL） |

所以"投第一条 ME 自建广告"**不是可以马上做的事**，它有前置，二选一：

- **(i) 先修 boost 路径**：`boostPagePost` 改成建 `PAUSED`、地区从客户配置取（不写死）、接进 `PAUSED → readback → approval` 闸门。不需要 migration，但也不是接线，是改一个正在被引用的函数 + 补闸门接入。
- **(ii) 先做 ①b**：让安全的那条路径也能记账（要 migration，见下）。

在 (i) 或 (ii) 落地之前，**①a 只是把 `play` 传上、等下次真有广告被建时能记上**，它本身不产生第一条记录。

**①b — 需要 PM 拍板的一块（含 migration）**

要让 `draft-and-gate` 那条路径也能记账，缺的是「**每条 creative 的素材身份贯穿到发布结果**」这件事本身，不是一次函数调用：

1. **给每条 creative variant 一个自己的稳定身份** —— 这一点前后被更正了两轮，最终结论是：**`creative_ref` 记的必须是"这条广告说了什么"，不是"它用了哪张图"**。

   两轮更正的过程（都是 Codex 抓到、核实成立，写在这里因为中间那版看着很像对的）：

   - **第一版**（错）：把 `assetIds` 数组透传给每条 creative。错在 `draft-listing/route.ts:250-264` 会把素材**全部上传**，但紧接着是
     ```ts
     if (up.asset.kind === 'image') opts.imageHash ??= up.asset.hash
     else                            opts.videoId  ??= up.asset.videoId
     ```
     `??=` → **每种类型只有第一张真正进广告**，其余上传了没投。整个数组挂上去 = 把没投出去的素材也算进归因。
   - **第二版**（仍错，且更隐蔽）：改成"保留精确的 `imageHash` / `videoId → client_assets.id` 映射，每条 creative 只写实际用到的那个素材 id"。看着严谨，但**放到 ③ 的场景里直接失效**：5–8 个角度**共用同一张图**是常态（这正是"用文案找人"的打法），于是 publisher 建出来的 5–8 条 `primaryText` / `headline` 各不相同的广告，会**全部写同一个 `creative_ref`**。之后 `contacts.attr_creative_ref` 和赢家学习只能分辨"用了哪张图"，**照样不知道哪个角度带来了客户** —— 而角度归因恰恰是 ③ 的全部目的。等于绕一圈回到原点。
   - **最终**：身份的粒度必须是 **creative variant**（角度 + 文案 + 素材的那一整份），不是原始素材。具体：
     - 给每条 variant 一个稳定 id（ME 侧的记录，含 angle、primaryText、headline、以及它用了哪个 `client_assets.id`）；
     - **素材关系另存**（variant → asset，一对一或一对多都可表达，轮播天然是多）；
     - `ad_creative_links` 按 `adId → variantId` 绑定 —— 而 `publishDraftPaused` 的 `for (const c of d.creatives)` 循环里，adId 和 variant 的对应关系本来就在手上（第 2 点）。

   **一句话：别把素材 id 当创意 id。** 这也意味着 `CreativeSource` 那个封闭 union 要加的不是 `'client_asset'`，而是 variant 这一层；
2. `publishDraftPaused` 的返回值把 `adId` 和它对应的那条 creative 关联起来（它本来就是 `for (const c of d.creatives)` 循环建的，映射天然存在，只是现在丢了）；
3. **migration**：`ad_creative_links.post_id` 放开 NOT NULL；`creative_source` 加的是 **variant 这一层**（不是 `'client_asset'` —— 理由见第 1 点）；variant 本身要有落脚的地方（新表或复用现有工单表，属技术选型，自己拍）；并给 `linkAdToCreative` 加一个不依赖 `postId` 的直接持久化入口（`adId → variantId`）;
4. 然后才轮到 `AdCreationPath` 加 `'me_ad_launch'`。

⚠️ **授权边界更正**（Codex 复审第四轮 P2，核实成立）：上一版写成"migration 要 PM 拍板，所以 ①b 不能自己拍板开工"，**把两件事混在一起了**。

CLAUDE.md 铁律 2 的原文是：技术决策自己拍 + 召 agent 复审，**不上抛 PM**；「把技术选择题塞回 PM = 失职」。唯一例外是**不可逆操作**必须 PM 显式 `go` —— 列举的是 `gh pr merge` / `apply_migration` / `git push --force` / 删客户数据。

所以准确的边界是：

- **设计、写 migration 文件、改代码、走 2 审 —— 全部自己拍，不问 PM。** 按上一版那句话执行，等于在设计阶段就把技术选择题上抛，正是铁律 2 说的失职。
- **只有对生产库执行 `apply_migration` 那一下需要 PM 显式 `go apply`。**

①b 因此**现在就可以开工**，只是最后一步落库前停下来等一句话。

> 这一步（至少 ①a）没做之前，后面所有"学习"都是在空表上做设计。

### ② 把 `ad-publisher.ts:116` 的 Advantage+ 默认值按打法分开

现在改的成本是 **0**（那条路径还没建过任何广告）；等它开始建广告再改，就是在真钱上改。

⚠️ **初稿这里也写岔了一点**（Codex 复审 P2，核实成立）。原稿列了一张含 `warm_pool_retarget` / `reach_awareness` 的打法表，但 `ad-draft.ts:23` 的 `DraftKind` **目前只有两种**：

```ts
export type DraftKind = 'lead_form' | 'video_thruplay'
export const DRAFT_PLAY = { lead_form: 'lead_form_harvest', video_thruplay: 'thruplay_pool_build' }
```

`warm_pool_retarget` / `reach_awareness` **根本走不到 `targetingFor`**，为它们写规则等于写了不会执行的分支。而且 `targetingFor(d: AdDraft)` 拿到的是 `d.kind`，不是打法。

所以本次的准确范围是：

- **现存这两种草案（`lead_form` / `video_thruplay`）都是冷投，两个都改成 `advantage_audience: 1`。** 这就是全部改动 —— 不是"按打法分开"，是"把仅有的两种冷投打开"。
- **重定向的保护写成注释 + 一条测试留在原地**：等将来真的加 `warm_pool_retarget` 这种 `DraftKind` 时，它必须显式关闭扩量。现在没有这个 kind，写不出这个分支。
- `launch-readback` 的 `retargeting_advantage_audience` blocker **保留原样** —— 它只在 `claimsRetargeting` 时触发，不会误伤这两种冷投草案。

> 这是**唯一一处 ME 代码与 Andromeda 逻辑正面冲突**的地方，改动本身仍然只有一行。

### ③ 一个草案出 5–8 条不同角度的创意，投进同一个 ad set

`AdDraft.creatives` 已经是数组，`ad-publisher.ts:215` 已经在循环建创意 —— **管道已经支持多条，只有 `listing-draft-builder` 硬写了单条。**

⚠️ **但这一条不是"零开发"**（Codex 复审 P2，核实成立；初稿把它写成了接线活，低估了）。核对结果：

- `copy-generator.ts` 的 `hookIntentFor(metric)` / `ctaIntentFor(metric)` 是 **switch，按一个北极星指标返回一句固定的战略意图提示语**，不是角度生成器；
- `strategist.ts:178` 的 `pickAngle(ctx, winner)` 从已有的 `content_pillars` / `core_proposition` 里**挑第一个没被拦截的角度**，返回单个 `AnglePick`，一次只产出一条工单。

所以"把这些函数接上"不会得到 5–8 条角度。真正缺的是一个**批量角度选择/生成 + 去重 + 逐条溯源**的编排层：既要出多条，又要每条都受本仓已有的两道约束管住（`listing-draft-builder` 的事实可溯 + `scanRedlineHits` 禁用词硬闸）。这是**新增开发**，不是接线 —— 按半周到一周估，别按零估。

管道那一半（`AdDraft.creatives` 数组 + publisher 循环建）确实是白拿的，省掉的只是"怎么把多条创意发出去"，不是"多条创意从哪来"。

出多条之后**塞进同一个 ad set 让 Meta 自己分配**，而不是把角度拆到多个 ad set。

⚠️ **但"合并"只能在同一种语言内做**（Codex 复审第三轮 P1，核实成立；上一版只给私信广告留了例外，漏了表单广告）：

`ad-publisher.ts:142` 的 `lead_gen_form_id: d.leadFormId` 是**草案级的**，`creativeSpec(d, c)` 对草案里每条 creative 都复用同一个表单 id。所以一个 `lead_form` 草案里放中英两种角度 → **两种语言的买家点进去看到的是同一种语言的表单**。

而这个错**没有任何闸门拦得住**：`launch-readback.ts:192` 的混语言检查包在 `if (isMessagingAdSet(adSet))` 里，只管私信类；而 `lead_form` 的三件套是 `OUTCOME_LEADS` / `LEAD_GENERATION` / `ON_AD`，判定为非私信 → 直接放行。这是**私信那次事故（2026-08-04 得罪 5 个买家）的表单版，只是还没发生过**。

所以本条的准确表述是：

- **角度合并的边界是"同一语言"，不是"同一草案类型"** —— 5–8 个角度全部同语言，投一个 ad set；要做另一种语言就是另一份草案 + 另一个表单。
- 要真正做到"跨语言也能合并"，前置是把**表单身份下沉到每条 creative**（`AdDraftCreative` 带自己的 `leadFormId`）**并给表单广告补一条混合语言闸门** —— 这是 ③ 之外的额外一项，别顺手默认它已经有了。

其余两条约束不变：
- 私信类广告一个 ad set 一种语言（`mixed_script_messaging_adset` 闸门，2026-08-04 那次）；
- **目标按实验目的选，不要一刀切**（Codex 复审第六轮 P1 更正 —— 上一版写死「必须跑 `LEAD_GENERATION` / `CONVERSATIONS`，不要再跑 THRUPLAY」，那会把合法的攒池实验废掉）：
  - 问题是「**哪个角度直接带来生意**」→ 用 `LEAD_GENERATION` / `CONVERSATIONS`；
  - 问题是「**哪个 hook 最便宜地让人看完 / 最快把池子做大**」→ `THRUPLAY` 就是对的目标，`results = 0` 是设计如此，不是失败（`play-vocabulary.ts:55-62`）。
  - **前置**：选后者之前，先做 ROADMAP `P21.K.8` 把完播次数 / 单次完播成本 / 池子增长采进 `ad_daily_insights` —— 否则又是一次"跑对了目标、ME 读不出结论"（§3.5）。

**不建议现在做的**：重构 winner 判定、建"意图 → 角度"模型、把 `ad-level-breakdown` 改成会宣布赢家。这三件事都要有真实的 creative 级数据才能设计，而那些数据要等 ①a / ①b 跑起来才有。

**建议的执行顺序**（经三轮更正后的版本）：

0. **补读 Oztop + Roman 两个账户的 targeting** —— 必须在**有 `META_SYSTEM_USER_TOKEN` 的环境**里直调 Graph（本次审计环境没有该 token，MCP 那条路 Oztop 被 Meta 拒绝、Roman 的 `act_1018365291238494` 返回 `is_queryable: false`，都实测过，见附录 1）。活不大，但**它决定"投放侧已经做对了"这个判断能不能覆盖另外 52.3% 的花费** —— 现在这条结论的证据只覆盖 CTS 一家、47.7%；
1. **①a** 传 `play` —— 小活，今天就能做，但它本身不产生第一条记录；
2. **②** `ad-publisher.ts:116` 改 `advantage_audience: 1` —— 一行，现在改成本为 0；
3. **在 ①(i) 修 boost 路径 与 ①(ii)/①b 让 draft 路径能记账 之间二选一** —— 这是「投出第一条 ME 自建广告」的真正前置。两个选项的设计与编码都自己拍板，选 (ii) 时只在最后对生产库 `apply_migration` 那一下停下来等 PM 一句 `go apply`；
4. 前置落地后，**投第一条真广告**；
5. **③** 批量角度（半周到一周），外加"表单身份下沉 + 表单混语言闸门"若要跨语言合并；
6. 若要做**攒池型**角度测试（视频 hook 筛选），先落 ROADMAP **`P21.K.8`**（完播次数 / 单次完播成本 / 池子增长入 `ad_daily_insights`）—— 否则又一次"跑对了目标、ME 读不出结论"（§3.5）。

> ⚠️ 这一节被更正了三轮（每轮都是 Codex 抓到、逐行核对后成立）。三次错误有同一个形状：**看见"表已经建好 / 函数已经存在"就推断"接上就能用"，而没有核对它到底怎么被调用、怎么花钱、字段是哪一级的**。这正是本审计在 §5 批评系统的那件事，作者本人连犯三次 —— 记在这里，因为下一个照这份文档动手的人最可能踩的就是同一个坑。

---

## 8. Final answer to Product Owner（大白话）

**我们走在对的路上，但现在真正在跑的那一半，是人做的，不是系统做的。**

三件事说清楚：

1. **广告投给谁这件事，在我们看得到的那部分账户里，已经做对了。** CTS 和 Roman 这两个账户的花费里，接近九成没有做"人群精挑细选"，而是把范围放宽、让平台自己去找人 —— 这正是现在 Facebook 后台最吃香的做法。这部分不用改。

  ⚠️ 但**这句话只覆盖不到一半的钱**：真正查过的只有 CTS 一家（$3,733，占 47.7%）。Oztop（46.1%）和 Roman（6.1%）的广告账户 Facebook 那边都读不了，**这两家一眼都没看到**，合计 52.3% 的花费没有证据。

  所以准确说法是「**查过的那 48% 做对了**」，不是「我们做对了」。而且连"48% 里有多大比例是 broad"我们也没算 —— 能说的只是"查到的 26 组广告里有 23 组开着自动扩量"，**那是组数，不是钱数**。想把这句话说全，得先补读另外两个账户。

2. **广告"说什么"这件事，我们还在用老办法。** 钱最多的三条广告，加起来只有 4 条不同的片子；而我们真正试过十几个不同说法的那两次，一次花了 $432、一次花了 $366 —— **两次都没能得出结论，但原因不一样**：Oztop 那次（$432）**方法是对的**，是我们的系统没把该看的数（多少人把片子看完、看完一次多少钱）收进来，所以现在读不出谁赢；Roman 那次（$366）是钱太少，十几条片子分下去每条只有二十几块，谁赢基本靠运气。

  **说白了：我们把所有钱押在少数几条片子上，同时用零花钱去做真正该做的测试 —— 这个次序反了；而且就算测了，有一类测试我们的系统还读不懂。**

3. **最关键的一环还没通电：我们至今说不清哪一条片子带来了哪一个客户。** 39 个已经追到"哪条广告"的客户里，**没有一个**能追到"哪条片子"。记这件事的表已经建好，但**记录这件事的几段路只各修了一段、还没接到一起**。

  更麻烦的是：**今天两条路各缺一半，没有一条能马上用。**

  - 一条路（给已发出的帖子投流）**记得住**是哪条片子，但它建出来的广告**立刻就开始花钱、没有人点头那一关，而且投放地区写死了澳洲+新西兰** —— 拿它投 CTS 会把新西兰客户的广告投到澳洲去。这条路要先修。
  - 另一条路（ME 从素材直接起草一条新广告）**该有的把关都有**（先建成暂停、回读一遍、你点头才开），但它**记不下来**是哪条片子 —— 要记得下来得改一次数据库结构。**这个不用等你**：写代码、写改动方案、找人复审都由我们自己推进，**只有最后真正动生产数据库那一下需要你回一句「go apply」**。

  所以「让 ME 投出第一条广告」不是今天就能做的事，得先在这两条路里挑一条补齐。（为什么非要在建广告那一刻记：只有那一刻知道对应关系，事后问 Facebook 是问不出来的。）

**如果按现在的方向继续做，Magic Engine 在 Meta 广告上真正能形成的竞争优势是这个：**

> 我们已经有客户真实的产品、真实的素材、真实的官网事实，也已经有一台能批量出片、且**结构上编不出假话**的机器。别人做批量创意测试，最大的成本是"想不出这么多说法"和"怕AI瞎编惹祸"；我们两个都已经解决了。
>
> 所以我们能做到的是：**一次投十几条真正不同说法的广告，让平台自己去找哪种人吃哪一套，两周内告诉客户"你的生意真正打动人的是哪句话"，然后照着那句话再生成下一批。** 这个能力代理公司做不了（他们出不起十几条片子的人工），普通自助工具也做不了（他们不认识客户的真实产品）。
>
> **但这条护城河成立的前提，是"哪条片子带来哪个客户"这条线必须真的通。现在它是断的。**
>
> 接通它的活分三档，别按同一个价钱估：**真小活只有一件**（今天就能做，但它自己不产生第一条记录）；**中间那件是"补齐两条路里的一条"**，其中一个选项要改数据库结构 —— 代码和方案我们自己推进，只在最后动生产库前问你一句；**最后那件（一次出十几个不同说法）是要真写新东西的**，半周到一周，别按"接个线就好"估。
>
> 顺序上先做小活和那一行开关，再补路，最后才做批量出说法 —— 因为最后那件做出来的东西，如果前面没通，照样不知道哪个说法赢了。
>
> 另外提前说一句：这份报告的"下一步"部分被外部复审连改了三轮，每一轮都是我把"东西已经写好了"当成了"接上就能用"。**所以真到动手那天，别拿这份文档当施工图，先照着它标的文件行号自己核一遍。**

---

## 附：数据不足、无法下结论的地方（不猜）

1. **Oztop 账户（$3,608.27，占总花费 46.1%）的 targeting 这次读不到** —— 本审计内**两条路都实测过，都不通**：
   - Meta MCP：`This ad account is not enabled for the Ads MCP. Ad account ID: 1735240120460765`（`is_ads_mcp_enabled: false`，Meta 尚未放量）
   - 直调 Graph：**本次审计环境没有 `META_SYSTEM_USER_TOKEN`**（仓库里只有 `.env.example`）

   它的 campaign 叫 `Cold Broad`，但名字不算证据（本仓 `play-vocabulary.ts` 自己写过"最花钱那条名字零信息量"）。补完最终判断的办法：**在有该 token 的环境里**跑 `GET /act_1735240120460765/adsets?fields=targeting,name,status,optimization_goal`。**这不是"再试一次就好"，是必须换环境。**
2. **`ad_daily_insights` 里没有 ad set 这一层** —— `level='ad'` 行的 `parent_id` 存的是 campaign（`ad-level-breakdown.ts` 头部注释明确说过，两个 agent 都误读过）。所以"一个 audience 是否被拆成很多 ad set"只能从 Meta live 侧回答（CTS：26 个 ad set / 17 个 campaign），库里答不了。
3. **创意的 angle 标签没有落库** —— 角度信息只存在于广告名字里（`OZ-S2-R6-kidsdog`），`ad_creative_links.play_context` 本来就是放这个的字段，但表是空的。所以"角度 A 比角度 B 好"这类问题现在只能靠人读名字，系统答不了。
