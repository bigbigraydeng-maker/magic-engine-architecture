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

**但这是 Shopify 平台 2026 年默认给所有店开的，不是 Aelfric Eden 的功劳。**
真正的含义反过来更重要：**所有 Shopify 客户的"AI 导购渠道"已经默认打开了** —— 这件事该进 ME 的 AI 可见度支柱测量口径（见 §7.5）。

---

## 2. 转化栈：22 个第三方，每个都在干活

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

**读法**：这是一套非常完整的 Gen Z DTC 转化栈，没有一个是装着好看的。特别注意 **Triple Whale + 反点击欺诈** 的组合 —— 说明他们的广告投放是按真实利润在管，不是按平台报的 ROAS。

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

**结论：大促不是通过改商品价实现的，是通过购物车层的折扣叠加引擎（Stack Discounts）实现的。**

好处有三条，条条是可复制的规则：
1. **商品原价锚不塌** —— 长期挂划线价会训练用户"不打折不买"
2. **促销一键开关**，不用批量改 969 个 SKU 的价格
3. **不污染商品数据** —— 商品 feed 给到 Meta / Google Shopping / AI agent 的价格是干净的

---

## 6. 他们做错的（别抄 —— 而且 ME 能自动抓出来）

### 6.1 🔴 全站商品结构化数据评分为 0

抽样 7 个商品页（含 6 个 best-sellers），JSON-LD 里的 `aggregateRating` **全部是**：

```json
{"@type": "AggregateRating", "ratingValue": 0, "ratingCount": 0}
```

Loox 的评价是客户端渲染的，但服务端交给 Google 的结构化数据是一个**无效评分**。
后果：**969 个商品页全部拿不到搜索结果里的星级富摘要**，还可能被判为无效结构化数据。这是主题层的 bug，改一处全站生效。

### 6.2 🔴 商品页没有 hreflang

7 个货币、全球发货，商品页却只有 canonical，**没有任何语言/地区 alternate**。多市场站点的基本功缺失。

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

## 7. 映射到 ME 6 支柱 —— 能变成产品规则的 5 条

| # | 发现 | 支柱 | ME 该怎么做 |
|---|---|---|---|
| 1 | 创作者专属 collection | 社媒 + 归因 | **进 ME 电商版 Playbook 标准动作**：每个合作创作者建一个 collection + 独立 UTM，Outcome 走现有 attribution 能力验证。这是既有能力的场景应用，不新增能力线 |
| 2 | 上新节奏喂内容 | 社媒 | 内容排产的输入从"想主题"改成"读客户的上新 feed"。ME 已有内容工厂，加一个 `products.json` 上新监听即可 |
| 3 | 促销走叠加不改价 | 广告 + 口碑 | **Playbook 规则**：促销一律用 Shopify automatic discount，禁止批量改 `compare_at_price`。理由是保护商品 feed 干净 + 保护价格锚 |
| 4 | aggregateRating=0 / 缺 hreflang / sitemap 垃圾 | SEO | **三条都可自动检测**。ME 已有 Site Analyzer，加三条 check 就能对任意 Shopify 店出诊断报告 —— 属于既有 SEO 能力的规则扩展 |
| 5 | Shopify 默认开了 UCP / agents.md | AI 可见度 | AI agent 现在能直接在 Shopify 店里搜品、建车、结账。**ME 的 AI 可见度测量口径要加一维：AI agent 能不能买到你** —— 不只是"AI 提不提你" |

> §7.4 的三条自动检测规则可以直接开成 issue，我可以出提案。

---

## 8. 给 Magic Picks（ME Commerce Customer Zero）的落地建议

⚠️ 前置约束（来自既有认知）：Magic Picks 是 **NZ 市场 + 华人叙事 + Mt Wellington 展厅 + hybrid 供应链**，NZ 电商销售渠道只有三个（独立站 + Trade Me + FBM）。

### 可移植 ✅
- **创作者专属 collection** —— NZ 本地 KOC 体量小，2000 粉门槛甚至可以再降
- **促销走叠加不改价** —— 零成本，今天就能定成规矩
- **PDP 文案结构化模板** —— 直接抄 `Details / Composition & Care / Size & Fit` 三段式
- **UGC 图片评价**（Loox 一类）—— 华人客群对"真人实拍"敏感度更高
- **BNPL** —— NZ 市场 Afterpay/Laybuy 普及度高，对客单价有实际拉动

### 不可移植 ❌
- **每月 176 个新品** —— AE 是自有快时尚供应链；Magic Picks 是 hybrid 供货，硬追节奏会烧死现金流
- **学生 30% off** —— AE 靠的是美国大学生规模；NZ 大学生盘子太小，ROI 不成立
- **自有 App** —— 流量体量没到，不要碰

### 立刻能做的三件（不花钱）
1. 谈 5–10 个奥克兰本地 KOC，**一人建一个 collection**，一人一个 UTM
2. 所有促销改走 Shopify automatic discount，**不动 compare_at**
3. 定 PDP 文案模板，新品一律套

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
- **industry-specific（L2）**：§7 的 5 条规则、§5 的"促销不改价"规则 —— 归属 ME 电商版 Playbook
- **client-specific（L4）**：§8 Magic Picks 的落地建议
- **有没有把客户名 / 客户 ID / 行业判断写进 shared runtime**：没有。本文件在 `docs/strategy/`，不进 `src/lib/`
- **落点与 tier-gate 决策是否一致**：一致。决策时判为"竞对研究 → 喂 L2 Playbook，不新增能力线、不动 shared runtime"，实际落点即 `docs/strategy/` 单篇研究文档，无代码路径变更
- **学习升级边界**：§7 的 5 条目前只有 1 个观察样本，**留在行业级（L2）**，不升 global memory；§7.4 的三条 SEO 检测规则如要落成 ME 能力，需另开提案走既有 SEO 能力扩展路径
