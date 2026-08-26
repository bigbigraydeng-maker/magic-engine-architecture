# Spec：ME Commerce 客户 Onboarding Playbook v0.2.1

- **日期**：2026-08-25（v0.1 → v0.2 → v0.2.1 收敛版）
- **owner**：Claude Code 主导编排；提炼自 Ray 与 Claude Code 就 Jing's Pick 转椅 SKU 的实操会话
- **首个跑通对象**：Jing's Pick（`71b5ec11-…`，client status: prospect → active 待 PM GO）— 作为 ME Commerce Customer Zero
- **风险级别**：**B 级**（新平台能力设计，无 schema 破坏性变更，无对外新 endpoint 上线；具体 capability 实施走各自的 A/B/C 风险闸）
- **审阅状态**：DRAFT v0.2.1 · 待 Codex/构建控制在 [#1137](https://github.com/bigbigraydeng-maker/magic-engine/issues/1137) triage → 若 promote 后开正式任务合同并送子牙（架构）+ 魏征（挑刺）2 审
- **Implementation Authorized**：**NO**（本文档只是 spec，不动 code / schema / migration / 部署）
- **v0.2 变更**：修 v0.1 自审出的 W1-W5 五个结构性漏洞。
- **v0.2.1 变更**（过度开发体检后收敛）：v0.2 的 W2/W3 fix 属"为想象未来需求提前抽象，零 caller"，撤回；W5 的 capability 命名撤回，保留 expiry 检查 SQL；W1/W4 fix 有真实 caller（多价段 + 多 tier SKU 都在当前讨论），保留。详见 §10 变更历史 + [docs/history/over-eng-log.md](../history/over-eng-log.md)。

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
| `src/lib/commerce/product-intel/scan.ts` + `score.ts` + `normalize.ts` | ✅ 已合（PR #1000）| 现有选品扫描骨架，本 playbook 的 Stage 02 / 04 直接接入 |
| `src/lib/campaign/daily-plan.ts` + `CampaignDailyPlanPanel.tsx` | ✅ 已合（#1159）| Stage 09（推广渠道 creative 生成）复用其 kind pattern，新增 `commerce_daily_v1` |
| Meta Ads Library MCP `ads_library_search` | ✅ 已实测通（2026-08-25 会话）| Stage 02 需求信号主入口 |
| Shopify MCP | ✅ 已连（memory 有能力边界文档）| Stage 08 独立站主渠道 |
| `master_briefs` 表 | ✅ 已有 | Stage 07 直接复用 |
| `capability: product-catalog-adapter`（Alibaba/Yiwugo/MIC/HKTDC/Global Sources）| ❌ 待建 | 已在 #1137 INSIGHT-01 立案 |
| `capability: demand-signal-adapter`（Meta Ads/Trade Me/Shopify Trends）| ❌ 待建 | 已在 #1137 INSIGHT-01 立案 |
| `capability: marketplace-adapter`（Trade Me / FBM 内容包）| ❌ 待建 | 本 spec 首次提出 |
| `capability: fulfillment-model-configurator` | ❌ 待建 | 本 spec 首次提出 |
| `capability: multi-channel-order-aggregator` | ❌ 待建 | 本 spec 首次提出 |

**platform-shared**：10 段流程结构、capability 契约、Stage 完成硬判据、gate 逻辑。
**industry-specific**（`industry-playbook/commerce-*`）：
- `commerce-market-nz`：NZ 单件利润模型、GST 15%、CPC 基线、季节反季日历
- `commerce-market-au` / `commerce-market-sg` / …：未来复用同一 adapter，只换 profile
- `commerce-source-cn`：中国供应链源组合与 5 家死平台黑名单
- `commerce-source-premium`：Global Sources / HKTDC / MIC 精品源组合

**client-specific**（`client_configuration` + `client_private_memory`）：具体 supplier 合作记录、私有价格、退货政策、SKU 库存。

**红线检查**：任何"NZ 卖家专属"判断、任何"华人客户"定位、任何"Jing's Pick"字样，不得进 shared runtime。明天把 Jing's Pick 换成任意电商客户，这套 playbook 只换 profile 与 client config，不改 code。

---

## 3. 10-Stage Onboarding 流程

### Stage 00 · 客户准入（Qualification）

**Purpose**：判断这个客户是否适合走 ME 电商版。
**Inputs**：客户来源（自助注册 / FDE 引入 / 自营 Customer Zero）· 预算 · 目标市场 · 团队资源。
**Actions**：
1. 客户在 `clients` 表登记，`status = 'prospect'`
2. FDE / PM 面谈，判断是否满足最低门槛（月广告预算 ≥ NZ$500 · 有客服 · 有决策人）
3. 通过 → status = 'active'；不通过 → status = 'declined' + 原因

**完成判据**：`clients` 表 status = 'active'，`activation_note` 有明确原因。
**失败模式**：把 prospect 当 active 用 → 后续 stage 全跑通但客户根本没准备好履约。
**ME 能力**：现有 `clients` 表，可能加一列 `commerce_readiness_score`。

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

- 每家供应商的 `verification_level` 明确（不是 unknown）
- MOQ / price / dropship 三个关键字段无 null

**失败模式**：
- 只找一家 commodity 供应商 → 谈价无筹码 / 突涨价无 fallback
- exclusive tier 没写 backup_procurement_note → 主供应商掉线时无预案，等于把命脉交给对方

**ME 能力**：`capability: product-catalog-adapter`（5 家 P0 源共用）+ `sku_commodity_tier` 字段（Stage 01 或早段打标）。

### Stage 04 · 单品经济性 gate（Unit Economics）

**Purpose**：这个 SKU 卖出去到底赚不赚钱。不看毛利率百分比或净利绝对值单一维度 —— **两者都要 pass**。
**Inputs**：进价 / 头程物流 / 售价含 GST / 广告费预估 / 支付通道费率 / 固定运营成本 · industry profile 的 gate 参数。
**Actions**：
1. 按 `supply_mode` 展开对应模型：
   - `dropshipping`：进价 + 直送客户家（无内陆）→ 最好经济性
   - `self-procured` + 自提：进价（含 landed to 客户仓库）+ 无派送
   - `self-procured` + 内陆送：进价 + 派送费
   - `self-procured` + 非本地客户付运费：进价 + 客户付
2. 公式：`净利 = 售价 - GST(15/115) - 货成本 - 派送 - 支付通道 - 固定运营 - 广告费`
3. **Profit Gate 公式**（v0.2 改为函数式，不再 flat）：
   ```
   PROFIT_GATE(price) = max(BASELINE_NZD, price × MIN_MARGIN_PCT)
   ```
   由 industry profile 承载具体数值。**NZ 市场 v1 profile**：
   ```
   commerce-market-nz:
     baseline_nzd: 15      # 绝对底线（防止 $30 品也能过 12% 但只赚 $3.6）
     min_margin_pct: 12    # 相对底线（防止 $500 品只赚 $15 但风险巨大）
   ```
   实际门槛：`max($15, price × 0.12)` —— NZ$45 品需过 $15、NZ$120 品需过 $15、NZ$300 品需过 $36、NZ$500 品需过 $60。
4. 输出：每 SKU × 每 fulfillment 组合的**具体数字**（不是"大概能赚"），带 `gate_baseline_pass` + `gate_margin_pass` 两个布尔
5. Web 版计算器（已建，需加"大件模式" `Task #5`）供人工现场测算，UI 显示"过 $ gate + 过 % gate + 综合过 gate"三个徽章

**完成判据**：候选 SKU 至少一种 fulfillment 组合满足 `gate_baseline_pass AND gate_margin_pass`（两个都必须过）。不过就打回 Stage 03 找更便宜供应商 / 或打回客户谈涨价。

**失败模式**：
- 忽略 GST / payment gateway 费 / 广告费只看毛利 → 上线才发现单件亏钱
- 只用 flat 门槛（v0.1 的错） → $30 品刚过 $15 gate 但 margin 只有 3%，一次退货就赔穿；$500 品被 $15 gate 放行但需 3% margin 是极大风险

**ME 能力**：计算器逻辑嵌入 `score.ts`；industry profile 承载 `baseline_nzd` + `min_margin_pct` 两个参数，未来 AU/SG/MY 换 profile 即可。

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
3. **Facebook Marketplace**：**无官方 API 是硬约束** → ME 生成"待发布内容包"（图 + 中英标题 + 定价 + 地点）→ 派给客户运营人手工发（今日待办栏）· 需额外**养号 SOP**（多号并行 · listing 差异化 · refresh 节奏 · 客服中转号）· 实测 Jing's Pick 已用 FBM 卖出 30 把转椅证明渠道可行
4. 每个渠道 listing 差异化：独立站主视觉 + 长描述 · Trade Me 强调"试坐/自提" · FBM 走"Auckland local pickup" 抓 local shopper

**完成判据**（v0.2 加强 expiry 检查，v0.2.1 保留）：
- 三个渠道的 listing 各满足：
  - HTTP 200 响应活着
  - listing 未过期：**Trade Me listing 剩余寿命 > 7 天**（21 天默认周期硬约束）· **FBM listing 剩余寿命 > 7 天**（30 天周期）· **Shopify listing 非 archived / 非 draft**
- listing 描述 grounding master brief（不是 AI 编 —— 抽样人审 3 条 listing 都命中 master brief 关键卖点）
- 库存数一致（Shopify 主 = Trade Me 同步 = FBM 手动标注）· 差异 ≤ 1（允许 1 件误差因手工上）

**失败模式**：
- 只查 HTTP 200 忽略过期 → 客户点进已过期 Trade Me listing 得 404 → 广告费白花 + 品牌信任崩
- 三渠道超卖（客户下单当天两个渠道同时售出但只有 1 件库存）

**ME 能力**：`capability: marketplace-adapter`（Trade Me 自动 + FBM 内容包生成）· 库存同步 cron。
Expiry 探测与续期任务下发的具体实现（cron 频率、任务派发路径、`ListingHealth` 表 schema）等 Stage 08 真实施到"第一个 Trade Me listing 上线"时再落细，避免为想象场景写死设计。

### Stage 09 · 推广渠道矩阵（Ad Channels）

**Purpose**：把流量导到 Stage 08 的 listings。
**Inputs**：SKU · Master Brief · Stage 06 positioning · 每月广告预算。
**Actions**：
1. **FB Ads**：Meta MCP 建 campaign（现有 `ads_activate_entity` 等能力）
2. **TikTok Ads**：TikTok for Business API（需申请接入）
3. **Creative**：复用 `#1159 → commerce_daily_v1` kind 骨架，每天生成 post / story / reel 草稿
4. **Budget allocator**：每 channel 每 SKU 预算分配（初始按 50/50 或 70/30 分，看 outcome 调整）
5. **Retargeting**：Shopify pixel + FB pixel + TikTok pixel 三向联动

**完成判据**：
- 每 channel 至少 1 个 active campaign
- 每 SKU 至少 3 个 creative variant 跑 A/B
- 每日 daily plan panel 有当日待审 creative（客户或 PM 打勾）

**失败模式**：AI 编的 creative 客户没审就投出去 → 违反 master brief / 品牌事故。
**ME 能力**：Meta Ads MCP（已有）· TikTok Ads API adapter（待建）· `commerce_daily_v1` kind（待建）。

### Stage 10 · 闭环运营（Outcome Loop）

**Purpose**：把订单结果回流 ME，反哺明天的选品打分与广告分配。
**Inputs**：三渠道订单数据。
**Actions**：
1. **Shopify webhooks** → orders table（现有）
2. **Trade Me webhooks** → orders table（新增）
3. **FBM 订单**：客户运营手工录入（无 API）→ orders table
4. 每日 cron 聚合三渠道 → `outcomes` 表
5. Outcome 关联到"哪个 SKU + 哪个 channel + 哪个 creative + 哪个 fulfillment option 转化的"
6. 反哺：
   - SKU 打分权重（高转化的 SKU 加权，低转化的 SKU 降权或下架）
   - Creative 权重（高转化 creative 加投）
   - Fulfillment option 使用率（发现"上门送 $25"没人选就下掉）

**完成判据**：
- ≥1 单订单从 Shopify / Trade Me / FBM 任一渠道回流到 `outcomes` 表
- Outcome 字段完整（channel / creative_ref / fulfillment_option / net_profit_actual）
- 数据链路验证：可从 outcome 记录反查到 creative → campaign → SKU → supplier

**反哺打分启用条件**：等 outcomes 累积到"能得出统计意义信号"再定 —— 门槛（≥N 单、跨 ≥M channel、时间跨度）、`enable_score_feedback` 开关、单单极端值防护策略，全部等真实数据积累到 20-50 单时基于**观察**制定，不现在拍脑袋写死双 gate 抽象。

**失败模式**：
- 只有 Shopify 订单回流，Trade Me / FBM 订单成孤岛 → 打分反哺失真 → AI 越推越错

**ME 能力**：`capability: multi-channel-order-aggregator`。
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
  options: Array<{
    option: FulfillmentOption
    label: string
    fee_nzd: number   // 0 for pickup
    availability: 'all' | { region: string[] }
  }>
  warehouse_address?: string  // 若 self-procured
  pickup_hours?: string       // 若 local-pickup 启用
}

// v0.2 改：dual-gate profit check
interface UnitEconomics {
  sku_id: string
  fulfillment_option: FulfillmentOption
  price_incl_gst: number
  cost_landed: number
  freight_per_unit: number
  payment_fee: number
  fixed_opex: number
  ad_cost_estimated: number
  net_profit: number
  net_margin_pct: number                 // v0.2 新增
  gate_baseline_nzd: number              // from industry profile
  gate_min_margin_pct: number            // from industry profile
  gate_baseline_pass: boolean            // net_profit >= gate_baseline_nzd
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

// v0.2 改：outcome 用 ChannelKind enum
interface OutcomeRecord {
  order_id: string
  client_id: string
  sku_id: string
  channel: ChannelKind
  creative_ref: string | null
  fulfillment_option: FulfillmentOption
  gross_revenue_nzd: number
  net_profit_actual_nzd: number
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
| 00 | `clients.status = 'active'` + `activation_note` 非空 | `select status, activation_note from clients where id = ?` |
| 01 | 每候选 SKU 有 `supply_mode` + `sku_commodity_tier` 值 | `select sku_id, supply_mode, sku_commodity_tier from products where client_id = ? and supply_mode is not null and sku_commodity_tier is not null` |
| 02 | `demand_signals` 表有 ≥3 source 记录 + 本地竞对已识别 | `select count(distinct source) from demand_signals where sku_id = ?` |
| 03 | 按 SKU tier 满足最低供应商数 + exclusive 有 backup_procurement_note | v0.2 见下方 §5.1 分档 SQL |
| 04 | `unit_economics` 至少一行 `gate_baseline_pass AND gate_margin_pass` | `select * from unit_economics where sku_id = ? and gate_baseline_pass and gate_margin_pass` |
| 05 | `fulfillment_configs.options` ≥ 2 档 | `select jsonb_array_length(options) from fulfillment_configs where sku_id = ?` |
| 06 | `client_positioning.one_liner` 非空 + `moat_type` 非 'other' | `select one_liner, moat_type from client_positioning where client_id = ?` |
| 07 | `master_briefs` 6 必答栏无 UNKNOWN | `select * from master_briefs where client_id = ? and target_audience is not null and ...` |
| 08 | 三 channel listing HTTP 200 + 未过期（Trade Me/FBM 剩余 >7 天 · Shopify 非 archived/draft） | v0.2 见下方 §5.2 SQL |
| 09 | 每 channel ≥1 active campaign · 每 SKU ≥3 creative variant | `select count(*) from ad_campaigns where sku_id = ? and status = 'ACTIVE'` |
| 10 | outcomes ≥1 单管道通 · 反哺算法启用条件等真实数据后单独 spec | `select count(*) from outcomes where client_id = ? and creative_ref is not null and net_profit_actual_nzd is not null` |

### 5.1 Stage 03 分档判据 SQL（v0.2 新增）

```sql
-- commodity 需 ≥3 家供应商
select p.sku_id, count(n.*) as supplier_count
from products p
left join normalized_product_records n on n.sku_id = p.sku_id
where p.client_id = ? and p.sku_commodity_tier = 'commodity'
group by p.sku_id
having count(n.*) >= 3;

-- specialty 需 ≥2 家
-- 同上 having count(n.*) >= 2 · where tier = 'specialty'

-- exclusive 需 ≥1 家 + backup_procurement_note 非空
select p.sku_id
from products p
join normalized_product_records n on n.sku_id = p.sku_id
where p.client_id = ? and p.sku_commodity_tier = 'exclusive'
  and n.backup_procurement_note is not null
  and n.backup_procurement_note != '';
```

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

### v0.3 待处理（W6-W9）· 首个 WP 开完再看

- **W6**：`demand-signal-adapter` 内含 5 source —— capability 拆分粒度是"每 source 独立" vs "1 adapter + strategy pattern"？影响 WP 拆分节奏。
- **W7**：`positioning-differentiator (AI 辅助)` 定义太虚，缺输入输出契约与决策边界。
- **W8**：Meta Ads `ads_create_campaign` 能否被 ME 后端 **headless 调用**（无 human-in-loop）需实测；memory 只有搜索类的证据。
- **W9**：5 家死平台黑名单硬编码 spec 里 —— 应建 `capability: platform-health-monitor` 季度重扫，spec 只写 pattern 不写具体名单。

### 成熟度

- **v0.1**：够送 triage，不够开 build
- **v0.2**：够开 build 但含超前抽象 → 体检红灯
- **v0.2.1**：**够开 build 且已收敛**（W1/W4 保留、W2/W3 撤回、W5 部分保留 · W6-W9 次要不阻塞首个 WP）
- **v0.3**：完善所有 W1-W9，成为稳定 baseline，进 `docs/history/CHANGELOG.md`

---

## 11. Reuse Statement（最终 · v0.2.1）

- **复用**：`scan.ts` / `daily-plan.ts` / `master_briefs` / `clients` / Meta Ads MCP / Shopify MCP
- **platform-shared 新增**（v0.2.1 收敛后）：
  - 10 段 flow 结构 · 每段硬完成判据（Stage 03/08 部分依赖首次实施时的 API shape 落细）
  - **7 个 capability 契约**（v0.1 的 6 个 + v0.2 保留 1 个 · v0.2.1 撤回 3 个）：
    - Existing: `supply-mode-tagger` · `demand-signal-adapter` · `product-catalog-adapter` · `fulfillment-model-configurator` · `positioning-differentiator` · `marketplace-adapter` · `multi-channel-order-aggregator`
    - v0.2.1 撤回（零 caller，等触发条件出现再引入）：~~`storefront-adapter`~~ · ~~`listing-health-monitor`~~ · ~~`score-feedback-orchestrator`~~
  - **6 个 enum**（v0.1 的 4 + v0.2.1 保留 2）：`SupplyMode` · `FulfillmentOption` · `SignalSource` · `SupplierVerification` · `SkuCommodityTier`(W4) · `ChannelKind`
    - v0.2.1 撤回：~~`StorefrontKind`~~(W2) · ~~`ListingStatus`~~(W5) · ~~`OutcomeGateLevel`~~(W3)
  - **6 个数据类型**（v0.1 的 6 + v0.2 改 2）：`NormalizedProductRecord`（+ sku_commodity_tier + backup_procurement_note W4）· `DemandSignal` · `FulfillmentConfig` · `UnitEconomics`（dual-gate 改 W1）· `Positioning` · `OutcomeRecord`（用 ChannelKind）
    - v0.2.1 撤回：~~`StorefrontConfig`~~(W2) · ~~`ListingHealth`~~(W5) · ~~`ScoreFeedbackState`~~(W3)
- **industry-specific 新增**：
  - `commerce-market-nz`（GST 15% · CPC 基线 · 季节反季 · **profit-gate 参数** `baseline_nzd=15, min_margin_pct=12`）
  - `commerce-source-cn`（中国供应源）· `commerce-source-premium`（精品源）
- **client-specific**：Jing's Pick 供应商合作记录、私价、SKU 库存 —— 落 `client_configuration` 与 `client_private_memory`
- **红线**：无客户名 / 客户 ID / 华人叙事 / NZ 独有判断进 shared runtime；未来 ME Commerce AU / SG / MY 复用同 flow 只换 profile

—— END v0.2.1 —— 
