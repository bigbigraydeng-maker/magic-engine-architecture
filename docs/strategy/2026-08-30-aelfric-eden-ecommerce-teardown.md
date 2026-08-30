# Aelfric Eden 拆解 —— ME 电商版学习案例

**扫描日期**：2026-08-30 · **目标**：https://www.aelfriceden.com
**用途**：喂 ME Commerce Playbook（L2 行业剧本）· 不是客户交付物 · 不进 shared runtime

---

## 一句话结论

Aelfric Eden 不是"社媒做得好的独立站"，是**一台把创作者内容工业化成商品页流量的机器**：
969 个在售商品配 1247 个 collection，其中 44+ 个 collection 直接以创作者的社媒账号命名 —— **每个合作创作者都有一个属于自己的落地页**。
支撑它的是每月约 176 个新品的上新节奏（8 月实测）—— 内容不用"想创意"，上新本身就是内容供给。

**值得抄的是机制，不是审美。** 而且他们的 SEO 技术底子有三处明显破洞，正好是 ME 能自动检测出来的东西。

---

## 0. 扫描口径（可复核）

| 项 | 做法 |
|---|---|
| 时间 | 2026-08-30（站点 edge 响应时间 2026-08-29 23:37 UTC，NZ 节点） |
| 站点结构 | 直接抓 HTML + HTTP headers；sitemap 四张表全量计数 |
| 商品数据 | `products.json?limit=250&page=1`（最新 250 个商品 / 1429 个变体）全量统计 |
| 结构化数据 | 随机抽 7 个商品页（含 6 个 best-sellers）解析 JSON-LD |
| 页面内容 | `/pages/*` 正文抓取（our-story · rewards · shipping · college-ambassador · tiktok-ig-trending-now） |
| **没做** | 付费流量估算 · 社媒 API 真实互动数据 · 竞品价格追踪 |

> 社媒数字全部来自公开报道，**标注为未证实**，见 §9。

---

## 1. 平台与技术底座（实测）

- **Shopify**（`powered-by: Shopify`），Cloudflare 前置，自定义主题（The4 系，theme id `150741188770`）
- 默认 `localization=US`；支持 7 个货币：USD / EUR / GBP / CAD / AUD / KRW / JPY
- **规模**：969 商品 · **1247 collection** · 111 独立页 · 博客只有 1 个索引页（最后更新 2024-03-15 = 已废弃）
- 自有 **iOS + Android App**（首页挂"下载 App 额外 10% off"）

### 关于 agents.md / llms.txt / UCP —— 别误读

站点有 `/agents.md`、`/llms.txt`、`/.well-known/ucp` 和一个 UCP MCP 端点，支持 AI agent 直接搜商品、建购物车、走结账。

**本次只扫描了 Aelfric Eden 这一家店，尚不能确认这是 Shopify 平台 2026 年默认给所有店开的能力，还是这家店自己额外配置的** —— 需要查 Shopify 官方文档或再扫几家兼容店铺才能定论。
如果确认是平台默认，含义会反过来更重要：**Shopify 客户的"AI 导购渠道"可能已经默认打开** —— 这件事可以进 ME 的 AI 可见度支柱测量口径的候选维度（见 §7.5），但目前只能算本站观察，不能当平台级事实使用。

---

## 2. 转化栈：检测到 22 个第三方脚本/工具

| 类别 | 用的什么 | 作用 |
|---|---|---|
| UGC 评价 | **Loox** | 买家图片/视频评价，社媒调性一致 |
| 邮件/短信 | **Omnisend** | 订阅送 10% off，弃单挽回 |
| 网页推送 | **PushOwl** | 上新/补货推送 |
| 积分会员 | **Smile.io** | AE Membership，积分 1 年有效，到期前 30 天 + 3 天两次邮件提醒 |
| 加购搭售 | **Selleasy / LB Upsell** | 购物车加价购 |
| 紧迫感 | **Hextom Ultimate Sales Boost** + **Countdown Timer** | 库存条、倒计时 |
| **折扣引擎** | **Stack Discounts (MerchantYard)** | 购物车层折扣叠加 —— 见 §5，这是关键 |
| 退货保障 | **Seel** | Worry-Free Purchase Protection |
| 客服 | **Re:amaze** | |
| 多语 | **GTranslate** | |
| 导航/弹窗 | **Qikify** | 首屏"专属 L/XL 优惠"弹窗 |
| 分期付款 | **Klarna + Sezzle** | Gen Z 客单价 $80 的关键 |
| 像素 | **TikTok Multi-Pixels · Pinterest Multi-Pixels · GTM** | 多像素并行 |
| 归因/利润 | **Triple Whale** | 广告花费与真实利润对账 |
| 行为分析 | **Contentsquare / Hotjar** | 录屏与热图 |
| 反欺诈 | **config-security** | 广告点击欺诈 / 机器人防护 |

**读法**：本次口径只抓了站点 HTML / headers 里出现的脚本与 config 标记，**只能证明这些第三方的代码存在于页面上，不能证明全部 22 个工具都在生产环境实际启用、配置完整或按预期在跑**——没有检查付费流量、广告账户后台或实际投放策略。

**推测（未验证）**：Triple Whale + 反点击欺诈脚本同时出现，*可能*说明广告投放参考了真实利润而非单纯平台报的 ROAS，但这条因果关系本次没有验证——没有登录广告账户核实归因模型、也没有核对实际的出价/预算策略，检测到代码存在最多只能证明"这两个工具被接入了"，不能证明"广告是按真实利润在管"。在实际查看广告账户配置或与客户确认前，只按推测使用，不当结论引用。

---

## 3. 社媒 → 独立站的四条真实通道（最值得抄的部分）

### 3.1 创作者专属 collection ⭐ 核心机制

`/collections/<创作者账号>` —— 实测 44+ 个此类 handle，全部返回 200：
`theonlyhavenz` · `samanthapartida` · `mimi_furu` · `princecarneiro_` · `aestones` · `xxi_zhen` · `savzz__` · `the0nlyyonii` · `iaam_jordan` · `i_am_bridge` · `isidora__villagra` · `limitededitionn__` …

**为什么这招狠**：
1. 创作者发内容 → 落到"以他名字命名的页" → **归因天然干净**（一个 URL 一个人）
2. 创作者有面子 —— 品牌给他建了个"专属店中店"，合作意愿和续约率都会高
3. 页面是**长期资产**，帖子过期了页面还在，还能被搜索和 AI 引用

### 3.2 可购物社媒墙

`/pages/tiktok-ig-trending-now` —— 把 TikTok / IG 上的创作者内容做成网格，每一格挂**一个产品页**或**那个创作者的 collection**。桌面端一行 4 个。
把"社媒上看到的那身"变成一次点击可买，不需要用户去翻商品目录。

### 3.3 College Ambassador（用货换持续 UGC）

实测条款：
- **门槛**：18 岁以上大学生 · 社媒账号必须公开 · **≥2000 粉丝**
- **给什么**：免费独家款 · 官方账号 feature · 创意支持 · 给粉丝的专属折扣码
- **要求**：收货后 **10–15 天内**必须发；高清图/视频；必须带 `#aelfriceden` 并 @`aelfricedenofficial`；**主题不限**
- **审批周期**：两周

**关键设计**：门槛只有 2000 粉。他们要的不是大 KOL，是**数量 × 真实感**。而且"主题不限"，把创意成本完全外包给了创作者。

### 3.4 三个长在 Gen Z 场景里的入口

- **学生 30% off**（需验证身份）
- **下载 App 额外 10% off**
- **Discord 社群领免费样品**（`Get Free Sample` 直接跳 Discord）

社群不是发公告的地方，是**领货入口** —— 所以人愿意留在里面。

---

## 4. 供给侧：内容之所以永远有的讲（实测数据）

| 指标 | 实测值 |
|---|---|
| 最新 250 个商品的发布月份 | 全部在 2026-07 与 2026-08 —— **其中 176 个在 8 月上架** |
| 折算上新节奏 | **约每天 5–6 个新品** |
| 平均图片数 | 7.1 张 / 商品 |
| 平均变体数 | 5.7 个 / 商品（Color × Size 为主，牛仔裤走 Color × Waist） |
| 商品文案 | 统一模板：`Details & Construction` / `Composition & Care` / `Size & Fit` |
| 品类分布（250 个样本） | Hoodies 56 · Pants 51 · Sweaters 26 · Cardigans 23 · Jackets 19 · Jeans 18 · Tees 14 |

**这才是社媒能持续产出的真正原因**：内容团队不需要"想主题"，每天有 5–6 个新品自动变成 5–6 个选题。
**社媒表现好 ≠ 内容团队厉害，而是上新节奏在喂内容。**

---

## 5. 价格与折扣：大促不改价 ⭐

| 指标 | 实测值（1429 个变体） |
|---|---|
| 价格分布 | min $9.95 · p25 $69.95 · **中位 $79.95** · p75 $89.95 · max $149.95 |
| 价格尾数 | 全部 `.95` |
| **真实降价的变体** | **只有 86 个**（compare_at > price），中位降幅 20%，最深 51% |
| compare_at = 售价（无实际折扣） | **1323 个** |
| 无 compare_at | 20 个 |

同时首页挂着 **"Back to School Sale: Up to 40% Off"** + 倒计时 + "学生专享 30% off" + "App 额外 10% off"。

**推测（未验证）：大促很可能不是通过改商品价实现的，而是通过购物车层的折扣叠加引擎（Stack Discounts）实现的。**
本次扫描没有实际走一遍加购/结账流程，也没有读取活动折扣配置——检测到 Stack Discounts 这款 App 存在、同时首页有促销文案，只能证明两者同时存在，**不能证明促销就是由这个 App 实现的**。该店也可能同时用 Shopify 原生 automatic discount、折扣码或分群定价来做促销。这条因果关系需要实际触发一次促销并核对折扣配置后才能确认，在此之前只按推测使用。

如果这个机制成立，好处有三条，条条是可复制的规则：
1. **商品原价锚不塌** —— 长期挂划线价会训练用户"不打折不买"
2. **促销一键开关**，不用批量改 969 个 SKU 的价格
3. **不污染商品数据** —— 商品 feed 给到 Meta / Google Shopping / AI agent 的价格是干净的

---

## 6. 他们做错的（别抄 —— 而且 ME 能自动抓出来）

### 6.1 🔴 抽样商品页结构化数据评分为 0（7/969，未验证全站）

抽样 7 个商品页（含 6 个 best-sellers），JSON-LD 里的 `aggregateRating` **全部是**：

```json
{"@type": "AggregateRating", "ratingValue": 0, "ratingCount": 0}
```

Loox 的评价是客户端渲染的，但服务端交给 Google 的结构化数据是一个**无效评分**。
**范围订正**：本次只解析了 7 个商品页（含 6 个 best-sellers），这 7 个页面全部拿不到搜索结果里的星级富摘要，还可能被判为无效结构化数据。**未抽样的商品页可能使用不同模板 / 评价状态 / JSON-LD 注入路径**，不能据此断言全部 969 个商品页都受影响，也不能直接定性为"全站主题 bug"——如果确认是同一主题模板统一渲染，需要先扫描全部商品 URL 或至少扩大抽样后再报告全站数量。

### 6.2 🟡 商品页没有语言 / 地区 alternate URL（不等同于"缺 hreflang bug"）

7 个货币、全球发货，商品页却只有 canonical，**没有观察到任何语言/地区的独立 URL 变体**（该店是同一 URL 下切换货币 / 客户端翻译）。

**订正**：`hreflang` 是给"同一内容的不同语言/地区 URL"之间做双向标注的，如果站点根本没有可索引的本地化 URL（例如货币切换和翻译都发生在同一 URL 上，用 query/cookie 而非路径/子域区分），那么"缺 hreflang"本身就不成立，也不该作为自动检测规则直接套用到任意 Shopify 店——会对这类站点产生误报。**正确的检测顺序应该是**：先探测是否存在独立的本地化 URL（如 `/en-au/`、`?locale=`对应的可索引路径等），如果存在再检查这些 URL 之间是否有完整的双向 `hreflang` 集群；本次扫描没有做前一步，因此这一条目前只能算"未观察到本地化 URL"，不能定性为"多市场站点基本功缺失"。

### 6.3 🔴 1247 个 collection 里大量内部垃圾被公开索引

| 类型 | 数量 | 例子 |
|---|---|---|
| 纯数字 handle | 63 | `011` `012` `125` `222` |
| 内部季节 / SKU 码 | 217 | `ss22-22052` · `post20220102` · `ss21-part8` |
| test / untitled / 过期活动 | 14 | `test` · `test-1` · `shop-test` · `untitled3-22` · `promotion-ended` · `black-friday-2022` |
| **中文内部 handle** | 8 | `毛衣标签检查` · `网红墙1` · `bogo50限量` · `124新品t` |

**内部运营台账漏进公网 sitemap** —— 稀释抓取预算，而且把内部流程（标签检查、网红墙编号）暴露给任何人。

### 6.4 🟡 博客彻底停更

`sitemap_blogs_1.xml` 只剩一个索引页，`lastmod 2024-03-15`。
他们的内容 SEO 完全押在 collection 页和 campaign 页（`campaign-1970s` / `campaign-1980s` / Encyclopedia of Style）上。
**这条对时尚品类可能成立，但不能当通用结论抄** —— 品类有强"决策前搜索"行为的（家装、旅游、地产、B2B），停掉博客等于自断 AI 引用来源。

### 6.5 🟡 Product schema 的 `mpn` 是空字符串

小问题，但在 Google Merchant Center 会报警。

---

## 7. 映射到 ME 6 支柱 —— 5 条待验证研究候选（⚠️ 单店观察，未晋升为行业规则）

⚠️ **以下 5 条全部只有 Aelfric Eden 这一个观察样本支撑，是研究候选（research candidate），不是可下发的 L2 行业规则。** 在有第二、第三个兼容电商店铺的实测数据 + Outcome 证据支持前，**不得**当成 Playbook 标准动作对客户执行，也不得写入 shared runtime 或作为通用检测口径直接上线。

| # | 发现 | 支柱 | 候选方向（待多店验证后才能晋升为规则） |
|---|---|---|---|
| 1 | 创作者专属 collection | 社媒 + 归因 | 候选：每个合作创作者建一个 collection + 独立 UTM，Outcome 走现有 attribution 能力验证。若属实，是既有能力的场景应用，不新增能力线 |
| 2 | 上新节奏喂内容 | 社媒 | 候选：内容排产的输入从"想主题"改成"读客户的上新 feed"，用 ME 已有内容工厂加一个 `products.json` 上新监听验证 |
| 3 | 促销走叠加不改价（机制未验证，见 §5） | 广告 + 口碑 | 候选：促销与改价分离，避免批量改 `compare_at_price`；具体走 Shopify automatic discount 还是折扣码/分群定价，需先在本店触发一次促销核实配置，再在其他店验证该模式确实优于改价促销 |
| 4 | aggregateRating=0 / 缺 hreflang / sitemap 垃圾 | SEO | 候选检测方向，但**不能直接照搬为通用规则**——见 §6.2 的 hreflang 适用条件订正与 §6.1 的抽样范围订正，需先扩大抽样、明确适用前提 |
| 5 | Shopify 默认开了 UCP / agents.md | AI 可见度 | 候选：AI agent 能不能买到你，作为 AI 可见度测量口径的候选新维度，需在多店确认该行为是 Shopify 平台默认而非个案 |

> §7.4 的检测方向若要开成 issue 落地，必须先在多个兼容店铺验证，且需按 §6.1 / §6.2 的订正范围收窄适用条件，不能直接以本文档口径出提案。

**候选登记**：以上 5 条已作为 L2 Playbook 候选登记进 [`docs/registry/platform-candidates.md`](../registry/platform-candidates.md)，复查提醒同步进 [`src/lib/pm-todo/platform-candidate-reviews.ts`](../../src/lib/pm-todo/platform-candidate-reviews.ts)（复查日 2026-09-30）。后续第二、第三家兼容电商店铺出证据时，直接更新该表的"硬证据进度"列，不要另开新文档。

---

## 8. 给 Jing's Pick（ME Commerce Customer Zero）的落地建议

⚠️ 前置约束（来自既有认知）：Jing's Pick 是 **NZ 市场 + 华人叙事 + Mt Wellington 展厅 + hybrid 供应链**，NZ 电商销售渠道只有三个（独立站 + Trade Me + FBM）。

### 可移植 ✅
- **PDP 文案结构化模板** —— 直接抄 `Details / Composition & Care / Size & Fit` 三段式
- **UGC 图片评价**（Loox 一类）—— 华人客群对"真人实拍"敏感度更高
- **BNPL** —— NZ 市场 Afterpay/Laybuy 普及度高，对客单价有实际拉动

### 待小范围验证后再推广 ⚠️
- **创作者专属 collection** —— §7 已把这条列为**待多店证据支撑的 L2 研究候选**，本次扫描没有评估 Jing's Pick 自己的创作者资源、KOC 联系/礼品成本或现有归因基线，**不能"立刻"批量对接 5–10 个 KOC 逐一建 collection**。改成带基线和 Outcome 判据的小范围实验：先谈 2–3 个奥克兰本地 KOC（不是 5–10 个），建 collection 前先记录这几位创作者当前的归因基线（没有专属 collection 时，其内容带来的流量/转化怎么算），设定成本上限（礼品/佣金预算），跑 4–6 周后用 ME 现有 attribution 能力对比"专属 collection 页"与"泛列表页"的转化差异，验证通过、且有第二个可比店铺的证据后再扩大到更多创作者，且需按 §7 的候选复查流程更新证据
- **促销走叠加不改价** —— §5 的因果机制未验证，且本次扫描没有评估 Jing's Pick 自己的促销组合、利润结构和商品 feed 分发渠道，**不能直接定成规矩下发**。改成小范围实验：挑 1 个即将上线的促销，先用 Shopify automatic discount（不动 `compare_at`）跑一次，**不能直接拿"上一次改价促销"当对照**——两次活动在商品、折扣力度、季节、流量结构和预算上都不同，差异无法归因到折扣机制本身。要么在同一活动内做同期 A/B（同一批商品随机分成 automatic discount 组与改价组），要么退而求其次用匹配 cohort，并在实验设计里先写死匹配条件（同品类、同折扣力度、同投放预算量级、季节可比）与归因限制。观察毛利率、转化率、Meta/Google Shopping feed 价格是否干净；**达不到上述对照条件的结果只能当方向性参考，不得作为 Playbook 证据**

- **学生 30% off（待客户数据验证的假设，非结论）** —— AE 的学生盘子建立在美国大学生规模上。本次扫描对象是 AE，§0 已声明未查付费流量、§9 已声明未查营收与转化率，也没有测量 Jing's Pick 自己的学生受众规模、毛利结构或获客成本，**因此"NZ 盘子太小、ROI 不成立"目前只是假设，不能据此直接筛掉这个促销方案**。要判断，先补三个数：目标区域在校学生可触达规模、该客群预估毛利、以及现有渠道下的获客成本；补齐后再决定列入可移植还是不可移植

### 不可移植 ❌
- **每月 176 个新品** —— AE 是自有快时尚供应链；Jing's Pick 是 hybrid 供货，硬追节奏会烧死现金流
- **自有 App** —— 流量体量没到，不要碰

### 立刻能做的一件（不花钱）
1. 定 PDP 文案模板，新品一律套

---

## 9. 未证实 / 没查的（别当事实引用）

| 项 | 状态 |
|---|---|
| Instagram 粉丝 | 公开报道口径不一致：**100 万 ~ 130 万** · 未用 API 核实 |
| TikTok 粉丝 | 公开报道约 **35 万** · 未核实 |
| "TikTok 8 亿 / 9 亿曝光"、"2023 年 10 亿曝光" | **品牌方自述口径**，无第三方证据 |
| 营收 / 转化率 / 客单价 | 未查 |
| 自然搜索流量 / 关键词排名 / 外链 | **未查** —— 本会话没走付费数据源。ME 的 SEO 数据源是 DataForSEO，需要真实流量与关键词数据请说一声 |

品牌自述里可核实的部分：2014 年创立于加州 San Marino / LA，亚裔美籍创始人，slogan `MAKE WAVES NOT RULES`，2024 年改版推出 Encyclopedia of Style 系列（70s boho / 80s grunge / 90s baggy）。

---

## Reuse Statement

- **复用了什么已有平台能力**：无代码改动。本次只做外部研究，产出为 L2 Playbook 的输入素材
- **platform-shared**：无
- **industry-specific（L2 候选，待多店验证）**：§7 的 5 条研究候选、§5 的"促销不改价"规则 —— 归属 ME 电商版 Playbook 输入素材，尚未晋升为可下发规则
- **client-specific（L4）**：§8 Jing's Pick 的落地建议
- **有没有把客户名 / 客户 ID / 行业判断写进 shared runtime**：没有。本文件在 `docs/strategy/`，不进 `src/lib/`
- **落点与 tier-gate 决策是否一致**：一致。决策时判为"竞对研究 → 喂 L2 Playbook，不新增能力线、不动 shared runtime"，实际落点即 `docs/strategy/` 单篇研究文档，无代码路径变更
- **学习升级边界**：§7 的 5 条目前只有 1 个观察样本，**留在行业级（L2）**，不升 global memory；§7.4 的三条 SEO 检测规则如要落成 ME 能力，需另开提案走既有 SEO 能力扩展路径
