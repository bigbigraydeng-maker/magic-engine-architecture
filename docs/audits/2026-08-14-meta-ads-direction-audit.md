# Magic Engine Meta Ads Direction Audit — Andromeda-era 对照

**日期**：2026-08-14 · **性质**：只读审计，未改任何生产代码
**证据来源**：仓库 main 实现 · Supabase `ad_daily_insights` / `ad_creative_links` / `winner_structures` / `flywheel_actions` 等真实表 · Meta Graph 实时回读（CTS 账户 `2775766642787274`，26 个 ad set 的 live targeting）

---

## 1. Verdict

## 🟡 YELLOW — 方向正确，但实现仍偏传统

四句话：

1. **投放侧（delivery）实际上已经在 Andromeda 打法上** —— 但这个结论**只覆盖 CTS 一家、总花费的 47.7%**（$3,733.59 / $7,822.57）：把混账户按 `campaign_id` 归属后，CTS 已追踪的 6 组 ad set **一个兴趣定向都没有**，73.6% 的花费明确开着 `advantage_audience: 1`（唯一关掉的是重定向组，那本来就该关）。**Oztop（46.1%）和 Roman（6.1%）的账户都查不到 targeting**，合计 52.3% 的花费无证据（见 §3.1 与附录 1）。
2. **但那不是 ME 做的** —— 是人在 Ads Manager 里点出来的。ME 自己唯一的建广告代码 `ad-publisher.ts:116` 写死 `targeting_automation: { advantage_audience: 0 }`，即**主动关掉** Advantage+ 受众。这条代码路径至今建过 0 条广告，所以冲突还是潜在的，不是已发生的。
3. **创意侧是真正传统的那一半**（按客户分开看，避开混币种）：**CTS 80.7% 的钱压在 2 条创意上**；**Oztop 63.4% 压在 1 条上**；而两次真多角度测试分别只拿到该客户的 **12.0%**（Oztop 13 条 hook）和摊薄到每条 $24（Roman 15 条 angle）。**创意多样性只发生在没钱的地方。**
4. **闭环没有通电**：`ad_creative_links` 0 行、`contacts.attr_creative_ref` 0 行（39 条已归因 lead 无一条能说清是哪条素材）、`winner_structures` 0 行、`variant_from_winner` 工单 0 条、`flywheel_actions` 里 `ads.create_ad` 0 条。**数据结构全都建好了，一个都没被写过。**

不是 RED，因为架构没有和 Andromeda 打架 —— 该有的表、该有的 ad 级日度数据（376 行）、该有的角度生成器都已经存在。不是 GREEN，因为**从"发现赢家"到"生成下一轮"这半圈，一次都没有真实跑通过**。

---

## 2. Current Reality — 我们目前实际上是怎么投广告的

真实流程（2026-06-21 ~ 2026-08-13，17 条 campaign，56 条广告，合计 **$7,822.57 ⚠️ 混币种**）：

> ⚠️ **计量口径警告 —— 全文所有跨客户金额都是混币种的**（Codex 复审第十二轮 P2，核实成立）。
>
> `ad_daily_insights`（migration `20260721000001`）只有一个裸的 `spend NUMERIC` 列，**没有币种列**；`parseDailyMetrics` 把 Graph 返回的**账户币种金额原样存下**，不做任何换算。而 CTS / Roman 的账户是 **NZD**（live 回读返回 `NZ$`），Oztop 是 **AUD**（`boost-post` 路由的入参就叫 `daily_budget_aud`）。
>
> **所以 `$7,822.57` 是 NZD + AUD 直接相加的结果**，由它派生的一切跨客户比例（47.7% 覆盖率、46.1% Oztop 占比、创意集中度等）都**没有共同单位**。NZD/AUD 汇率接近 1（约 1.08–1.10），所以这些比例作为**数量级判断**仍然可用，但**不能当精确数字引用**，也不该拿去做客户间预算比较。
>
> 因此本审计**凡是能在单一客户内部说清的结论，一律改成按客户分开说**（见 §3.3）。要得到真正可加总的口径，需要给 `ad_daily_insights` 加币种列 + 按基准日折算 —— 这是本审计发现的一个新缺口，**ROADMAP 里没有登记过**。

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

Meta Graph 实时读账户 `act_2775766642787274`，共 26 个 ad set。

⚠️ **但这 26 组不全是 CTS 的**（Codex 复审第八轮 P2，核实成立）。该账户是本仓记录在案的**混账户**，第 66 行早就承认了这一点，前几版却仍拿 26 组的统计去描述 CTS —— 自相矛盾。

已按 `campaign_id` 把每一组归回客户（对照 ME 库里 CTS 的 6 条 campaign id）：

| | 组数 | Meta 侧花费 |
|---|---|---|
| 属于 CTS **已追踪的 campaign** | **6** | **$3,787.76** |
| 其余（Oztop 投流 + 未被 ME 追踪的 CTS boost） | 20 | $1,278.76 |

**下面所有 targeting 结论，只统计那 6 组：**

| 事实（仅 CTS 已追踪的 6 组） | 组数 | 花费占比 |
|---|---|---|
| **带兴趣/行为定向** | **0 / 6** | **$0.00 · 0.0%** |
| `advantage_audience = 1` | 4 / 6 | $2,787.73 · **73.6%** |
| `advantage_audience = 0` | 1 / 6（`Retargeting - VideoViewers + FormOpeners`）| $807.37 · 21.3% |
| 字段缺失（Meta 未返回） | 1 / 6（`CTS - WA CTWA - Video 50% - Warm`）| $192.66 · 5.1% |

逐组明细：

```
  2251.80  aa=1  interests=0   Reborn-Winner-Stand-in-Front-20260624
   807.37  aa=0  interests=0   Retargeting - VideoViewers + FormOpeners   ← 重定向组关掉扩量，这是对的
   269.07  aa=1  interests=0   Post: "🐦 Even our Kiwi knows — Shanghai…"
   232.62  aa=1  interests=0   ThruPlay - NZ - Reels
   192.66  aa=?  interests=0   CTS - WA CTWA - Video 50% - Warm
    34.24  aa=1  interests=0   Post: "Each of the 8,000 Terracotta Warriors…"
```

**这个口径下结论反而更强**：CTS 已追踪的这 6 组**一个兴趣定向都没有**（不是"只剩 12.5%"），73.6% 的花费明确开着 Advantage+ 受众，唯一关掉的那组是重定向组 —— 而重定向组本来就该关（`launch-readback.ts` 那条 blocker 正是为它写的）。

> 📌 之前几版引用的 `12.5%`（$635.63 / $5,066.52）**已作废**：那是 26 组混账户的合计，8 个带兴趣定向的组**全部落在那 20 组"其余"里**，跟 CTS 已追踪的花费无关。

> 🔢 **覆盖率要用同一个分母算**（Codex 复审第五轮 P2 起，经第七、八轮才收敛）。
>
> `act_2775766642787274` 是本仓记录在案的**混账户** —— `docs/strategy/meta-flywheel-risk-and-sequencing.md`（2026-06-06）写明「所有 boost 都在这里，CTS 旅游帖 + Oztop flooring 帖混跑」。所以它的账户级合计 `$5,066.52` **既混客户又混币种，不能当任何分母**（上面已改成按 `campaign_id` 归属后再统计）。
>
> 覆盖率的分母用 ME 库 `ad_daily_insights` 的 campaign 级花费（§2 的 $7,822.57）：
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
> **所以本审计关于 broad / Advantage+ 的结论，证据只覆盖 CTS 一家、总花费的 47.7%。**
>
> 两侧口径的小差额是正常的：ME 库记 CTS 这 6 条 campaign 为 `$3,733.59`，Meta 侧同 6 组回读为 `$3,787.76`（差 1.4%，来自归因回填与取数时点）。**覆盖率一律用 ME 库那个数**（跟 §2 同源）；**targeting 的花费加权比例用 Meta 侧那个数**（跟 targeting 同源）。两者不混用。
>
> ⚠️ **作废的旧说法**（前几版出现过，别再引用）：`23 / 26`（混了 20 组非 CTS 的组，且是条数比不是花费比）、`12.5%`（分母是混账户合计）、`53.9% 已回读`（错把 Roman 算成已读）。

最大那条：

```
Reborn-Winner-Stand-in-Front-20260624
  optimization_goal = LEAD_GENERATION
  spend  NZ$2,251.80   results 219
  targeting = { age 18-65, geo NZ, 无兴趣, 无 custom audience,
                targeting_automation: { advantage_audience: 1 } }
```

另外读到一条名为 `North Shore 15km · Message Leads · 4-Creative Race` 的 ad set，带 `targeting_optimization: "expansion_all"` + `advantage_audience: 1`，形态上正是 Andromeda 想要的。**但它 `status: PAUSED`、花费 `$0.00`，且不在 Roman 那 $480.71 所在的账户里 —— 只能当"有人这么设过"的旁证，不能算 Roman 的投放证据。**

> ⚠️ **未回读的两家（合计 52.3% 花费）**：
> - **Oztop**（$3,608.27，46.1%）：账户 `1735240120460765` 的 `is_ads_mcp_enabled = false`（Meta 尚未放量）。campaign 名字叫 `Cold Broad`，但名字不算证据 —— `play-vocabulary.ts` 自己写过"最花钱那条名字零信息量"。
> - **Roman**（$480.71，6.1%）：花费所在的 `act_1018365291238494` 返回 `is_queryable: false`（状态 UNSETTLED）。
>
> **所以"broad / Advantage+"这个结论目前只对 CTS 一家成立**，Oztop 和 Roman 两侧都是 inference。
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

**按客户分开算**（第十二轮更正 —— 上一版把三个客户的钱加在一起算占比，而那是 NZD + AUD 混加，见 §2 的口径警告。分开算之后每个数都在单一币种内，结论反而更硬）：

**CTS（NZD，总 $3,733.59）**

| Campaign | 创意数 | 花费 | 结果 | 占该客户 |
|---|---|---|---|---|
| `CTS — Lead Form — Reborn — 20260624` | **1** | $2,231.59 | 429 | 59.8% |
| `CTS - Retargeting - Warm - 20260707` | **1** | $780.32 | 215 | 20.9% |
| `CTS - ThruPlay Reels - Pool builder` | 6 | $232.62 | 0 | 6.2% |

→ **CTS 八成的钱（80.7%）压在 2 条创意上。**

**Oztop（AUD，总 $3,608.27）**

| Campaign | 创意数 | 花费 | 结果 | 占该客户 |
|---|---|---|---|---|
| `Oztop — Lead Form — Cold Broad — 20260709` | **2**（97.6% 在一条上） | $2,288.52 | 78 | 63.4% |
| `OZ-THRU-S1-hooktest-202607` | **13** | $432.50 | 0 | 12.0% |

→ **Oztop 六成多的钱压在 1 条创意上；13 个角度的测试只分到 12%。**

**Roman（NZD，总 $480.71）**

| Campaign | 创意数 | 花费 | 结果 | 占该客户 |
|---|---|---|---|---|
| `30 Kiteroa · Message Leads Test` | **15** | $366.26 | 37 | 76.2% |

→ **15 条创意平均每条 $24**，多数臂拿不到可读的信号。

**三家共同的形状（不依赖跨币种加总）：钱压在 1–2 条创意上，多角度测试只分到零头。**

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
- 这件事**已经登记但没做，而且是两条不是一条**：ROADMAP `P21.K.8`（objective 感知 + 视频完播指标）补的是"看完成本"那一半；"池子涨了多少人"那一半在 `P18.E.3`（池 size 快照，依赖 `P18.E.2`）。**两条都没做，所以 `play-vocabulary.ts:55-62` 定义的成效信号一个也读不出来。**
- **而且还有第三层，连登记都没有**：即使这两条都做完，也只知道"池子整体涨了多少"，**不知道 13 个 hook 里是哪个带来的** —— `client_audience_assets` 按 `audience_id` 唯一、无创意维度，而 `videoEventRule` 本来就是把一批视频灌进同一个池。要按 hook 归因，得一 hook 一池或另建创意级增长映射（详见 §7 执行顺序第 7 步）。
- 另外钱确实高度集中：`OZ-S1-A-spill` 一条吃掉 $280.72 / $432.50（65%）—— 这一条与目标无关，是 13 个角度之间没跑成公平竞争。
- **Roman 15 条 angle 总预算只有 $366**，平均每条 $24。最贵的一条 `Ad F · 中文 · Rangitoto 学区` $111.33 拿到 21 个对话（$5.30/对话），最便宜的几条只有 $2.54–$4.82、**展示数是个位数到两位数**。在这个量级上，多数臂根本没有可读的信号 —— 这一条靠数据本身就成立，不需要功效计算。

  ⚠️ **不要拿 `$1,835` 那个数来证明这一点**（Codex 复审第八轮 P2，核实成立；前几版这么用了）。`play-vocabulary.ts:6-8` 算的是**两组对比**（中文 vs 英文，实测 1.84 倍、p ≈ 0.22）所需的样本量，那是个双臂显著性检验；而这里是 **15 个角度里挑赢家**的多臂选择问题 —— 基线转化率、各臂预算分配、多重比较修正都不一样，`$1,835` 不能平移过来。要给下一次多角度测试定预算，得**按每条变体的实际指标重做一次样本量估算**，不能引用那个数。

### 3.6 ME 自己出的草案，结构上就只能出一条创意

`src/lib/ads-strategy/listing-draft-builder.ts:193` 与 `:254`：

```ts
    creatives: [creative],     // ← 两个 builder 都是硬写单条
```

文件头还明写 **「一个草案 = 一种语言」**，两种语言 = 两份草案 = 两个 ad set。

⚠️ **但按语言拆这一条不是缺陷**（第九轮更正；初稿把它和"只能一条创意"并列成问题了）：`lead_form` 草案的所有创意共用同一个 `d.leadFormId`（`ad-publisher.ts:142`），而混语言闸门只覆盖私信广告（`launch-readback.ts:192`）—— 在现有契约下，中英创意同组必然让一半买家进到看不懂的表单，**按语言拆正是挡住这件事的边界**。

**所以本节真正的缺陷只有一个：一个草案只能出一条创意。** 同一语言内出 5–8 个角度，管道本来就支持（`AdDraft.creatives` 是数组、publisher 在循环建），是 builder 硬写死了单条。

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

⚠️ **但这只是"单角度"的基础零件，不是"批量出角度"的引擎**（Codex 复审第九轮 P2，核实成立；本节初稿写成了"整套能力已经写好"，跟 §7 ③ 的源码核对自相矛盾）。逐个核对：

| 组件 | 它实际做什么 | 是不是批量角度生成 |
|---|---|---|
| `hookIntentFor(metric)` / `ctaIntentFor(metric)` | **switch**，按一个北极星指标返回**一句固定的**战略意图提示语 | ❌ 连生成都不是，是 prompt 里的一句话 |
| `strategist.pickAngle(ctx, winner)` | 从已有 `content_pillars` / `core_proposition` 里挑**第一个**没被拦截的角度，返回单个 `AnglePick` | ❌ 一次一个 |
| `normalizeAngle` + `FACTORY_ANGLE_DEDUPE_DAYS` | 角度去重 | ⚠️ 只是零件 |
| `winner_structures` 三段骨架 | 表结构在，**0 行** | ❌ 空的 |

**准确的说法**：ME 已经有"出**一个**角度、并且不跟最近用过的重复"的能力，也有把它落成文案的品牌接地管道；**缺的是"一次出 5–8 个互不重复、各自可溯源的角度"那一层编排**，那一层现在一行都没有。而且这套零件服务的是自然内容工厂（22 条工单、1 条发布），**从来没有为广告出过一条创意**。

工期按 §7 ③ 估：**新增开发，半周到一周，不是接线。**

---

## 4. What We Are Doing Right

1. **实际投放已经是 broad + Advantage+** —— CTS 已追踪的 6 组 ad set **零兴趣定向**，73.6% 的花费开着 Advantage+ 受众，且唯一关掉的那组正好是该关的重定向组。这一条最重要，也最容易被自己低估 —— 但**证据只覆盖 CTS 一家、总花费的 47.7%**，Roman + Oztop 合计 52.3% 的账户查不到，口径见 §3.1。
2. **ad 级日度数据脊柱是真的**（376 行，每天在写，带 `parent_id`）。绝大多数同类系统只有 campaign 级 —— 没有 ad 级就永远做不了 creative-level 学习。这块地基已经打好了。
3. **不拿汇总骗自己**：`ad-level-breakdown.ts` 会在子项差异 ≥1.5 倍时明说"这个汇总在掩盖差异"，还会拦住"表单留资 + 私信对话被加在同一列"的不可比比较。这是很多投放团队都没有的纪律。
4. **建完必回读**：`launch-readback.ts` 承认"创建接口的回显不含 Meta 自己补上的东西"，强制建成暂停 → 回读 → 人点头。这在 Advantage+ 时代**更重要**，因为平台会自动加的东西只会越来越多。
5. **多角度这件事我们会做**（3.4 的 13 条 hook / 15 条 angle 是真角度，不是换色）。缺的是把它变成系统行为，不是缺能力。
6. **模板不会自行新增事实**：`listing-draft-builder` 没有自由文本入口，买家读到的每一句都是由 `ListingFacts` / `AgentFacts` 的字段拼出来的，**AI 不会凭空多写一个价格或一句战绩**；禁用词命中直接拒绝出稿（`BannedPhraseError`，不是标红让人审）。

  ⚠️ **但这不等于"编不出假话"**（Codex 复审第十轮 P1，核实成立；本条初稿写成了"结构上不可能编价格/战绩"，把安全性说大了）：

  - `draft-listing/route.ts:281` 是 `buildBuyerLeadDraft(body.listing as ListingFacts, body.agent, opts)` —— **事实直接来自请求 JSON**；
  - `listing-draft-builder.ts:105-112` 的 `assertFacts` 只检查 `sourceUrl` **非空**、地址/区域/状态非空，**从不抓那个页面核对**价格、地址或战绩；
  - 更糟的是 `traceClaims` 会把这些原样传进来的字段**盖章成「官网可溯（sourceUrl）」** —— 那个可溯标签是**没有挣来的**。

  也就是说：付费调用方只要附一个任意 URL，就能让未证实的内容进入待批准广告，并带着"官网可溯"的标记。**准确的说法是"模板不会自行新增事实"，不是"结构上编不出假话"。** 想靠它安全地批量扩量（§7 ③），前置是补一道**真实的来源校验**（按 `sourceUrl` 抓页面、核对关键字段，或只接受来自 ME 自己已核实数据源的事实）。

---

## 5. What Is Still Wrong

| # | 问题 | 证据 |
|---|---|---|
| 1 | **ME 自己的建广告代码默认关掉 Advantage+ 受众** | `ad-publisher.ts:116` `advantage_audience: 0`，无差别 |
| 2 | **钱全压在单条创意上** | CTS 80.7% 的花费在 2 条创意上；Oztop 63.4% 在 1 条上（各自单一币种口径，见 §3.3）|
| 3 | **视频/攒池类实验该看的指标 ME 一个都没采** —— 目标本身是对的，读不出结论是我们的问题 | `ad_daily_insights` 无完播次数 / 单次完播成本 / `video_p100` / 池子增长；13 条 hook 的 $432.50 在 ME 里只读得出「0 结果」，而那个数按 `ads-expected-metric.ts:108-123` 本就不该用来判好坏。ROADMAP `P21.K.8` 已登记未做 |
| 4 | **多角度测试的预算不足以出结论** | Roman 15 条 / $366，平均每条 $24，多数臂展示数只有个位数到两位数（⚠️ 不引用 `$1,835`，那是双臂检验的数，见 §3.5）|
| 5 | **ME 出的草案结构上只能有一条创意** | `listing-draft-builder.ts:193,254` 硬写 `creatives: [creative]`。<br>⚠️ **"按语言拆 ad set"不算问题**（第九轮更正）：`lead_form` 草案的所有创意共用同一个 `d.leadFormId`（`ad-publisher.ts:142`），而混语言闸门只管私信广告（`launch-readback.ts:192`）—— 所以在现有契约下，**按语言拆是必要的安全边界，不是缺陷**。要改成能合并，前置是表单身份下沉到每条 creative + 补表单广告的混语言闸门（见 §7 ③）|
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
| Broad / Advantage+ delivery | **DONE（人工，仅 CTS 已验证）/ CONFLICT（ME 代码）** | CTS 6 组零兴趣定向、73.6% 花费开着 Advantage+；但 `ad-publisher.ts:116` 写死关闭。Roman/Oztop（52.3% 花费）未验证 |
| Performance ingestion | **DONE** | `ad_daily_insights` campaign 201 行 + ad 376 行，日 cron |
| Creative-level attribution | **MISSING** | `ad_creative_links` 0 行 / `attr_creative_ref` 0 行。素材归因写入方已接线但从未触发；`ads.create_ad` 那条路径**根本不调它**（见 §3.7 注）|
| Winning-angle detection | **PARTIAL** | 有 divergence 检测但拒绝下结论；winner 判定用的是自然互动分；**且视频/攒池类实验该看的指标根本没入库** —— 完播成本在 `P21.K.8`、池子净增在 `P18.E.3`，**两条都未做**，那类角度测试在 ME 里天然判不了 |
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

  ⚠️ **而且这三样还不够**（Codex 复审第八轮 P1，核实成立）：`boost-post/route.ts` 的 `post_id` / `page_id` **直接取自请求体**，服务端只从 `clients` 表取 `meta_ad_account_id`，**从不校验这个帖子/主页是不是这个客户的**。放在混账户 `act_2775766642787274` 上（CTS 与 Oztop 同账户），一个有 CTS 权限的调用方**可以提交 Oztop 的帖子**，过完闸门就把别家的素材投进共享账户、烧到共享账户的钱上 —— 这正是 `docs/strategy/meta-flywheel-risk-and-sequencing.md` §2.4 狄仁杰记的 R5 写越权，那份文档已经要求写操作前加实体归属守卫。

  所以方案 (i) 的完整前置是**四样**：建 `PAUSED` · 地区取自客户 · 接闸门 · **`page/post → client` 归属校验**（或干脆先做账户拆分，那才是根治 —— 同一份文档 §2.1 子牙的结论就是"最省的根治不是写白名单代码，而是账户治理"）。

  ⚠️ **但即使这四样全补上，方案 (i) 也验不了闭环的下半截**（Codex 复审第十一轮 P1，核实成立）：那四样都不改 `objective`，`boostPagePost` 依然是 `REACH` —— 而本节上面第 3 点自己就写了，触达类目标的 `results` 恒为 0。**没有 lead，就没有 `contacts.attr_ad_id` → `attr_creative_ref` 那一跳可验。**

  所以方案 (i) 的能力上限要说清楚：**它只能验证"上半截"（`adId → creative` 记账写没写对），验不了"下半截"（某个客户是被哪条创意带来的）**。要让 boost 路径也能验下半截，等于还得换成能产 lead 的目标 + 配套的创意契约（表单或落地页）—— 那基本就是把它重做成 `draft-and-gate` 了。

- **(ii) 先做 ①b**：让安全的那条路径也能记账（要 migration，见下）。它天然带 `lead_form` 打法（`OUTCOME_LEADS` / `LEAD_GENERATION`），**是唯一能端到端验完整条链路的路径**。

  ⚠️ **但"那条路径"必须特指 `draft-listing`，不是通用的 `meta-ads/draft`**（Codex 复审第十二轮 P1，核实成立）。两个入口的租户守卫**差别很大**：

  | | `draft-listing/route.ts` | `meta-ads/draft/route.ts` |
  |---|---|---|
  | 素材 | 收 `assetIds`，回 `client_assets` 按 `client_id` + `id` 查（route:200-204），**拿不到就报错**；明确拒收裸 `imageHash` | `...(body as AdDraft)` 整体展开，`imageHash` / `videoId` **原样来自请求体** |
  | 表单 | 列该客户的表单再 `pickForm` 选 | `leadFormId` **原样来自请求体** |
  | 主页 | 库里取 | 库里取，**但客户没配时回退 `body.pageId`** |

  `draft-and-gate` 的回读闸门查的是"买家会看到什么"（语言、地区、重定向），**不查这些 Meta 资产属不属于这个客户**。所以在 CTS/Oztop 共用广告账户的现状下，通用入口仍可能让本客户批准、投出另一客户的表单或素材 —— 跟 boost 路径那条 R5 写越权是同一类问题，只是入口不同。

  **结论：首条广告走 `draft-listing`**（它已有租户素材守卫）。要把通用 `meta-ads/draft` 也算作安全路径，得先给它补 page / form / creative 的归属校验。

在 (i) 或 (ii) 落地之前，**①a 只是把 `play` 传上、等下次真有广告被建时能记上**，它本身不产生第一条记录。

> 📌 **结论**：想省事先走 (i) 是可以的，但要接受它**只验一半**；**真正的首条端到端验证必须走 (ii)**。别把 (i) 跑通当成"闭环通了"—— 那正是本审计在批评的那种"各环节都正常，只有并排看才发现断了"。

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

所以"把这些函数接上"不会得到 5–8 条角度。真正缺的是一个**批量角度选择/生成 + 去重 + 逐条溯源**的编排层。这是**新增开发**，不是接线 —— 按半周到一周估，别按零估。

而且它要靠的那两道约束**目前只有一道半是真的**：`scanRedlineHits` 禁用词硬闸是实打实的；`listing-draft-builder` 那道只保证"模板不自行新增事实"，**不保证喂进来的事实是真的**（`assertFacts` 只查 `sourceUrl` 非空，从不抓页面核对，而 `traceClaims` 照样盖"官网可溯"—— 见 §4 第 6 条）。**批量扩量会把这个洞按倍数放大 —— 但它不是"量大了才危险"：第一条付费广告就会带着未核实内容投出去。** 所以来源校验被列为「投第一条真广告」的前置（执行顺序第 4 步），排在 ③ 之前。

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
  - **前置**：`P21.K.8` 补完播指标（**筛 hook 就靠这个**）+ `P18.E.3` 补池 size 净增（只答池子整体涨了多少）。⚠️ 注意**这两条都做完也答不出"哪个 hook 把池子做大"** —— 那一维没有任何已登记项覆盖，需一 hook 一池或另建创意级增长映射（详见 §7 执行顺序第 7 步）。

**不建议现在做的**：重构 winner 判定、建"意图 → 角度"模型、把 `ad-level-breakdown` 改成会宣布赢家。这三件事都要有真实的 creative 级数据才能设计，而那些数据要等 ①a / ①b 跑起来才有。

**建议的执行顺序**（经三轮更正后的版本）：

0. **补读 Oztop + Roman 两个账户的 targeting** —— 必须在**有 `META_SYSTEM_USER_TOKEN` 的环境**里直调 Graph（本次审计环境没有该 token，MCP 那条路 Oztop 被 Meta 拒绝、Roman 的 `act_1018365291238494` 返回 `is_queryable: false`，都实测过，见附录 1）。活不大，但**它决定"投放侧已经做对了"这个判断能不能覆盖另外 52.3% 的花费** —— 现在这条结论的证据只覆盖 CTS 一家、47.7%；
1. **①a** 传 `play` —— 小活，今天就能做，但它本身不产生第一条记录；
2. **②** `ad-publisher.ts:116` 改 `advantage_audience: 1` —— 一行，现在改成本为 0；
3. **做 ①b（= 方案 (ii)，让 `draft-and-gate` 那条路径能记账）** —— 这是「投出第一条 ME 自建广告并验通完整链路」的真正前置。**不能用方案 (i) 顶替**：修好 boost 路径的四样问题也不改 `REACH`，`results` 恒为 0，验不了"某个客户是被哪条创意带来的"那半截（见 ① 的说明）。设计与编码自己拍板，只在最后对生产库 `apply_migration` 那一下停下来等 PM 一句 `go apply`；
   *（若想更早拿到一点信号，可以顺手把方案 (i) 的四样也修了 —— 但要认清它只验上半截的记账，不算闭环。）*
4. **补事实来源校验** —— ⚠️ **这一步是第十三轮才前移到这里的**（Codex P1，核实成立）。上一版把它挂在第 5 步（批量角度）之前，理由是"批量扩会放大这个洞"—— **但第 4 步已经在花真钱了**。`assertFacts` 只查 `sourceUrl` 非空、从不抓页面核对，而 `traceClaims` 照盖"官网可溯"章（§4 第 6 条）。所以**只要调用方给错房价/地址/战绩，第一条付费广告就会带着未核实内容过审、投出去** —— 这不是"量大了才危险"，是第一条就危险。
   做法二选一：按 `sourceUrl` 抓页面核对关键字段，或**只接受来自 ME 已核实数据源的事实**（后者更省，首条广告用它就够）；
5. 前置全部落地后，**投第一条真广告 —— 走 `draft-listing` 的 `lead_form`**（不走 REACH boost，也不走还没补归属校验的通用 `meta-ads/draft`）；
6. **③** 批量角度（半周到一周）。事实来源校验已在第 4 步做掉；若还要跨语言合并，再加"表单身份下沉 + 表单混语言闸门"；
7. 若要做**攒池型**角度测试（视频 hook 筛选），前置是**两条已登记的 ROADMAP 项，不是一条**（第十一轮更正 —— 上一版把池子增长错记进 `P21.K.8`，实际它不在那条里）：
   - **`P21.K.8`** —— `objective` 列 + 视频完播指标（ThruPlay 完播成本 / CPM / `video_p100`）+ 按 objective 切换判定。**这条只解决"哪个 hook 让人看完最便宜"。**
   - **`P18.E.3`** —— 池 size 快照 → `flywheel_metrics` 的 `ads.audience.*`，台账画**净增 = 新进 − 到期掉出**（受众是衰减存量）。它答的是"**这个池子涨了多少人**"，依赖 `P18.E.2`。

   ⚠️ **但这两条加起来仍然答不出"哪个 hook 最快把池子做大"**（Codex 复审第十三轮 P1，核实成立；上一版把 `P18.E.3` 写成了这个问题的充分前置）：

   - `client_audience_assets`（migration `20260728144156`）的唯一键是 **`audience_id`**，维度只有 `layer` / `ladder_stage` / `scope` —— **没有"哪条视频/哪条创意"这一维**；
   - 而 `audience-ladder.ts` 的 `videoEventRule(videoIds, pageId, event)` 是把**一批 videoId 灌进同一个池**。13 个 hook 喂同一个池，`P18.E.3` 只会给出**一个**净增数字。

   所以攒池型角度测试的成效信号，现状是**一半可得、一半不可得**：

   | 信号 | 靠什么 | 状态 |
   |---|---|---|
   | 单次完播成本（哪个 hook 让人看完最便宜） | `P21.K.8` | ⬜ 登记未做，**做完就有** |
   | 池子整体涨了多少人 | `P18.E.3` | ⬜ 登记未做，**做完就有** |
   | **哪个 hook 贡献了这些新增** | —— | 🔴 **没有任何已登记项覆盖**：要么每个 hook 建**独立的池**（一 video 一 audience），要么另建 ad/creative 级的增长映射 |

   **实操建议**：现阶段做攒池型 hook 测试，就用**完播成本**当筛选指标（`P21.K.8` 之后可得，且本来就是 `play-vocabulary.ts` 列的第一个信号），**不要指望"谁把池子做大"这个维度** —— 除非先按 hook 拆池。

> ⚠️ 这一节被更正了三轮（每轮都是 Codex 抓到、逐行核对后成立）。三次错误有同一个形状：**看见"表已经建好 / 函数已经存在"就推断"接上就能用"，而没有核对它到底怎么被调用、怎么花钱、字段是哪一级的**。这正是本审计在 §5 批评系统的那件事，作者本人连犯三次 —— 记在这里，因为下一个照这份文档动手的人最可能踩的就是同一个坑。

---

## 8. Final answer to Product Owner（大白话）

**我们走在对的路上，但现在真正在跑的那一半，是人做的，不是系统做的。**

三件事说清楚：

1. **广告投给谁这件事，在查得到的那家客户身上，已经做对了。** CTS 的广告我们逐组查了：**没有一组在做"人群精挑细选"**，钱的七成多明确开着"让 Facebook 自己去找人"，唯一关掉的那组是专门投老客户的，那组本来就该关。这正是现在 Facebook 最吃香的做法，这部分不用改。

  ⚠️ 但**这句话只覆盖不到一半的钱**：查过的只有 CTS 一家（$3,733，占 47.7%）。**Oztop（46.1%）和 Roman（6.1%）两家的广告账户 Facebook 都不让我们读**，合计 52.3% 的花费没有任何证据 —— 它们是好是坏，现在纯属猜测。

  所以准确说法是「**查过的那 48% 做对了**」，不是「我们做对了」。想把这句话说全，得先补读另外两个账户。

2. **广告"说什么"这件事，我们还在用老办法。** 钱最多的三条广告，加起来只有 4 条不同的片子；而我们真正试过十几个不同说法的那两次，一次花了 $432、一次花了 $366 —— **两次都没能得出结论，但原因不一样**：Oztop 那次（$432）**方法是对的**，是我们的系统没把该看的数（多少人把片子看完、看完一次多少钱）收进来，所以现在读不出谁赢；Roman 那次（$366）是钱太少，十几条片子分下去每条只有二十几块，谁赢基本靠运气。

  **说白了：我们把所有钱押在少数几条片子上，同时用零花钱去做真正该做的测试 —— 这个次序反了；而且就算测了，有一类测试我们的系统还读不懂。**

3. **最关键的一环还没通电：我们至今说不清哪一条片子带来了哪一个客户。** 39 个已经追到"哪条广告"的客户里，**没有一个**能追到"哪条片子"。记这件事的表已经建好，但**记录这件事的几段路只各修了一段、还没接到一起**。

  更麻烦的是：**今天两条路各缺一半，没有一条能马上用。**

  - 一条路（给已发出的帖子投流）**记得住**是哪条片子，但毛病不少：广告**建出来立刻就开始花钱、没有你点头那一关**，投放地区**写死了澳洲+新西兰**（拿它投 CTS 会把新西兰客户的广告投到澳洲），而且它是"**只求多少人看见**"的广告，**根本不会产生询盘** —— 所以就算修好前面那些，它也回答不了"这个客户是被哪条片子带来的"。修它只能验证半截。
  - 另一条路（ME 从素材直接起草一条新广告）**该有的把关基本都有**（先建成暂停、回读一遍、你点头才开），而且它是**收联系方式**的广告，能真的产生询盘 —— **只有这条路能把"哪条片子带来哪个客户"整条验通**。它现在的问题是**记不下来**是哪条片子，要记得下来得改一次数据库结构。

    ⚠️ 但这条路有**两个门**，只有其中一个门是安全的：从客户素材库挑图那个门会核对"这张图确实是这个客户的"；另一个更通用的门**不核对**，理论上能把 A 客户的表单/图片用在 B 客户的广告上（因为几个客户还共用着一个广告账户）。**第一条广告走前一个门**，通用那个门要先补上核对才能用。

    **这个不用等你**：写代码、写改动方案、找人复审都由我们自己推进，**只有最后真正动生产数据库那一下需要你回一句「go apply」**。

  **所以第一条广告应该走第二条路。** 第一条路可以顺手修，但别把它跑通当成"通了"。

  ⚠️ 还有一件必须**赶在第一条广告之前**做的事：现在系统**不会去核对喂给它的房价、地址、战绩是不是真的**（只看有没有附网址），却会在交付物上标"官网可溯"。这一条我原先排在"批量出角度"之前，**排晚了** —— 第一条广告就是真金白银投出去的，错一个价格就已经印在客户的付费广告上了。**先补核对，再投第一条。**

  所以「让 ME 投出第一条广告」不是今天就能做的事，得先在这两条路里挑一条补齐。（为什么非要在建广告那一刻记：只有那一刻知道对应关系，事后问 Facebook 是问不出来的。）

**如果按现在的方向继续做，Magic Engine 在 Meta 广告上真正能形成的竞争优势是这个：**

> 我们已经有客户真实的产品、真实的素材，也已经有一台能批量出片的机器，而且**这台机器不会自己瞎编** —— 它只会把我们喂给它的事实拼成文案，不会凭空多写一个价格。别人做批量创意测试，最大的两个成本是"想不出这么多说法"和"怕 AI 瞎编惹祸"，后者我们基本解决了。
>
> ⚠️ **但有一个洞得先补**：机器不瞎编，不代表**喂进去的东西一定是真的** —— 现在那个接口是"谁调用谁给事实，附一个网址就算数"，系统**不会去那个网址核对一遍**，却会在交付物上标"官网可溯"。量小的时候人能兜住，一旦按上面说的批量扩，这就是把没核实的价格印在付费广告上。**扩量之前先补这道核对。**
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
4. **🆕 `ad_daily_insights` 没有币种列，跨客户金额不可加总** —— 本审计发现的新缺口，**ROADMAP 里没有登记过**。`spend` 是裸 `NUMERIC`，`parseDailyMetrics` 把 Graph 返回的账户币种金额原样存下、不做换算；而 CTS/Roman 是 NZD、Oztop 是 AUD。影响面不止本审计：**任何跨客户的花费汇总、排行、预算比较都会算错**（月报、Goal 指标、production package 都在读这条线）。
   修法：`ad_daily_insights` 加 `currency` 列（Graph 的 `account_currency` 字段直接给），跨客户汇总时按基准日折算并注明汇率。**建议登记成 ROADMAP 一条**（不在本审计范围内，故此处只报缺口不写方案）。
