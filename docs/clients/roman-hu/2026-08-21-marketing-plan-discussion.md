# Roman Hu Marketing Plan 讨论记录 — 2026-08-21

> 背景：补录 Roman 的 Goal/Initiative/Marketing Plan 到 ME 策略层（见 [`2026-08-20-content-line-12-outlines.md`](./2026-08-20-content-line-12-outlines.md) 与 memory `project-roman-hu-ray-white-mission-bay`）之后，PM 提出这套功能"设计复杂了"，已开 [#1118](https://github.com/bigbigraydeng-maker/magic-engine/issues/1118) 追踪产品方向优化。在优化功能之前，先在对话里过一遍 Roman 这份 Marketing Plan 的实际内容，本文档是那次讨论的记录，供今后（含 #1118 落地后）参考。

**状态**：纯讨论，本次未写代码、未改数据库。下面每条列了「已知事实」和「待决定/待执行」，落地前需要 PM 或 Roman 再确认一次。

---

## 1. Goal 方向修正

PM 口径：**SEO + GEO 个人品牌影响力，聚焦 Roman 主打的几个 suburb**（Mission Bay / Kohimarama / St Heliers / Glendowie）。硬性目标数字现在定不出来（数据太薄），但认了一个加分信号：**在线表单能收到免费评估/咨询申请，就算进展**——当前是 0（不是"暂时没数据"，是压根收不到）。

这比 2026-08-21 早些时候我补录进数据库的 Goal（`primary_metric_key='organic_traffic'`, target=400，占位数）更准——那版偏"流量"，PM 真正想看的是"能不能转化出线索"。**待办**：Goal 记录需要更新，之前记的 organic_traffic 目标应该降级/保留为辅助指标，主线换成 leads/form_submissions 相关（见下条，前提是表单先修好）。

## 2. 咨询/评估表单是死的（本次发现，已定位根因）

查源码（`~/Projects/roman-website`）确认：
- `src/components/AppraisalContent.astro`（`/appraisal` 免费评估）、`src/components/ConsultContent.astro`（`/consult` 预约咨询）两个页面都有 `<form>`，但**没有 `action`、没有 `onsubmit`、没有任何 `fetch()` 调用**——纯前端摆设，按提交按钮什么都不会发生。
- ME 后台 `clients.leads_config` 对 Roman 也是空的 `{}`——即便前端修好，后端也没开门接收（`/api/clients/[id]/leads` 的 `resolveClientContext` 靠 `leads_config` 里的 `origins` 白名单放行，空的话直接 404）。

**结论**：这是两头都没通的死链，不是"暂时没人填"。

**修复方向（已确认可行，未执行）**：
- 不用新建接口——ME 已有 `/api/clients/[id]/leads`，CTS 等客户在用。Roman 的两个表单接上去 + 后台补 `leads_config`（origins 白名单 + 通知邮箱）即可。
- 修好之后，`form_submissions`/`leads_count` 本来就在 ME 的 `PRIMARY_METRIC_CATALOG` 里、GA4 auto-fetch 能自动抓，可以真正挂到 Goal 上当主指标或第二信号，不用像现在只能看流量这一个占位数。

## 3. Google Business Profile 缺口

`clients.gbp_place_id` 查证为 `null`——Roman 在 ME 里完全没接 GBP。对个人中介来说 GBP 是"Mission Bay real estate agent"这类本地搜索/AI 问句的重要曝光位（Google 本地包、"附近的地产中介"）。列为候选待办，未排期。

## 4. 第三方中介平台维护（homes.co.nz / realestate.co.nz / ratemyagent.co.nz / oneroof.co.nz / neighbourly.co.nz）

**为什么重要，不只是"资料要更新"**：这些平台的域名权重远高于 romanhu.com（DR：ratemyagent.co.nz 68、oneroof.co.nz 67、homes.co.nz 58 vs. romanhu.com 现在只有 0.1）。**AI 大概率是从这些高权重第三方页面认出 Roman，而不是从他自己的官网**——但目前 GEO baseline v1（2/12 owned-domain citation）只测了 romanhu.com 自身被引用的情况，完全没测这些第三方页面，是个测量盲区。

也跟一条已知但一直没验证的旧红线是同一件事：Roman 换到 Ray White 之后，这些平台上的身份/头像/所属中介有没有同步（还是仍挂着 Barfoot），一直没人实际核实过（见 memory `project-roman-hu-ray-white-mission-bay` 的"待 Roman 提供"一条）。

**PM 决定**：
- **ME 自己来干**，不当成"只能甩给 Roman/FDE 手动点"的任务——但要注意：这几个平台大概率没有官方接口能代填，得真人登进各自后台操作（很多还要 Roman 本人账号密码），落地时要按"能自动就自动、真做不了就把 what/how/href 三件套讲清楚"的方式处理，不能假装能全自动。
- **学好这个流程后要沉淀成可复用能力**——这是给「地产中介」这个客户类型（`client_type='agent'`）的通用 Playbook 候选，不是 Roman 专属代码。以后接第二个地产 agent 客户直接套用。按 CLAUDE.md §0 平台化原则，这块应该进 Industry Playbook，不能写死进 Roman 的 client 配置里。
- **硬性检查项：每个平台的 profile 网站字段必须 backlink 回 romanhu.com。** 一举两得——给 romanhu.com 反链权重，同时让 AI 更容易把"这几个平台上的 Roman"和"官网上的 Roman"认成同一个实体。

## 5. Facebook Custom Audience 沉淀 + 广告复用

重申并落实一条 2026-07-12 就定过的旧决定（见 memory `project-roman-hu-ray-white-mission-bay` 第 44 行）："**FB 广告永远走 agent（Roman）账户，不管谁付钱，Roman 的 Custom Audience 是 agent-level 资产**"——当时是为了应对开发商楼盘投放（Head of Projects 场景）。

PM 现在重提，是要把这条原则坐实到执行层：不管是 30 Kiteroa 这类楼盘投放，还是以后任何广告动作，产生的 Custom Audience 都要沉在 Roman 名下持续累积，不能随每次投放结束就废掉、下次又从零建。

**已知技术疙瘩（落地前必须先理清楚，本次未核实细节）**：Roman 的广告账户 `act_1018365291238494` 跟 30 Kiteroa（独立客户/楼盘）共用，且上次审计记录状态是 `is_queryable: false` / UNSETTLED（见 memory `project-me-execution-ledger-silent-failure-audit` 相关审计记录）。真要开始攒 audience 之前，得先确认这个账户到底能不能正常读写、共用会不会导致 audience 归属混淆。

---

## 待排期清单

| # | 事项 | 依赖 | 状态 |
|---|---|---|---|
| 1 | Goal 主指标从 organic_traffic 换成/补充 leads 相关 | 先修好 #2 | 待定，PR #6 合并跑出真实数据后再跟 PM/Roman 确认目标数字 |
| 2 | `/appraisal` `/consult` 表单接入 `/api/clients/[id]/leads` + 补 `leads_config` | 无 | **✅ 2026-08-21 已实现**，见下方「执行记录」 |
| 3 | Roman 接入 Google Business Profile | 需 Roman 提供 GBP 访问权限 | 待排期 |
| 4 | 第三方中介平台（homes/realestate/ratemyagent/oneroof/neighbourly）身份核实 + 维护 SOP + backlink 检查 | 需真人登录各平台，部分需 Roman 账号密码 | 待排期，且要沉淀成地产 Agent Industry Playbook |
| 5 | Roman 广告账户状态核实 + Custom Audience 沉淀机制 | 先查清 meta_ad_account_id 现状 | **✅ 2026-08-21 已核实并修正**，见下方「执行记录」 |

## 执行记录（2026-08-21，「整合一下，开动吧」这轮做的）

**#2 表单接线**：`AppraisalContent.astro`（`/appraisal`）、`ConsultContent.astro`（`/consult`）EN+ZH 四个页面全部接上 `POST /api/clients/e7465ac7.../leads`（照抄 Oztop LP 已验证过的写法：honeypot、成功/失败态、`gtag('event','generate_lead')`）。`npm run build` 20 页全过，无新增报错。PR：https://github.com/bigbigraydeng-maker/roman-website/pull/6（未合并，等 PM 确认）。

顺带查出并修了两个此前会让表单"接了也白接"的坑：
- `clients.domain` 记的是 `www.romanhu.com`，但站点实际服务在 apex `romanhu.com`（www 301 跳转到 apex）——leads 接口的 CORS 白名单是从 `domain` 字段现算的，改之前**真实域名从来没在白名单里**。已改回 `romanhu.com`。
- `clients.leads_config.notify_emails` 是空的——落库了但 Roman 收不到通知邮件（这条坑 Park Homes 踩过一次，代码注释里专门写了）。已补 `roman.hu@raywhite.com`。

**#5 广告账户核实**：查 Meta Ads API 发现 `clients.meta_ad_account_id`（`act_1018365291238494`）实际是 ME 共享的"Magic Engine"账户，**不是** Roman 自己 Business Manager 下的账户。Roman 真正的账户是 `act_1260456876069575`（命名"30 Kiteroa"，Business Manager 归属 = "Roman Hu"），里面已经有 **4 个 2026-08-03 建的 Custom Audience**（主页互动 30/365 天、私信池、视频观众——都叫"Roman · ..."），说明"agent 级资产要沉淀"这条原则其实已经在正确执行，只是 ME 后台记录的账户指针指错了。已把 Roman HU 和 30 Kiteroa Rothesay Bay 两个 client 记录的 `meta_ad_account_id` 都改成 `act_1260456876069575`。

**Goal/Marketing Plan 同步**：Goal `f41c5eed...` 的 `fde_reasoning` 追加了以上记录，`supporting_metrics` 加了 `form_submissions`（待 PR 合并后才有真实数据）和 `meta_custom_audience_health`（已修正）两项。新增 Initiative `5e136869...`「线索转化管道 + 广告资产归属修复」（terminal，defensive），记录这一批修复。
