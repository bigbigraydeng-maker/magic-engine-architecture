# Spec：ME Commerce 客户 Onboarding Playbook v0.2.4

- **日期**：2026-08-25（v0.1 → v0.2 → v0.2.1 收敛版）· 2026-08-26 v0.2.2（Codex PR #1192 review round 1 修订）· 2026-08-26 v0.2.3（Codex PR #1192 review round 2 修订）· 2026-08-26 v0.2.4（Codex PR #1192 review round 3 修订）
- **owner**：Claude Code 主导编排；提炼自 Ray 与 Claude Code 就 Jing's Pick 转椅 SKU 的实操会话
- **首个跑通对象**：Jing's Pick（`71b5ec11-…`，client status: prospect → active 待 PM GO）— 作为 ME Commerce Customer Zero
- **风险级别**：**B 级**（新平台能力设计，无 schema 破坏性变更，无对外新 endpoint 上线；具体 capability 实施走各自的 A/B/C 风险闸）
- **审阅状态**：DRAFT v0.2.2 · 待 Codex/构建控制在 [#1137](https://github.com/bigbigraydeng-maker/magic-engine/issues/1137) triage → 若 promote 后开正式任务合同并送子牙（架构）+ 魏征（挑刺）2 审
- **Implementation Authorized**：**NO**（本文档只是 spec，不动 code / schema / migration / 部署）
- **v0.2 变更**：修 v0.1 自审出的 W1-W5 五个结构性漏洞。
- **v0.2.1 变更**（过度开发体检后收敛）：v0.2 的 W2/W3 fix 属"为想象未来需求提前抽象，零 caller"，撤回；W5 的 capability 命名撤回，保留 expiry 检查 SQL；W1/W4 fix 有真实 caller（多价段 + 多 tier SKU 都在当前讨论），保留。详见 §10 变更历史 + [docs/history/over-eng-log.md](../history/over-eng-log.md)。
- **v0.2.2 变更**（PR #1192 Codex review round 1）：① 共享金额契约改币种无关——`FulfillmentConfig`/`UnitEconomics`/`OutcomeRecord` 新增 `currency` 字段，`tax_rate`/`gate_baseline`/`min_margin_pct` 全部移入 industry profile，不再硬编码 NZD/15% GST；② Stage 00 改用仓库现有 `clients.client_status`（active/prospect/archived），移除不存在的 `status`/`declined`/`activation_note`，拒绝原因存储位置明确为待建列 `qualification_note`；③ Stage 10 Shopify 订单接入改列为 `capability: shopify-order-ingestion`（❌ 待建，仓库无 webhook 路由/orders 表）；④ Stage 10 完成判据拆两级，首单回流只算 Level A「数据管道就绪」，Level B「Outcome Loop 完成」需真实影响下一次排序/预算/停止决策。详见 §10。
- **v0.2.3 变更**（PR #1192 Codex review round 2）：① Stage 00 准入门槛的最低月广告预算与币种移入 industry profile（`min_monthly_ad_budget` + `currency`），不再硬编码 `NZ$500`；② 新增 §2.1 表结构待建声明，逐一确认 `products`/`demand_signals`/`normalized_product_records`/`unit_economics`/`fulfillment_configs`/`client_positioning`/`ad_campaigns`/`outcomes` 均为待建表（仓库现状无一存在），避免各 capability 合同遗漏持久化工作；③ Stage 08 FBM 人工发布任务补齐 `what`/逐步 `how`/直达 `href` 三件套，对齐 CLAUDE.md §3 人工任务下发铁律；④ Stage 03 供应商 gate SQL 补齐 `verification_level != 'unknown'` 与 MOQ/price/dropship 非 null 的必填字段校验，不再只统计记录数。详见 §10。
- **v0.2.4 变更**（PR #1192 Codex review round 3）：① 撤回"score.ts/landed-cost.ts 只换 profile、代码不动"的承诺——全仓核实 `landed-cost.ts`/`scan-request.ts`/`score.ts` 现状均是 NZ/NZD-only 硬编码实现（`SUPPORTED_MARKETS=['NZ']`、字段名 `xxxNzd`、`gstRatePct` 按百分数 10-20 校验、AU/NZ 专属需求闸），本 spec 的 `tax_rate` 契约改口径对齐现有代码（百分数而非小数），并把 Stage 04 "ME 能力"改列为 NZ profile 专用实现 + 待建 market-adapter；② 统一供应商验证枚举——`SupplierVerification` 无 `unknown` 成员，§5.1 SQL 与 Stage 03 文字改用正向名单 `IN ('gold','verified','audited')`，不再用会报错/误放行的 `!= 'unknown'`；③ Stage 09 creative variant 补稳定身份——复用已合的 `ad_creative_links` 表（`supabase/migrations/20260801000001_ad_creative_links.sql`），要求 `daily-plan.ts` 等各生成入口把 `creative_ref` 落成真实内容 id（如 `content_work_orders.id`）而不是日期字符串，使同日多变体各自可归因；④ Stage 08 库存同步 cron 补首次上架之后的持续人工闭环——每次库存变化都要下发带三件套的 FBM 调整任务，不能只在首次发布时下发；⑤ Stage 10 新增 `capability: fbm-order-entry`（待建，客户/FDE 用的订单录入页面 + 持久化 + 幂等契约），FBM 订单不再只写"手工录入 orders 表"这句无落地路径的话。详见 §10。

---

## 0. Build Gate（开工前四关）

1. **Repository Fact Gate**：开工窗口先 `git fetch origin`，报告 `main` 精确 SHA。
2. **Domain Semantics Gate**：本 playbook **不得**把 Jing's Pick / 华人客户 / NZ 市场 / 转椅品类语义硬编码进 shared runtime。这些是 **industry-playbook / client-configuration** 层承载。
3. **Product Gate**：解决的是「让每个 ME 电商版新客户按同一套判据、同一套数据源、同一套契约完成 onboard」，不因 Jing's Pick 特例反向改写通用流程。
4. **Architecture / Reuse Gate**：见 §2，先复用后扩展。

---

## 1. 目标（一句话）

**把今天为 Jing's Pick 走过的完整选品→上架→推广→回流流程，抽象成一套 10 段、每段有硬指标、每段绑定 ME capability 的可复用 playbook**，未来每个 ME 电商版新客户 onboard 都按同一路径走。

**范围内**：客户准入 · 供应链模型 tag · 需求信号验证 · 供应源探源 · 单品经济性 gate · 履约模型 · 差异化定位 · Master Brief · 三渠道上架 · 双渠道推广 · 闭环回流的 spec；对应 ME capability 与数据契约。

**范围外**：具体 capability 的实施 code；具体客户的 Master Brief 内容；具体 SKU 的采购决策。这些由各自 task contract 承载。

---

## 2. 复用声明（Reuse Statement）

| 已有 / 待建能力 | 状态 | 说明 |
|---|---|---|
| `src/lib/commerce/product-intel/scan.ts` + `score.ts` + `normalize.ts` + `landed-cost.ts` + `scan-request.ts` | ✅ 已合（PR #1000）| **v0.2.4 订正**：这套是 **NZ market profile 专用实现**，不是币种/市场无关的通用计算器——`scan-request.ts` 的 `SUPPORTED_MARKETS` 硬编码只有 `['NZ']`、`landed-cost.ts` 的 `CostAssumptions`/`LandedCost`/`PricingBreakdown` 字段名均带 `Nzd` 后缀且 `gstRatePct` 按百分数（10-20 区间）校验、`score.ts` 的 `gateAuNzSearched`/`gateNoDumping`/`clickCostNzd` 直接绑定 AU/NZ 需求与 NZ 本地倾销判断。Stage 02 / 04 目前只能对 NZ 客户直接接入；AU/SG/MY 复用需先补 `capability: commerce-market-adapter`（币种换算 + market allowlist 扩展 + 需求信号源按市场切换），不是"换 profile 代码不动" |
| `src/lib/campaign/daily-plan.ts` + `CampaignDailyPlanPanel.tsx` | ✅ 已合（#1159）| Stage 09（推广渠道 creative 生成）复用其 kind pattern，新增 `commerce_daily_v1`；**v0.2.4 订正**：现有 `buildAdCandidate` 把 `creative_ref` 填成 `bundle.date`（日期字符串），Stage 09 落地时必须改填真实内容 id，见下方 `ad_creative_links` 行 |
| `src/lib/ads/creative-link.ts` + `ad_creative_links` 表 | ✅ 已合（`supabase/migrations/20260801000001_ad_creative_links.sql`）| Stage 09 creative variant 稳定身份直接复用：`(client_id, platform, ad_id)` 唯一键 → `creative_ref` 指向 ME 自己的片子 id，天然支持同日多 `ad_id` 分别绑定不同 variant；**待办**：调用方（daily-plan / campaign 建广告入口）必须传入真实 `creative_ref`（而非日期），否则同日多变体仍会在归因侧合并 |
| Meta Ads Library MCP `ads_library_search` | ✅ 已实测通（2026-08-25 会话）| Stage 02 需求信号主入口 |
| Shopify MCP | ✅ 已连（memory 有能力边界文档）| Stage 08 独立站主渠道 |
| `master_briefs` 表 | ✅ 已有 | Stage 07 直接复用 |
| `capability: product-catalog-adapter`（Alibaba/Yiwugo/MIC/HKTDC/Global Sources）| ❌ 待建 | 已在 #1137 INSIGHT-01 立案 |
| `capability: demand-signal-adapter`（Meta Ads/Trade Me/Shopify Trends）| ❌ 待建 | 已在 #1137 INSIGHT-01 立案 |
| `capability: marketplace-adapter`（Trade Me / FBM 内容包）| ❌ 待建 | 本 spec 首次提出 |
| `capability: fulfillment-model-configurator` | ❌ 待建 | 本 spec 首次提出 |
| `capability: multi-channel-order-aggregator` | ❌ 待建 | 本 spec 首次提出 |
| `capability: shopify-order-ingestion`（webhook 路由 + 鉴权 + 幂等 + `orders` 表） | ❌ 待建 | 仓库现状：`src/app/api` 无 Shopify webhook 路由，`src/lib/cms/shopify-client.ts` 只处理 blog/page，无独立 `orders` 表。Stage 10 §3.10 point 1 之前误写"现有"，已订正 |
| `capability: fbm-order-entry`（客户/FDE 订单录入页面 + 校验 + 幂等契约） | ❌ 待建（v0.2.4 新增） | FBM 无 API，Stage 10 §3.10 point 3 原文只写"客户运营手工录入 → orders table"，没有录入入口——实施者只能让运营直接连数据库或订单留在平台外。需要一个带幂等键（防重复录入同一单）、基础校验（SKU/金额/下单时间必填）的录入 UI/API，产出契约同样落 `orders` 表 |

### 2.1 表结构待建声明（v0.2.3 新增）

本 spec 各 Stage 的 SQL 判据引用了多张表；对全仓 `src` + `supabase/migrations` 检索确认，除下表已标注"✅ 已有"外，**其余全部为待建**，尚无一条对应 migration。各 capability 任务合同 open 时必须先建表（或明确改接现有存储），不得默认表已存在直接写业务逻辑：

| 表名 | 状态 | 说明 |
|---|---|---|
| `clients` | ✅ 已有 | Stage 00 直接复用（含 `client_status`） |
| `master_briefs` | ✅ 已有 | Stage 07 直接复用；其 `products` 字段是 JSON 列，**不是**独立 `products` 表，不能承载 Stage 01/03/04 的 SKU 级结构化字段 |
| `products` | ❌ 待建 | Stage 01（`supply_mode`/`sku_commodity_tier`）· Stage 03（供应商记录关联）· Stage 04（unit economics 关联）均以此表为主键来源，必须最先建 |
| `demand_signals` | ❌ 待建 | Stage 02 判据表；注意仓库已有同名相近表 `content_demand_signals`（`20260711000002_p21j_content_factory_m1.sql`），二者用途不同，不得混用/复用其 schema |
| `normalized_product_records` | ❌ 待建 | Stage 03 判据表，`sku_id` 外键指向待建 `products` |
| `unit_economics` | ❌ 待建 | Stage 04 判据表 |
| `fulfillment_configs` | ❌ 待建 | Stage 05 判据表 |
| `client_positioning` | ❌ 待建 | Stage 06 判据表 |
| `ad_campaigns` | ❌ 待建 | Stage 09 判据表 |
| `outcomes` | ❌ 待建 | Stage 10 判据表，依赖 `capability: shopify-order-ingestion` 的 `orders` 表先落地 |
| `orders`（Shopify/Trade Me/FBM 汇总） | ❌ 待建 | 已在 §2 `capability: shopify-order-ingestion` 行说明，Stage 10 §3.10 point 1-3 依赖 |

**结论**：这些表全部归属"具体 capability 实施"的持久化工作，本 spec 只定义字段契约（见 §4）与判据 SQL（见 §5），**不预先假设任何一张已存在**。每个 capability 任务合同开工前必须在自己的实施 spec 里明确：新建 migration，还是复用/扩展某张既有表。

**platform-shared**：10 段流程结构、capability 契约、Stage 完成硬判据、gate 逻辑。
**industry-specific**（`industry-playbook/commerce-*`）：
- `commerce-market-nz`：NZ 单件利润模型、GST 15%、准入最低月广告预算（`min_monthly_ad_budget`）+ `currency`、CPC 基线、季节反季日历
- `commerce-market-au` / `commerce-market-sg` / …：未来复用同一 adapter，只换 profile
- `commerce-source-cn`：中国供应链源组合与 5 家死平台黑名单
- `commerce-source-premium`：Global Sources / HKTDC / MIC 精品源组合

**client-specific**（`client_configuration` + `client_private_memory`）：具体 supplier 合作记录、私有价格、退货政策、SKU 库存。

**红线检查**：任何"NZ 卖家专属"判断、任何"华人客户"定位、任何"Jing's Pick"字样，不得进 shared runtime。明天把 Jing's Pick 换成任意 NZ 电商客户，这套 playbook 只换 client config，不改 code。**v0.2.4 订正**：换成 AU/SG/MY 电商客户则不止换 profile——现有 `score.ts`/`landed-cost.ts` 是 NZ market profile 专用实现（见 §2 表格订正），跨市场复用还需先补 `capability: commerce-market-adapter`（待建），不是纯换 profile 就能带过。

---

## 3. 10-Stage Onboarding 流程

### Stage 00 · 客户准入（Qualification）

**Purpose**：判断这个客户是否适合走 ME 电商版。
**Inputs**：客户来源（自助注册 / FDE 引入 / 自营 Customer Zero）· 预算 · 目标市场 · 团队资源。
**币种边界**（v0.2.3 新增，同 Stage 04）：最低月广告预算门槛 **不得**硬编码 `NZ$500`——门槛数值与币种一律来自 industry profile 的 `min_monthly_ad_budget` + `currency` 字段，同一 profile 文件承载 Stage 00 准入门槛与 Stage 04 profit gate 参数。切到 AU/SG/MY market profile 时只换 profile 数值，判断逻辑不变。

**Actions**：
1. 客户在 `clients` 表登记，`client_status = 'prospect'`（表默认值）
2. FDE / PM 面谈，判断是否满足最低门槛（月广告预算 ≥ industry profile 的 `min_monthly_ad_budget`（币种 = profile 的 `currency`）· 有客服 · 有决策人）。**NZ 市场 v1 profile 示例**：`min_monthly_ad_budget: 500`，`currency: NZD`；AU/SG/MY profile 各自定义自己的数值，不复用 NZ 数字
3. 通过 → `client_status = 'active'`；不通过 → `client_status = 'archived'` + `qualification_note` 写明原因（该列为待建，见下）

**完成判据**：`clients.client_status = 'active'`（现有字段，见 `20260801120000_clients_client_status.sql`，枚举只有 `active` / `prospect` / `archived`，**没有** `declined`）。
**拒绝流转**：现有 enum 没有"拒绝"态，不通过的客户回落 `client_status = 'archived'`（语义最接近"不再推进"，不得发明枚举外的值）。拒绝原因目前**无处存**——`clients` 表没有通用备注列。本 spec 待建：新增 `clients.qualification_note text` 列（独立 migration，走正常 schema 变更 review），Stage 00 落地前必须先加这列，否则拒绝原因只能记在 spec/会议纪要里，不算完成判据。
**失败模式**：把 prospect 当 active 用 → 后续 stage 全跑通但客户根本没准备好履约；把 NZ 的 `min_monthly_ad_budget=500` 当全局常量写死 → 切到 AU/SG/MY profile 时仍按 NZ$500 判断，经济性完全不同的市场被错误放行或拒绝。
**ME 能力**：现有 `clients` 表 `client_status` 字段；`qualification_note` 列为待建依赖；`min_monthly_ad_budget` + `currency` 由 industry profile 承载（与 Stage 04 profit gate 共用同一 profile 文件）。

### Stage 01 · 供应链模型 tag（Supply Mode Tagging）

**Purpose**：每个 SKU（不是每个客户）独立标注供应链模型。同一客户可以有 dropshipping SKU 也有自采购 SKU。
**Inputs**：客户对每个候选 SKU 的供应商关系。
**Actions**：
1. `supply_mode` enum：`dropshipping` / `self-procured` / `hybrid`
2. `dropshipping`：中国供应商直发客户家门口，客户体验 15-30 天，无试坐，无内陆费。经济性最好但转化率最低（大件尤其）。
3. `self-procured`：客户从中国进货存自己仓库，前置资本占用，但客户体验（速度 + 试坐）最好。适合大件 / 高客单 / 需要"信任信号"的品。
4. `hybrid`：同 SKU 双模式（例如 Auckland 自采货，非 AKL dropship）。

**完成判据**：每个候选 SKU 数据库有 `supply_mode` 字段值 ∈ {dropshipping, self-procured, hybrid}。
**失败模式**：客户口头说自采购但实际没进货 → 广告投出去客户下单当天无货可发。
**ME 能力**：`capability: supply-mode-tagger`（SKU 级，与 `products` 表关联）。

### Stage 02 · 需求信号验证（Demand Signal）

**Purpose**：验证这个 SKU 品类在目标市场是否真有钱在花。
**Inputs**：SKU 品类关键词、目标市场 ISO2 code。
**Actions**：
1. Meta Ads Library MCP `ads_library_search`：多 keyword 并行（品类主词 + 2-3 变体），`ad_active_status=ACTIVE` + `countries=[TARGET]`
2. 排除污染源（短剧 / 小说 / 无关行业撞词）：文本清洗（drop `Continue Watch`/`Read next chapter`/`Novel`/`Drama` 等）
3. 识别**本地竞对**（NZD/AUD 计价的官方 page，如 `Sihoo NZ`、`Ecosa Sleep`）
4. Trade Me API（Stage 02b, 待接）：本土最大平台的品类热度
5. Shopify 官方 Trends（Stage 02c）：全球方向校准，不作决策依据

**完成判据**：
- 至少 3 个数据源交叉
- 本地竞对至少 1 个被明确点名 + 差异化机会点识别
- 品类 estimated_total_count ≥ 100 active ads（低于此判"信号太弱"）
- 输出 `DemandSignal[]` 结构化数据入库

**失败模式**：只查一个数据源就下结论；把短剧广告的高数字当真产品信号；忽略本地竞对已锁位。
**ME 能力**：`capability: demand-signal-adapter`（Meta Ads / Trade Me / Shopify Trends 共用契约）。

### Stage 03 · 供应链探源（Supply Discovery）

**Purpose**：找到能供得起、有质感、能持续供的中国供应源；供应商备选数按 SKU 商品化程度分档。
**Inputs**：SKU 品类关键词 + `sku_commodity_tier` 标签。
**Actions**：
1. 每 SKU 先打 `sku_commodity_tier` 标签（Stage 01 或 03 早段完成）：
   - `commodity`：大宗标准品，同款多家供应（如蓝牙耳机、数据线、通用坐垫、螺丝套装）
   - `specialty`：细分定制或半标准（如韩系护肤 mini set、特定款式桌椅、区域性风格家居）
   - `exclusive`：独家 / 定制 / 授权 / 小众非标（如 12 生肖开光手串、POD 个性化毛毯、宗教主题装饰、独家授权 IP 周边）
2. 五源交叉扫描（力度按 tier 递减）：Alibaba 国际站（主）· Global Sources · Yiwugo · Made-in-China · HKTDC
3. 每个供应商归一到 `NormalizedProductRecord`：`price_range` / `moq` / `supplier_verification_level` / `dropship_supported` / `origin_city_cluster`
4. **排除 5 家已死平台**（Chinabrands / Tundra / Handshake / Kaligo / VOVA）与 3 家欧美精品批发对小卖家不友好（Faire / Ankorstore / Abound）—— *v0.3 将改为动态 `platform-health-monitor` capability，不再硬编码在 spec*
5. **exclusive tier 必须补 `backup_procurement_note`**：书面记录若主供应商断供，切换到哪个备用采购渠道（例：`"若义乌 A 商掉线，转广州水贝小刘"`）—— 不是找第 2 家同款，是找可切换的**采购路径**

**完成判据**（按 tier 分档）：
| SKU tier | 最少供应商记录 | 额外必填 |
|---|---:|---|
| `commodity` | **≥3** 家 | 无 |
| `specialty` | **≥2** 家 | 无 |
| `exclusive` | **≥1** 家 | `backup_procurement_note` 非空 |

- 每家供应商的 `verification_level` 落在真正通过验证的档位（`gold` / `verified` / `audited`），不是 `unverified`（**v0.2.4 订正**：`SupplierVerification` enum 只有 `unverified`/`gold`/`verified`/`audited` 四个成员，没有 `unknown` 值——判据与 SQL 都不能拿一个 enum 里不存在的字面量做过滤，见下方 §5.1 订正）
- MOQ / price / dropship 三个关键字段无 null

**失败模式**：
- 只找一家 commodity 供应商 → 谈价无筹码 / 突涨价无 fallback
- exclusive tier 没写 backup_procurement_note → 主供应商掉线时无预案，等于把命脉交给对方

**ME 能力**：`capability: product-catalog-adapter`（5 家 P0 源共用）+ `sku_commodity_tier` 字段（Stage 01 或早段打标）。

### Stage 04 · 单品经济性 gate（Unit Economics）

**Purpose**：这个 SKU 卖出去到底赚不赚钱。不看毛利率百分比或净利绝对值单一维度 —— **两者都要 pass**。
**Inputs**：进价 / 头程物流 / 售价含税 / 广告费预估 / 支付通道费率 / 固定运营成本 · industry profile 的 gate 参数（含币种、税率、阈值）。
**币种边界**（本节修正）：净利公式、gate 阈值、outcome 金额字段**一律币种无关**——money 契约只携带数值 + `currency` code，具体币种、税种/税率、阈值数字全部来自 industry profile，**不得**在 shared 类型或公式里硬编码 `nzd` 后缀或 15% GST。

**v0.2.4 订正**：上面这条币种无关承诺目前**只在 spec 契约层成立，不在 `score.ts`/`landed-cost.ts` 现有实现层成立**——实测该实现是 NZ market profile 专用代码（详见 §2 表格订正），`CostAssumptions.gstRatePct` 按**百分数**校验（`scan-request.ts` 的 `ASSUMPTION_RANGES.gstRatePct = [10, 20]`，即传 `15` 代表 15%），本节 `tax_rate` 契约字段**必须同口径**（百分数，如 `15`，不是小数 `0.15`）——下方 profile 示例已订正为 `tax_rate: 15`。切到 AU/SG/MY market profile 时，profile 数值仍按同一百分数口径换算即可；但要让 `score.ts` 真正跑 AU/SG/MY 客户，还需先补 §2 表格里的 `capability: commerce-market-adapter`（币种换算 + market allowlist），不是"改个数字就行"。
**Actions**：
1. 按 `supply_mode` 展开对应模型：
   - `dropshipping`：进价 + 直送客户家（无内陆）→ 最好经济性
   - `self-procured` + 自提：进价（含 landed to 客户仓库）+ 无派送
   - `self-procured` + 内陆送：进价 + 派送费
   - `self-procured` + 非本地客户付运费：进价 + 客户付
2. 公式（税率从 industry profile 取，不写死）：`净利 = 售价 - 税(tax_rate) - 货成本 - 派送 - 支付通道 - 固定运营 - 广告费`
3. **Profit Gate 公式**（v0.2 函数式，v0.2.2 改币种无关）：
   ```
   PROFIT_GATE(price) = max(BASELINE, price × MIN_MARGIN_PCT)
   ```
   `BASELINE` / `MIN_MARGIN_PCT` / `tax_rate` / `currency` 均由 industry profile 承载。**NZ 市场 v1 profile**（示例，非唯一值；**v0.2.4 订正**：`tax_rate` 改为百分数，对齐 `landed-cost.ts` 的 `gstRatePct` 现有口径，不是小数）：
   ```
   commerce-market-nz:
     currency: NZD
     tax_rate: 15               # GST 百分数（=15%），NZ 特有，其他市场税种/税率不同；口径同 CostAssumptions.gstRatePct
     baseline: 15               # 绝对底线（防止 $30 品也能过 12% 但只赚 $3.6）
     min_margin_pct: 12         # 相对底线（防止 $500 品只赚 $15 但风险巨大）
     min_monthly_ad_budget: 500 # Stage 00 准入门槛，与 profit gate 共用同一 profile
   ```
   实际门槛（NZD 示例）：`max(15, price × 0.12)` —— NZ$45 品需过 15、NZ$120 品需过 15、NZ$300 品需过 36、NZ$500 品需过 60。**AU/SG/MY profile** 各自定义 `currency`/`tax_rate`/`baseline`/`min_margin_pct`，不复用 NZ 数值；且需 `capability: commerce-market-adapter`（§2 新增，待建）落地后才能真正接入 `score.ts` 跑分，profile 数值本身不能替代这层适配代码。
4. 输出：每 SKU × 每 fulfillment 组合的**具体数字**（不是"大概能赚"），带 `gate_baseline_pass` + `gate_margin_pass` 两个布尔，金额附带 `currency`
5. Web 版计算器（已建，需加"大件模式" `Task #5`）供人工现场测算，UI 显示"过 $ gate + 过 % gate + 综合过 gate"三个徽章，币种符号跟 profile 走

**完成判据**：候选 SKU 至少一种 fulfillment 组合满足 `gate_baseline_pass AND gate_margin_pass`（两个都必须过）。不过就打回 Stage 03 找更便宜供应商 / 或打回客户谈涨价。

**失败模式**：
- 忽略税 / payment gateway 费 / 广告费只看毛利 → 上线才发现单件亏钱
- 只用 flat 门槛（v0.1 的错） → $30 品刚过 15 gate 但 margin 只有 3%，一次退货就赔穿；$500 品被 15 gate 放行但需 3% margin 是极大风险
- 把 NZ 的 `tax_rate=15` / `baseline=15` 当成全局常量写进公式或代码 → 切到 AU/SG/MY profile 时仍按 NZD + 15% GST 算，误放行或误拒绝 SKU（v0.2.1 的错，v0.2.2 已修）
- 把 profile 的 `tax_rate` 当小数（`0.15`）传给现有 `score.ts`/`landed-cost.ts` → `gstRatePct` 校验区间是 `[10, 20]`（百分数），小数值直接被 `scan-request.ts` 拒绝；就算绕过校验硬传，`priceBreakdown` 里 `netRevenueNzd = price / (1 + rate/100)` 会按 0.15% 而非 15% 扣税，净利虚高（v0.2.3 及之前的错，v0.2.4 已修口径）

**ME 能力**：计算器逻辑现嵌入 `score.ts`——但该实现是 **NZ market profile 专用**（见 §2 表格订正），不是市场无关的通用计算器；industry profile 承载 `currency` + `tax_rate`（百分数口径）+ `baseline` + `min_margin_pct` 四个参数对 NZ 客户可直接用。AU/SG/MY 复用需先补 `capability: commerce-market-adapter`（待建），不是换 profile 代码不动。

### Stage 05 · 履约模型设计（Fulfillment）

**Purpose**：客户到底怎么拿到货。
**Inputs**：`supply_mode` · 客户仓库位置（若自采购）· 目标市场地理分布。
**Actions**：
1. Shopify Shipping Zones 配置：
   - **本地 metro 自提**（免运费，指向客户仓库或供应商展厅地址）
   - **本地 metro 送货**（按里程 + 固定 base）
   - **全国**（按 region + weight/CBM 分档）
2. Checkout 3 选 1 default 模式（除非客户明确说"只做自提"或"只做送货"）
3. 广告 landing page 明写自提地址（Google Maps pin）+ 送货政策

**完成判据**：
- Shopify Shipping Zones 有 ≥2 档（自提 + 至少一档送货）
- 广告 landing page 明写 fulfillment options
- 展厅 / 仓库若有物理地址 → Google Business Profile 已注册 + 至少 1 张真实照片

**失败模式**：营销承诺"包邮"但供应商不派 → 每单自己吃 $25 内陆费 → 广告投得越猛亏得越多。
**ME 能力**：`capability: fulfillment-model-configurator`。

### Stage 06 · 差异化定位（Positioning）

**Purpose**：跟本地竞对形成明确差异。
**Inputs**：Stage 02 识别的本地竞对 · 客户资产（华人叙事 / 展厅 / 团队故事等）· Master Brief 草稿。
**Actions**：
1. 本地竞对做什么？（Sihoo NZ = 纯电商 / Ecosa = bed-in-a-box 纯线上）
2. 客户有什么本地竞对没有？（Jing's Pick = Mt Wellington 试坐展厅 + 华人叙事）
3. 定位一句话：`[客户] 是唯一 [独有能力] 的 [品类] 卖家`
4. AI 辅助生成 3-5 个 positioning 候选，人审拍板

**完成判据**：Master Brief 有明确 positioning 一句话，且 positioning 是**竞对无法快速复制的**（价格战不算差异化）。

**失败模式**：定位 = "更便宜" → 竞对随时打价格战；定位 = "更好的品质" → 空话。
**ME 能力**：`capability: positioning-differentiator`（AI 辅助 + 人审）。

### Stage 07 · Master Brief（Brand Contract）

**Purpose**：客户的品牌契约，所有后续内容、广告、上架都以它为唯一真相源。
**Inputs**：客户会议答的 6 个必答问题（目标客户 / 品牌调性 / 价格带 / 避雷品类 / 广告预算 / 客服负责人）· Stage 06 positioning。
**Actions**：
1. AI 起草 v1（不是 AI 拍板）
2. PM 与客户当面对齐每一栏 → 拿到明确答案
3. 落到 `master_briefs` 表，version = 1

**完成判据**：`master_briefs` 记录存在 + 6 个必答栏无 UNKNOWN + 客户签字（PM 代签）确认。

**失败模式**：AI 编答案没跟客户对齐 → 广告出来客户觉得"不是他们的品牌" → 需大改重投。
**ME 能力**：现有 `master_briefs` 表 + Master Brief AI 起草器 + 人审 UI。

### Stage 08 · 销售渠道矩阵上架（Sales Channels）

**Purpose**：让候选 SKU 出现在客户目标市场的主流购买渠道。
**Inputs**：SKU 规格 + 图片 + Master Brief · Stage 05 fulfillment 配置。

**⚠️ NZ 市场硬约束（Ray 2026-08-26 拍板）**：**NZ 电商销售渠道 = 独立站 + Trade Me + Facebook Marketplace，穷尽三个，别无其他**。不要提 Amazon NZ（无本地站）· eBay NZ（无 NZ 电商流量）· TikTok Shop NZ（未开）· Instagram Shopping NZ（占比忽略）· 其他亚洲平台（无 NZ 覆盖）。见 memory `reference-nz-ecommerce-sales-channels-only-three`。未来 AU / SG / MY market profile 可能不同，各自 industry-playbook 定义各自渠道列表。

**Actions**：
1. **独立站**（Shopify 类）：主 SKU entity 建，通过 Shopify MCP（v0.x = Shopify-only；未来客户若用 WooCommerce/Wix 等，届时再引入 storefront-adapter 抽象，别现在写空壳）
2. **Trade Me**（NZ 独家）：通过 Trade Me API 自动同步（需注册开发者账号）
3. **Facebook Marketplace**：**无官方 API 是硬约束** → ME 生成"待发布内容包"，下发到今日待办栏必须带齐 CLAUDE.md §3 要求的三件套（缺一条视为断头，不算下发完成）：
   - **what**：问题 + 影响，说人话，例如"《XX 转椅》FBM listing 待发布，不发布=该 SKU 少一个已验证渠道（Jing's Pick 已用 FBM 卖出 30 把），当天流量损失"
   - **how**：逐步操作，不用客户运营自己摸索——① 打开 FBM 创建 listing 页 ② 按内容包里的标题/描述/定价/地点逐字段粘贴 ③ 上传内容包里的图（已排序，第 1 张为主图）④ 选品类 + 设 Auckland local pickup ⑤ 发布后把 listing URL 回填到内容包对应记录，供 Stage 08 expiry 检查读取
   - **href**：直达 FBM 创建 listing 页 `https://www.facebook.com/marketplace/create/item`（含目标地区/分类的具体带参链接，由 capability 生成时按 SKU 品类拼出，不要求手工搜索入口）
   · 需额外**养号 SOP**（多号并行 · listing 差异化 · refresh 节奏 · 客服中转号）· 实测 Jing's Pick 已用 FBM 卖出 30 把转椅证明渠道可行
4. 每个渠道 listing 差异化：独立站主视觉 + 长描述 · Trade Me 强调"试坐/自提" · FBM 走"Auckland local pickup" 抓 local shopper

**完成判据**（v0.2 加强 expiry 检查，v0.2.1 保留）：
- 三个渠道的 listing 各满足：
  - HTTP 200 响应活着
  - listing 未过期：**Trade Me listing 剩余寿命 > 7 天**（21 天默认周期硬约束）· **FBM listing 剩余寿命 > 7 天**（30 天周期）· **Shopify listing 非 archived / 非 draft**
- listing 描述 grounding master brief（不是 AI 编 —— 抽样人审 3 条 listing 都命中 master brief 关键卖点）
- 库存数一致（Shopify 主 = Trade Me 同步 = FBM 手动标注）· 差异 ≤ 1（允许 1 件误差因手工上）

**FBM 库存持续闭环**（v0.2.4 新增）：FBM 无 API 是硬约束（同 Action 3），意味着库存同步 cron **发现差异后仍然改不了 FBM listing**——它只能读三渠道当前库存、算出差异，改不了。若只在首次发布时下发一次人工任务（v0.2.3 补的三件套），后续 Shopify / Trade Me 每次成交扣减库存都不会触发任何后续动作，FBM listing 的挂牌数量会持续偏离真实库存，必然在某次同时成交时突破"差异 ≤ 1"的判据、造成超卖。因此：
- 库存同步 cron **每次**检测到 FBM 库存与 Shopify/Trade Me 汇总库存差异 > 1 时，都必须下发一条独立的"调整 FBM 库存"人工任务（同一今日待办管道，同样三件套：what = 差了几件 + 不改的后果是超卖；how = 逐步改 FBM listing 数量的操作；href = 该 listing 的编辑页直达链接），不能只有首次发布任务
- 或者（备选，成本更低）在 Shopify/Trade Me 侧为该 SKU 预留固定库存份额（reservation model），使三渠道各自售卖的份额不重叠，避免"读了差异才去人工补"这种事后补救的窗口期

**失败模式**：
- 只查 HTTP 200 忽略过期 → 客户点进已过期 Trade Me listing 得 404 → 广告费白花 + 品牌信任崩
- 三渠道超卖（客户下单当天两个渠道同时售出但只有 1 件库存）
- 只在首次发布时下发 FBM 人工任务，后续库存变化没有对应任务 → FBM 挂牌数量持续漂移，超卖迟早发生（v0.2.3 遗留缺口，v0.2.4 已标注）

**ME 能力**：`capability: marketplace-adapter`（Trade Me 自动 + FBM 内容包生成，输出契约必须包含 `what`/`how`/`href` 三件套，缺一不算下发完成；v0.2.4 起该契约覆盖首次发布**和**后续每次库存调整两类任务，不只首次）· 库存同步 cron（v0.2.4 起明确：检测到 FBM 差异必须落一条人工任务，不能只落日志/告警）。
Expiry 探测与续期任务下发的具体实现（cron 频率、任务派发路径、`ListingHealth` 表 schema）等 Stage 08 真实施到"第一个 Trade Me listing 上线"时再落细，避免为想象场景写死设计。

### Stage 09 · 推广渠道矩阵（Ad Channels）

**Purpose**：把流量导到 Stage 08 的 listings。
**Inputs**：SKU · Master Brief · Stage 06 positioning · 每月广告预算。

**Creative variant 稳定身份**（v0.2.4 新增）：同一 SKU 同日跑多个 creative variant 时，每个 variant 必须有独立可归因的 id，不能只靠日期区分。**复用**已合的 `ad_creative_links` 表（§2）——它以 `(client_id, platform, ad_id)` 为唯一键，`creative_ref` 存 ME 自己的片子 id（当前 = `content_work_orders.id`），天然支持同日多条 `ad_id` 分别绑定不同 variant。现状缺口：`daily-plan.ts` 的 `buildAdCandidate` 把 `creative_ref` 填成 `bundle.date`（日期字符串，见 `daily-plan.ts:389-397`），不是内容 id；Stage 09 建广告入口必须改传真实 variant 内容 id（同 `linkAdToCreative` 的 `postId`→内容 id 判定链路），`OutcomeRecord.creative_ref`（§4.2）也必须落这同一份 id，否则同日多变体的 outcome 会在归因时合并或串线，A/B 结果不可信。

**Actions**：
1. **FB Ads**：Meta MCP 建 campaign（现有 `ads_activate_entity` 等能力）
2. **TikTok Ads**：TikTok for Business API（需申请接入）
3. **Creative**：复用 `#1159 → commerce_daily_v1` kind 骨架，每天生成 post / story / reel 草稿；每个草稿在生成时即分配稳定 variant id，产出结构携带该 id 一路传到建广告入口
4. **Budget allocator**：每 channel 每 SKU 预算分配（初始按 50/50 或 70/30 分，看 outcome 调整）
5. **Retargeting**：Shopify pixel + FB pixel + TikTok pixel 三向联动

**完成判据**：
- 每 channel 至少 1 个 active campaign
- 每 SKU 至少 3 个 creative variant 跑 A/B，且每个 variant 在 `ad_creative_links` 里有各自独立的 `ad_id → creative_ref` 行（不是共享同一个日期/占位 id）
- 每日 daily plan panel 有当日待审 creative（客户或 PM 打勾）

**失败模式**：AI 编的 creative 客户没审就投出去 → 违反 master brief / 品牌事故；`creative_ref` 用日期而非内容 id → 同日多 variant 的 outcome 无法分别归因，A/B 结果合并或串线。
**ME 能力**：Meta Ads MCP（已有）· `ad_creative_links` + `src/lib/ads/creative-link.ts`（已有，Stage 09 直接复用）· TikTok Ads API adapter（待建）· `commerce_daily_v1` kind（待建，需补 variant id 分配与透传）。

### Stage 10 · 闭环运营（Outcome Loop）

**Purpose**：把订单结果回流 ME，反哺明天的选品打分与广告分配。**注意**：本 Stage 分两级完成判据（见下）——首单回流只算"数据管道就绪"，不能称为"Outcome Loop 完成"。
**Inputs**：三渠道订单数据。
**Actions**：
1. **Shopify webhooks** → orders table（❌ 待建：无 webhook 路由、无鉴权/幂等设计、无独立 `orders` 表 —— 见 `capability: shopify-order-ingestion`，需单独任务合同，不在本 spec 范围内实现）
2. **Trade Me webhooks** → orders table（新增）
3. **FBM 订单**：客户运营手工录入（无 API）→ orders table，录入入口见 `capability: fbm-order-entry`（❌ 待建，见 §2）——本 spec 之前只写"手工录入"没有落地入口，实施者只能让运营直接连数据库或订单留在平台外，聚合结果会系统性漏掉 FBM，v0.2.4 已在 §2 补上这个 capability
4. 每日 cron 聚合三渠道 → `outcomes` 表
5. Outcome 关联到"哪个 SKU + 哪个 channel + 哪个 creative + 哪个 fulfillment option 转化的"
6. 反哺：
   - SKU 打分权重（高转化的 SKU 加权，低转化的 SKU 降权或下架）
   - Creative 权重（高转化 creative 加投）
   - Fulfillment option 使用率（发现"上门送 $25"没人选就下掉）

**完成判据分两级，不得混用**（首单回流 ≠ 闭环跑通，两者是不同的完成状态）：

**Level A · 数据管道就绪**（首单即可达成，只证明"数据能进来"）：
- ≥1 单订单从 Shopify / Trade Me / FBM 任一渠道回流到 `outcomes` 表
- Outcome 字段完整（channel / creative_ref / fulfillment_option / net_profit_actual）
- 数据链路验证：可从 outcome 记录反查到 creative → campaign → SKU → supplier

**Level B · Outcome Loop 完成**（本 Stage Purpose 所述"反哺明天的选品打分与广告分配"真正达成，Level A 不能替代）：
- outcomes 累积到统计意义信号阈值（20-50 单，见下方启用条件）
- `enable_score_feedback` 开关已打开，且**至少一次**真实发生：某次 SKU 打分排序 / 广告预算分配 / fulfillment option 下架决策，因为反哺数据而与"仅按人工判断"不同 —— 需留痕（决策前后对比记录），不能只凭"理论上会生效"判定
- 未达到 Level B 前，不得对外或对 PM 报告"闭环已跑通"，只能报"数据管道已就绪，等待样本量"

**反哺打分启用条件**（Level B 的前置门槛）：等 outcomes 累积到"能得出统计意义信号"再定 —— 门槛（≥N 单、跨 ≥M channel、时间跨度）、`enable_score_feedback` 开关、单单极端值防护策略，全部等真实数据积累到 20-50 单时基于**观察**制定，不现在拍脑袋写死双 gate 抽象。

**失败模式**：
- 只有 Shopify 订单回流，Trade Me / FBM 订单成孤岛 → 打分反哺失真 → AI 越推越错
- 把 Level A（首单回流）误报成 Level B（闭环完成）→ PM 以为反哺已生效，实际排序/预算/停止决策还是纯人工

**ME 能力**：`capability: multi-channel-order-aggregator` + `capability: shopify-order-ingestion`（❌ 待建，见 §2）+ `capability: fbm-order-entry`（❌ 待建，v0.2.4 新增，见 §2）。
反哺算法本身（含启用门槛设计）留到 outcomes 累积后单独 spec，避免为零数据的场景过早写死抽象。

---

## 4. Data Model 契约

### 4.1 核心 enum

```ts
type SupplyMode = 'dropshipping' | 'self-procured' | 'hybrid'
type FulfillmentOption = 'local-pickup' | 'local-delivery' | 'nationwide-customer-paid'
type SignalSource = 'meta-ads' | 'trade-me' | 'shopify-trends' | 'tiktok-us' | 'google-trends'
type SupplierVerification = 'unverified' | 'gold' | 'verified' | 'audited'

// v0.2 新增（当前多品/多 tier 讨论就是 caller，保留）
type SkuCommodityTier = 'commodity' | 'specialty' | 'exclusive'
type ChannelKind = 'storefront' | 'trade-me' | 'facebook-marketplace'

// v0.2.1 撤回（无当前 caller）:
//   - StorefrontKind: Jing's Pick 用 Shopify，无第二客户 → Shopify-only for v0.x
//   - ListingStatus + OutcomeGateLevel: 零 listing / 零 outcome，抽象过早
// 未来触发条件（首次遇到）再引入，避免为想象场景写死枚举。
```

### 4.2 契约类型

```ts
interface NormalizedProductRecord {
  source: 'alibaba' | 'yiwugo' | 'made-in-china' | 'hktdc' | 'global-sources'
  sku_id: string
  sku_commodity_tier: SkuCommodityTier   // v0.2 新增
  title: string
  price_range: { min: number; max: number; currency: string }
  moq: number | null
  supplier_verification_level: SupplierVerification
  dropship_supported: boolean
  origin_city_cluster: string | null
  source_url: string
  fetched_at: string
  backup_procurement_note?: string       // v0.2 新增，exclusive tier 必填
}

interface DemandSignal {
  source: SignalSource
  market: string  // ISO2, e.g. 'NZ' | 'AU'
  signal_type: 'active_ad_count' | 'most_watched' | 'rising_query' | 'best_seller_rank'
  keyword_or_category: string
  magnitude: number
  top_advertisers?: string[]
  fetched_at: string
}

interface FulfillmentConfig {
  sku_id: string
  supply_mode: SupplyMode
  currency: string            // v0.2.2 新增，ISO 4217，来自 industry profile
  options: Array<{
    option: FulfillmentOption
    label: string
    fee: number   // 0 for pickup；单位 = FulfillmentConfig.currency
    availability: 'all' | { region: string[] }
  }>
  warehouse_address?: string  // 若 self-procured
  pickup_hours?: string       // 若 local-pickup 启用
}

// v0.2 改：dual-gate profit check；v0.2.2 改：币种无关，税率/阈值全部来自 industry profile
interface UnitEconomics {
  sku_id: string
  fulfillment_option: FulfillmentOption
  currency: string                       // v0.2.2 新增，ISO 4217，来自 industry profile
  tax_rate: number                       // v0.2.2 新增，from industry profile；v0.2.4 订正口径为百分数（NZ GST=15，同 CostAssumptions.gstRatePct，不是小数 0.15），其他市场不同
  price_incl_tax: number                 // v0.2.2 改名，原 price_incl_gst（GST 是 NZ 特有税种名）
  cost_landed: number
  freight_per_unit: number
  payment_fee: number
  fixed_opex: number
  ad_cost_estimated: number
  net_profit: number
  net_margin_pct: number                 // v0.2 新增
  gate_baseline: number                  // v0.2.2 改名，原 gate_baseline_nzd；from industry profile
  gate_min_margin_pct: number            // from industry profile
  gate_baseline_pass: boolean            // net_profit >= gate_baseline
  gate_margin_pass: boolean              // net_margin_pct >= gate_min_margin_pct
  passes_gate: boolean                   // baseline_pass AND margin_pass
  computed_at: string
}

interface Positioning {
  client_id: string
  one_liner: string   // "唯一 [独有能力] 的 [品类] 卖家"
  competitor_snapshot: Array<{ name: string; gap: string }>
  moat_type: 'physical-presence' | 'community' | 'category-narrative' | 'price-tier' | 'other'
}

// v0.2 改：outcome 用 ChannelKind enum；v0.2.2 改：金额字段币种无关
interface OutcomeRecord {
  order_id: string
  client_id: string
  sku_id: string
  channel: ChannelKind
  creative_ref: string | null
  fulfillment_option: FulfillmentOption
  currency: string            // v0.2.2 新增，ISO 4217
  gross_revenue: number       // v0.2.2 改名，原 gross_revenue_nzd
  net_profit_actual: number   // v0.2.2 改名，原 net_profit_actual_nzd
  fulfilled_at: string
}

// v0.2.1 撤回（无当前 caller）:
//   - StorefrontConfig: Shopify-only for v0.x，storefront 抽象等真第二个客户
//   - ListingHealth: 零 listing 存在，cron 监控设计等首个 listing 上线后再定
//   - ScoreFeedbackState: 零 outcome，反哺算法本身都没写，两级 gate 属超前抽象
// 保留 Stage 08 完成判据里的 expiry SQL（Trade Me 21d 是硬约束），足够指导 Stage 08 实施。
// 保留 Stage 10 单 gate = ≥1 单管道通，反哺启用条件等有数据后再定。
```

---

## 5. Stage 完成判据（硬指标汇总）

| Stage | 硬判据 | 检查 SQL / 命令 |
|---|---|---|
| 00 | `clients.client_status = 'active'`（拒绝案例 = `'archived'` + `qualification_note` 非空，该列待建） | `select client_status, qualification_note from clients where id = ?`（`qualification_note` 需先补 migration 才能跑） |
| 01 | 每候选 SKU 有 `supply_mode` + `sku_commodity_tier` 值 | `select sku_id, supply_mode, sku_commodity_tier from products where client_id = ? and supply_mode is not null and sku_commodity_tier is not null` |
| 02 | `demand_signals` 表有 ≥3 source 记录 + 本地竞对已识别 | `select count(distinct source) from demand_signals where sku_id = ?` |
| 03 | 按 SKU tier 满足最低供应商数 + exclusive 有 backup_procurement_note | v0.2 见下方 §5.1 分档 SQL |
| 04 | `unit_economics` 至少一行 `gate_baseline_pass AND gate_margin_pass` | `select * from unit_economics where sku_id = ? and gate_baseline_pass and gate_margin_pass` |
| 05 | `fulfillment_configs.options` ≥ 2 档 | `select jsonb_array_length(options) from fulfillment_configs where sku_id = ?` |
| 06 | `client_positioning.one_liner` 非空 + `moat_type` 非 'other' | `select one_liner, moat_type from client_positioning where client_id = ?` |
| 07 | `master_briefs` 6 必答栏无 UNKNOWN | `select * from master_briefs where client_id = ? and target_audience is not null and ...` |
| 08 | 三 channel listing HTTP 200 + 未过期（Trade Me/FBM 剩余 >7 天 · Shopify 非 archived/draft） | v0.2 见下方 §5.2 SQL |
| 09 | 每 channel ≥1 active campaign · 每 SKU ≥3 creative variant | `select count(*) from ad_campaigns where sku_id = ? and status = 'ACTIVE'` |
| 10 | Level A（数据管道就绪）：outcomes ≥1 单管道通 · Level B（Outcome Loop 完成）：需 20-50 单 + 至少一次真实反哺决策留痕，见 §3 Stage 10 | `select count(*) from outcomes where client_id = ? and creative_ref is not null and net_profit_actual is not null`（字段名随 §4.2 币种无关改动同步，见下） |

### 5.1 Stage 03 分档判据 SQL（v0.2 新增，v0.2.4 修正过滤条件）

**v0.2.3 修正**：以下 SQL 全部加上"合格供应商记录"过滤条件，且 `moq`/`price_range`/`dropship_supported` 三个关键字段均非 null。只统计记录数（不管字段是否完整）会让"抓到数量够但资料不全"的供应商也算过 gate，Stage 03 的 §3 完成判据必须体现在判据 SQL 里，不能只写在文字说明中。

**v0.2.4 修正**：过滤条件原写 `verification_level != 'unknown'`，但 §4.1 `SupplierVerification` enum 只有 `unverified` / `gold` / `verified` / `audited` 四个成员——`unknown` 不是合法值。若 `supplier_verification_level` 建成数据库 enum 类型，`!= 'unknown'` 这个条件本身就会因非法字面量报错；若退化成 text 列，`unverified`（未验证）又会被 `!= 'unknown'` 放行，等于把"没验证过的供应商"也算作过 gate。改为**正向名单**——只统计 `verification_level IN ('gold', 'verified', 'audited')` 这三个真正通过验证的档位，`unverified` 不计入合格供应商数：

```sql
-- 合格供应商记录的通用过滤条件（下方三段 gate SQL 共用）：
--   n.supplier_verification_level in ('gold', 'verified', 'audited')
--   and n.moq is not null
--   and (n.price_range->>'min') is not null and (n.price_range->>'max') is not null
--   and n.dropship_supported is not null

-- commodity 需 ≥3 家合格供应商
select p.sku_id, count(n.*) as supplier_count
from products p
left join normalized_product_records n on n.sku_id = p.sku_id
  and n.supplier_verification_level in ('gold', 'verified', 'audited')
  and n.moq is not null
  and (n.price_range->>'min') is not null and (n.price_range->>'max') is not null
  and n.dropship_supported is not null
where p.client_id = ? and p.sku_commodity_tier = 'commodity'
group by p.sku_id
having count(n.*) >= 3;

-- specialty 需 ≥2 家合格供应商
-- 同上 join 条件 · having count(n.*) >= 2 · where tier = 'specialty'

-- exclusive 需 ≥1 家合格供应商 + backup_procurement_note 非空
select p.sku_id
from products p
join normalized_product_records n on n.sku_id = p.sku_id
where p.client_id = ? and p.sku_commodity_tier = 'exclusive'
  and n.supplier_verification_level in ('gold', 'verified', 'audited')
  and n.moq is not null
  and (n.price_range->>'min') is not null and (n.price_range->>'max') is not null
  and n.dropship_supported is not null
  and n.backup_procurement_note is not null
  and n.backup_procurement_note != '';
```

供应商记录数据完整性最终应由 `normalized_product_records` 表的列约束（`supplier_verification_level` 设 `NOT NULL` + `check (supplier_verification_level in ('unverified','gold','verified','audited'))` 限定合法枚举值、`moq`/`dropship_supported` 设 `NOT NULL`）兜底，而不是只依赖查询时过滤——查询过滤只保证"判据 SQL 算得对"，表约束才能保证"脏数据写不进去"。表约束纳入建表 migration（见 §2.1）实施范围。

### 5.2 Stage 08 listing 未过期 SQL（v0.2 新增，v0.2.1 保留）

具体查询依赖各 marketplace API 返回的 listing metadata（Trade Me 有 `EndDate` 字段 · FBM 手动登记 `expires_at` · Shopify products 查 `status != 'archived'`）。首次 Stage 08 实施时按当时的实际 API shape 落 SQL；此处只保留判据文字，不预先写死表结构。

判据（人可读）：
- Trade Me：`listing.EndDate > now() + 7 days AND listing.HttpStatus = 200`
- FBM：`fbm_manual_listing.expires_at > now() + 7 days AND fbm_manual_listing.listing_url returns 200`
- Shopify：`product.status = 'active' AND product.published_at is not null`

---

## 6. Jing's Pick 转椅 Customer Zero 走查

以 Jing's Pick 首个转椅 SKU 演示 10 段的实际形态（详细数字见 `docs/clients/jingshop/` 未来客户档）：

| Stage | 状态 | 卡在什么上 |
|---|---|---|
| 00 | ⏳ Task #4 pending | Jingshop client 从 prospect → active 需 PM GO |
| 01 | ✅ 已确认 `self-procured` | — |
| 02 | ✅ 已完成 4 keyword 扫（office/gaming/ergonomic/desk chair）· 本地竞对 = Sihoo NZ | — |
| 03 | ⏳ Task #2 pending | 等供应商资料 → 补 3 家备选 |
| 04 | ⏳ Task #5 pending | 计算器加大件模式后可跑真数字 |
| 05 | ⏳ Task #6 pending | Auckland 3 选 1 · 已推荐 Checkout 三档 |
| 06 | ✅ 已确认 "华人叙事 + Mt Wellington 试坐展厅" 双 moat | — |
| 07 | ⏳ Task #3 pending | 起草 v1 |
| 08 | ⏳ 未开工 | 等 Task 2/3 完成后开 |
| 09 | ⏳ 未开工 | 等 Stage 08 |
| 10 | ⏳ 未开工 | 需 Stage 08/09 都通才有数据 |

---

## 7. 风险与审阅

**风险级别**：**B 级**（新平台能力设计，无 schema 破坏性变更，无对外新 endpoint 上线；具体 capability 实施走各自 A/B/C）

**必需审阅**：
- 本 spec 定稿前：**子牙（架构）+ 魏征（挑刺）**必须 2 审
- 后续每个 capability 实施 spec：单独走 2 审
- 触碰 clients / orders / outcomes schema 的实施 → A 级 · 加狄仁杰安全审
- 客户 C 端可见 UI → **加板桥非技术视角**

**Codex 边界**：
- Codex 可承担：单个 adapter 的 pure function 实现 + 单测 · scan.ts 打分权重调整 · migration 脚本编写（不含 apply）
- Codex 不承担：跨 capability 集成 · 客户 UI 决策 · A 级 schema 变更

---

## 8. Open Questions（等 triage 回答）

1. **Trade Me 开发者账号谁注册**？（技术侧 Ray 邮箱 vs 商务侧 Jing's Pick 主体）
2. **TikTok for Business API 申请路径**（Meta 已有 business portfolio，TikTok 未建）
3. **FBM 无 API 硬约束**：ME 生成"待发布内容包"→ 派给谁做（客户运营 / FDE / Ray 自己）
4. **多客户仓库分离**：Jing's Pick 用 Mt Wellington 展厅，未来客户 X 用悉尼仓库 → 是每客户独立 Shipping Zones 还是全局？
5. **Playbook 版本管理**：v0.1 是 Jing's Pick 走一遍出来的；v0.2 应该在什么触发条件下升级（第 2 个客户上线 → 差异抽出？）
6. **Outcome 回流打分权重**：转化数据反哺 SKU 打分的公式，需 PM 拍板"每单转化 = 加多少分"

---

## 9. 相关文档 / Issue

- [#1137 跨窗口洞察收件箱](https://github.com/bigbigraydeng-maker/magic-engine/issues/1137)（本 spec 的 INSIGHT-03 入口）
- PR #1000 ME Commerce Product Intelligence PoC
- #1159 CTS Facebook Daily review slice（Stage 09 复用骨架）
- [docs/roadmap/2026-08-19-me2-platformization-principle.md](../roadmap/2026-08-19-me2-platformization-principle.md)（Reuse First / 5 道 Build Gate）
- [docs/DECISIONS.md](../DECISIONS.md)（若 promote 后加决策记录）

---

## 10. Known Weaknesses & 变更历史

### v0.1 自审（2026-08-25）发现的 9 个漏洞

W1-W5 为结构性 · v0.2 已补齐 · W6-W9 为次要 · 留 v0.3。

### v0.2 → v0.2.1 变更（过度开发体检后收敛）

Stop hook 触发过度开发红灯后（净新增 1549 行 > 1500 阈值），按 `over-engineering-check` skill 口诀"没有当前 caller 就删"逐条复核 v0.2 的 W1-W5 fix：

| # | 原 fix | 当前 caller | v0.2.1 处置 |
|---|---|---|---|
| **W1** · Profit gate 函数式 | 当前 Top 10 里 $12-$140 多价段 SKU 就是 caller · 转椅 $120 品 + 讨论中 $500+ 高端 | ✅ **保留**：Stage 04 dual gate + `UnitEconomics.gate_baseline_pass/margin_pass` + industry profile 参数 |
| **W2** · Storefront-adapter 抽象 | Jing's Pick 用 Shopify · **零第二客户** · 全是想象将来 | ❌ **撤回**：删除 `StorefrontKind` enum + `StorefrontConfig` type + capability 命名 · Stage 08 回归 Shopify-only for v0.x |
| **W3** · Bootstrap/Operational 双 gate | **零单成交** · 反哺算法本身都没写 · 是纯超前抽象 | ❌ **撤回**：删除 `OutcomeGateLevel` enum + `ScoreFeedbackState` type + capability 命名 · Stage 10 回归单 gate + note "反哺启用条件等真实数据后单独 spec" |
| **W4** · SkuCommodityTier 分档 | 转椅(commodity) + 12生肖手串(exclusive) + 韩系护肤(specialty) 三档都在当前讨论 scope | ✅ **保留**：Stage 03 分档判据 + `SkuCommodityTier` enum + `backup_procurement_note` 字段 |
| **W5** · listing-health-monitor + expiry | **零 listing 存在** · cron 监控 + 任务派发是想象 · 但 expiry 判据本身是硬约束 | 🔀 **部分保留**：删除 `ListingHealth` type + `ListingStatus` enum + capability 命名 · **保留** Stage 08 完成判据里的 expiry 检查逻辑（Trade Me 21d 是硬约束） |

### v0.2.1 → v0.2.2 变更（Codex PR #1192 review round 1，4 个可执行 finding）

| # | 问题 | 处置 |
|---|---|---|
| **F1**（P1）· 共享金额契约硬编码 NZD/15% GST | `FulfillmentConfig` / `UnitEconomics` / `OutcomeRecord` 新增 `currency` 字段（`fee_nzd`→`fee`、`gate_baseline_nzd`→`gate_baseline`、`price_incl_gst`→`price_incl_tax`、`gross_revenue_nzd`/`net_profit_actual_nzd`→去 `_nzd` 后缀）；`UnitEconomics` 新增 `tax_rate`，与 `gate_baseline`/`gate_min_margin_pct` 一样全部来自 industry profile。Stage 04 公式改写为通用税率，NZ 具体数值只出现在 `commerce-market-nz` profile 示例里 |
| **F2**（P2）· Stage 00 用了不存在的 `status`/`declined`/`activation_note` | 改用仓库现有 `clients.client_status`（`20260801120000_clients_client_status.sql` 定义，枚举 active/prospect/archived）；拒绝态映射到 `archived`；拒绝原因列 `qualification_note` 明确标为待建（需独立 migration），不假装已存在 |
| **F3**（P2）· Stage 10 把 Shopify 订单接入当"现有"能力 | 改列 `capability: shopify-order-ingestion`（❌ 待建），写明仓库现状（无 webhook 路由 / `shopify-client.ts` 只处理 blog-page / 无 `orders` 表），要求单独任务合同覆盖 webhook + 鉴权 + 幂等 + 建表 |
| **F4**（P2）· 单笔订单就宣称 Outcome Loop 完成 | Stage 10 完成判据拆两级：Level A「数据管道就绪」（首单回流即可，即原判据）· Level B「Outcome Loop 完成」（需 20-50 单样本 + 至少一次真实反哺决策留痕），未达 Level B 不得对外称"闭环已跑通" |

### v0.2.2 → v0.2.3 变更（Codex PR #1192 review round 2，4 个可执行 finding）

| # | 问题 | 处置 |
|---|---|---|
| **G1**（P1）· Stage 00 准入预算硬编码 NZ$500 | 最低月广告预算移入 industry profile：新增 `min_monthly_ad_budget` 字段，与 `currency` 一起承载市场差异（同一 profile 文件，与 Stage 04 profit gate 参数共用）；NZ v1 profile 示例 `min_monthly_ad_budget: 500` |
| **G2**（P1）· Commerce SKU 持久化依赖未声明 | 新增 §2.1「表结构待建声明」，逐一确认 `products`/`demand_signals`/`normalized_product_records`/`unit_economics`/`fulfillment_configs`/`client_positioning`/`ad_campaigns`/`outcomes` 均为待建表（全仓检索无一条对应 migration），并指出 `master_briefs.products` 是 JSON 列不能替代独立 `products` 表、`content_demand_signals` 与待建 `demand_signals` 用途不同不可混用 |
| **G3**（P1）· FBM 人工发布任务缺 what/how/href | Stage 08 Action 3 补齐三件套：`what`（问题+影响）· `how`（逐步操作到"填哪个字段"级别）· `href`（FBM 创建 listing 直达链接），并写入 `marketplace-adapter` capability 的输出契约，缺一不算下发完成 |
| **G4**（P2）· 供应商 gate SQL 只统计记录数 | §5.1 三段 SQL 全部加上 `verification_level != 'unknown'` + MOQ/price/dropship 非 null 的过滤条件；并注明最终应由 `normalized_product_records` 表约束兜底数据完整性，查询过滤不能替代表约束 |

### v0.2.3 → v0.2.4 变更（Codex PR #1192 review round 3，5 个可执行 finding）

| # | 问题 | 处置 |
|---|---|---|
| **H1**（P1）· score.ts/landed-cost.ts "只换 profile 代码不动"的承诺不成立 | 全仓核实 `landed-cost.ts` 字段全带 `Nzd` 后缀、`gstRatePct` 按百分数（`scan-request.ts` 的 `ASSUMPTION_RANGES` 校验区间 `[10,20]`）、`scan-request.ts` 的 `SUPPORTED_MARKETS` 硬编码只有 `['NZ']`、`score.ts` 的 `gateAuNzSearched`/`gateNoDumping` 直接绑定 AU/NZ 需求与本地倾销判断——这套是 NZ market profile 专用实现，不是币种/市场无关的通用计算器。§2 reuse 表、Stage 04、§4.2 `UnitEconomics.tax_rate` 均订正：①口径改百分数（`15` 不是 `0.15`）对齐现有代码；② AU/SG/MY 复用需先补 `capability: commerce-market-adapter`（§2 新增，待建），不是改个 profile 数值就行 |
| **H2**（P2）· `SupplierVerification` 枚举与 gate SQL 字面量不一致 | enum 只有 `unverified`/`gold`/`verified`/`audited`，没有 `unknown`；§5.1 SQL 与 Stage 03 判据原文用 `!= 'unknown'`（enum 列会报错、text 列会误放行 `unverified`），改为正向名单 `verification_level in ('gold','verified','audited')`，并同步表约束建议改成 `check (... in ('unverified','gold','verified','audited'))` |
| **H3**（P1）· creative variant 缺稳定身份 | Stage 09 新增"Creative variant 稳定身份"小节：复用已合的 `ad_creative_links` 表（`(client_id, platform, ad_id)` 唯一键 → `creative_ref`），要求各生成入口（`daily-plan.ts` 等）把 `creative_ref` 落成真实内容 id 而非 `bundle.date` 日期字符串；完成判据补上"每个 variant 有独立 `ad_id → creative_ref` 行"这一条 |
| **H4**（P1）· FBM 库存同步无持续人工闭环 | Stage 08 新增"FBM 库存持续闭环"小节：库存同步 cron 每次检测到差异 >1 都必须下发独立三件套任务（不只首次发布时下发一次），或改用渠道预留库存模型；完成判据/失败模式/ME 能力同步补充 |
| **H5**（P1）· FBM 订单录入无产品入口 | §2 新增 `capability: fbm-order-entry`（❌ 待建）；Stage 10 Action 3 与"ME 能力"行同步指向该 capability，不再只写"手工录入"这句无落地路径的话 |

### v0.3 待处理（W6-W9）· 首个 WP 开完再看

- **W6**：`demand-signal-adapter` 内含 5 source —— capability 拆分粒度是"每 source 独立" vs "1 adapter + strategy pattern"？影响 WP 拆分节奏。
- **W7**：`positioning-differentiator (AI 辅助)` 定义太虚，缺输入输出契约与决策边界。
- **W8**：Meta Ads `ads_create_campaign` 能否被 ME 后端 **headless 调用**（无 human-in-loop）需实测；memory 只有搜索类的证据。
- **W9**：5 家死平台黑名单硬编码 spec 里 —— 应建 `capability: platform-health-monitor` 季度重扫，spec 只写 pattern 不写具体名单。

### 成熟度

- **v0.1**：够送 triage，不够开 build
- **v0.2**：够开 build 但含超前抽象 → 体检红灯
- **v0.2.1**：够开 build 且已收敛（W1/W4 保留、W2/W3 撤回、W5 部分保留 · W6-W9 次要不阻塞首个 WP）
- **v0.2.2**：**修完 Codex round 1 的 4 个可执行 finding**（币种契约、client_status 字段、Shopify 订单接入待建标注、Outcome Loop 两级判据）
- **v0.2.3**：**修完 Codex round 2 的 4 个可执行 finding**（准入预算 profile 化、表结构待建声明、FBM 人工任务三件套、供应商 gate SQL 字段完整性）
- **v0.2.4**：**修完 Codex round 3 的 5 个可执行 finding**（score.ts/landed-cost.ts 订正为 NZ profile 专用实现 + 待建 market-adapter、供应商验证枚举统一、creative variant 稳定身份、FBM 库存持续人工闭环、FBM 订单录入 capability）
- **v0.3**：完善所有 W1-W9，成为稳定 baseline，进 `docs/history/CHANGELOG.md`

---

## 11. Reuse Statement（最终 · v0.2.4）

- **复用**：`scan.ts` / `score.ts` / `landed-cost.ts`（**v0.2.4 订正**：NZ market profile 专用实现，非市场无关）/ `daily-plan.ts` / `ad_creative_links` + `src/lib/ads/creative-link.ts`（v0.2.4 新增识别为可复用）/ `master_briefs` / `clients` / Meta Ads MCP / Shopify MCP
- **platform-shared 新增**（v0.2.4 收敛后）：
  - 10 段 flow 结构 · 每段硬完成判据（Stage 03/08 部分依赖首次实施时的 API shape 落细；Stage 09 补 creative variant 稳定身份；Stage 10 拆 Level A/B 两级）
  - **10 个 capability 契约**（v0.1 的 6 个 + v0.2 保留 1 个 + v0.2.2 新增 1 个 + v0.2.4 新增 2 个 · v0.2.1 撤回 3 个）：
    - Existing/待建: `supply-mode-tagger` · `demand-signal-adapter` · `product-catalog-adapter` · `fulfillment-model-configurator` · `positioning-differentiator` · `marketplace-adapter` · `multi-channel-order-aggregator` · `shopify-order-ingestion`（v0.2.2 新增，❌ 待建，见 §2）· `commerce-market-adapter`（v0.2.4 新增，❌ 待建，AU/SG/MY 接入 `score.ts` 前置依赖，见 §2）· `fbm-order-entry`（v0.2.4 新增，❌ 待建，见 §2）
    - v0.2.1 撤回（零 caller，等触发条件出现再引入）：~~`storefront-adapter`~~ · ~~`listing-health-monitor`~~ · ~~`score-feedback-orchestrator`~~
  - **6 个 enum**（v0.1 的 4 + v0.2.1 保留 2）：`SupplyMode` · `FulfillmentOption` · `SignalSource` · `SupplierVerification`（v0.2.4 起判据/SQL 统一用正向名单 `gold`/`verified`/`audited`，不再引用不存在的 `unknown` 值）· `SkuCommodityTier`(W4) · `ChannelKind`
    - v0.2.1 撤回：~~`StorefrontKind`~~(W2) · ~~`ListingStatus`~~(W5) · ~~`OutcomeGateLevel`~~(W3)
  - **6 个数据类型**（v0.1 的 6 + v0.2 改 2 + v0.2.2 改 3 + v0.2.4 改 1）：`NormalizedProductRecord`（+ sku_commodity_tier + backup_procurement_note W4）· `DemandSignal` · `FulfillmentConfig`（+ currency，v0.2.2）· `UnitEconomics`（dual-gate 改 W1 + 币种无关改 v0.2.2 + `tax_rate` 口径订正为百分数 v0.2.4）· `Positioning` · `OutcomeRecord`（用 ChannelKind + 币种无关改 v0.2.2，`creative_ref` 须落真实内容 id v0.2.4）
    - v0.2.1 撤回：~~`StorefrontConfig`~~(W2) · ~~`ListingHealth`~~(W5) · ~~`ScoreFeedbackState`~~(W3)
- **industry-specific 新增**：
  - `commerce-market-nz`（`currency=NZD` · `tax_rate=15`（百分数，GST，v0.2.4 订正口径）· **准入门槛** `min_monthly_ad_budget=500` · CPC 基线 · 季节反季 · **profit-gate 参数** `baseline=15, min_margin_pct=12`）—— v0.2.2 起币种/税率/阈值全归 profile，v0.2.3 起准入预算门槛也归 profile，shared 类型/逻辑不再硬编码；**v0.2.4 订正**：目前只有这个 NZ profile 能直接驱动 `score.ts`（该实现是 NZ-only 代码，非通用计算器）
  - `commerce-market-au` / `-sg` / `-my`：各自定义 `currency`/`tax_rate`/`baseline`/`min_margin_pct`/`min_monthly_ad_budget`，复用同一 `UnitEconomics`/`OutcomeRecord` 类型与 Stage 00 准入逻辑；**但要真正跑 `score.ts` 打分，需先补 `commerce-market-adapter`**（v0.2.4 新增待建 capability），profile 数值本身不能让 NZ-only 代码变成市场无关
  - `commerce-source-cn`（中国供应源）· `commerce-source-premium`（精品源）
- **client-specific**：Jing's Pick 供应商合作记录、私价、SKU 库存 —— 落 `client_configuration` 与 `client_private_memory`
- **红线**：无客户名 / 客户 ID / 华人叙事 / NZ 独有判断进 shared runtime；未来 ME Commerce AU / SG / MY 复用同 flow，但接入现有 `score.ts` 打分链路除换 profile 外还需 `commerce-market-adapter` 落地（v0.2.4 订正，不是"只换 profile 代码不动"）

—— END v0.2.4 —— 
