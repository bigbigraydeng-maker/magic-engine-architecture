# Bamwave（www.bamwave.co.nz）新西兰市场调研

> **内部文档，不直接交付客户。** 调研日期：2026-08-09 · 阶段：DAPE 第一段「发现」+ 第二段「分析」
> 六大支柱关联：SEO · AI 可见度 · 竞品 · 社媒 · 广告
> 业务轨道：待定（见 §8 待客户确认清单）
>
> **数据来源标注规则**：每条结论后面标 `[实测]`（我们自己跑接口拿到的数字）/ `[公开源]`（可查的第三方公开资料，附链接）/ `[推断]`（基于前两者的判断，不是事实）/ `[未获取]`（没拿到，**不等于客户没有**）。
> **本报告仍然没有拿到任何客户自有数据**，客户产品线、价格、认证、产能全部为空 —— 缺口逐项见 §9，要问客户的问题见 §8 和 §9.3。
>
> **更新记录**
> - `2026-08-09` 首轮：市场侧完成（§3–§7）。官网被网络出口拦截，客户侧全空。
> - `2026-08-09` 二次补充：**再次尝试打开官网，仍被拦截**（证据见 §2）。新增 §9「客户侧现状」，把缺口、网站体检的判定标准、以及可直接发给客户的问题邮件全部写死，让客户侧的推进**不再依赖官网能不能打开**。市场侧数字未作任何改动。
> - `2026-08-09` 三次核查：**更正 §2 的两处判断**。①「外网出口整个是关着的」不成立 —— 对照测试 `github.com` 是通的，真实情况是白名单太窄。②「开个新会话就能生效」同样不成立 —— PM 添加域名后，**两个不同会话分别实测，均仍被拒**。故障原因**尚未定位**，§2 已改为如实记录、不给未经验证的解法。仅改 §2，市场侧内容未动。

---

## 1. 一句话结论

**新西兰"竹子外卖盒"这个生意，靠搜索引擎拉客户是拉不动的（全国精准商业搜索一个月只有约 2,000–2,500 次），但正因为对手也都很弱，花很小的钱就能把搜索这块占住。真正能撑起增长的是 B2B 直销 + 社媒种草 + 分销渠道，搜索只做"临门一脚"的成交护栏。**

最值钱的一个发现在 §4：**新西兰把"可降解塑料/植物基塑料"也一并禁了，但竹纤维不是塑料，不在禁令范围内。** 市面上大量餐厅老板被这条法规搞糊涂了 —— 这是 Bamwave 最锋利的销售话术和内容切入点，目前没有对手在系统性地讲这件事。

---

## 2. 先说一个卡点（需要你动手）

> **状态：未解决。** 第一次尝试 2026-08-09（首轮调研），第二次尝试 2026-08-09（本轮补充），**两次都被同一个原因挡住**。

**问题**：我**还是没能打开 www.bamwave.co.nz**。不是网站有问题，也**不是只有这一个域名被挡** —— 这个工作环境用的是一份**「只放行少数几个网址」的白名单**，`bamwave.co.nz` 不在里面。

> **更正**（2026-08-09 第三次核查）：本节早先写的「外网出口整个是关着的」**不准确**。实测 `github.com` 是通的（见下表），所以出口没有全关，是白名单太窄。
>
> **同时要说清楚一件事**：PM 已经把 `bamwave.co.nz` 加进名单了，但此后**两个不同会话分别实测，仍然被拒**。所以「加完开个新会话就好」这个推测**也被证伪了**。**故障原因目前没有定位**，本节只如实记录测到了什么，不给未经验证的解法 —— 见下方「怎么做」。

**这次的实测证据**（`[实测]`，可复现）：

| 试了什么 | 结果 | 说明什么 |
|---|---|---|
| 抓取 `www.bamwave.co.nz` | 被出口代理拒绝 | 拿不到官网 |
| 抓取 `example.com`（全世界最普通的测试网址） | **同样被拒绝** | **不是这个域名的问题**，白名单窄到连它都不放行 |
| 抓取 `github.com`（对照组） | **通了**，服务器有回应 | **出口没有全关** —— 是白名单太窄，不是网络故障 |
| PM 把 `bamwave.co.nz` 加进名单后再测（两个不同会话各测一次） | **两次都仍然 403** | **加了没生效，原因未定位** —— 不要再假设「开新会话就好」 |
| 命令行直连上面两个网址 | 均返回 `CONNECT tunnel failed, response 403` | 连接在代理层就被切断，没到网站 |
| 检查代理自身状态 | 运行正常，无故障记录 | **不是代理坏了，是这个环境的网络策略设置** |
| 网页搜索（走的另一条通道，可用） | 搜 `bamwave.co.nz`、`site:bamwave.co.nz`、`Bamwave` 三种搜法，**均无该网站的任何结果** | 见下方注 |
| Semrush 外链库查该域名 | `NOTHING FOUND`，无任何记录 | 该域名在 Semrush 里没有任何可查数据 |

> 注：网页搜索工具用的是**美国索引**，所以"搜不到"**不能**当作"这个网站在新西兰没被谷歌收录"的证据，只能说明它在美国索引里没有存在感。真正的收录情况必须等能打开官网后用新西兰数据实测。**这一条不要对外引用。**

**影响**：客户到底卖哪几款盒子、多大规格、什么价、有没有堆肥认证、内壁有没有塑料淋膜、面向餐厅还是散客 —— 这些我**一个字都没编**（按红线规矩，编了就是害客户）。所以本报告到目前为止只覆盖**市场和对手**，不含**客户自己**那一半。缺什么、怎么补，见 §9。

**怎么做**（二选一，哪个快选哪个）：

- **A**：放行 `bamwave.co.nz` —— **但这条已经试过，且尚未成功，别再空等它**
  → 路径：**https://claude.ai/settings/code** → 找到本项目的环境 → 网络访问设置 → 加入该域名
  → **已知事实**：PM 已于 2026-08-09 添加过该域名。此后**两个不同的会话**（`…01Rc1f` 与 `…01TC8V`）分别测试，**均仍返回 403**。
  → 所以「加完开个新会话就好」这个说法**证据不支持**。真正原因还没定位，可能是设置没保存成功、可能是环境本身要重建、也可能是名单更新有延迟。
  → **要往下走，必须先有人确认这个设置到底存没存上**，而不是继续开新窗口碰运气。

- **B（不依赖 A，建议现在就做）**：**§9.2 里我已经把要问客户的问题写成了可以直接发的英文邮件**，复制粘贴发给客户就行。客户回了，我照样能补齐 —— 而且客户亲口说的比官网写的更可靠（尤其是塑料淋膜那条）。

---

## 3. 市场盘子有多大

| 指标 | 数字 | 来源 |
|---|---|---|
| 新西兰餐饮业总营业额（截至 2025 年 6 月的一年） | **159.9 亿纽币**，同比 +1.4% | [公开源](https://restaurantandcafe.co.nz/hospitality-report-details-industry-climb/) |
| 其中**外卖/takeaway** 板块 | **44 亿纽币**，同比 **+3.2%**（增速是堂食的 10 倍） | [公开源](https://restaurantandcafe.co.nz/hospitality-report-details-industry-climb/) |
| 餐饮业直接雇佣人数 | 约 145,000 人 | [公开源](https://restaurantandcafe.co.nz/hospitality-report-details-industry-climb/) |
| 独立门店（非连锁）占比 | **67.95%** | [公开源](https://www.mordorintelligence.com/industry-reports/newzealand-foodservice-market) |
| 增长最快的区域 | Nelson +15.1% · Queenstown-Lakes +14.2% · Kaikōura +10.2% | [公开源](https://restaurantandcafe.co.nz/hospitality-report-details-industry-climb/) |

**这三个数字最重要**：

1. **外卖在涨，堂食基本不涨**（+3.2% vs +0.3%）。外卖盒的需求跟着外卖走，是顺风盘。`[公开源 + 推断]`
2. **近 7 成是独立小店**。这意味着不存在"搞定 3 个大客户就吃饱"的捷径，必须打**多、小、散**的客户群 —— 决定了打法必须是可规模化的获客（社媒 + 分销 + 自助下单），而不是纯人肉销售。`[公开源 + 推断]`
3. **Queenstown / Nelson 这类旅游区增长最猛**，而旅游区的商家对"环保形象"的付费意愿明显高于普通商圈（游客看得见）。**建议把首批地推资源压在 Queenstown-Lakes 和 Nelson，而不是奥克兰**。`[推断]`

---

## 4. 监管环境 —— 这是 Bamwave 最大的一张牌

### 4.1 事实

新西兰《Waste Minimisation (Plastic and Related Products) Regulations 2022》分三批禁塑：

| 时间 | 禁了什么 |
|---|---|
| 2022-10-01 起 | 第一批 |
| 2023-07-01 起 | 一次性塑料果蔬袋、**塑料餐盘、碗、刀叉勺** |
| 2025-07-01 起 | 所有 PVC 和硬质聚苯乙烯（发泡塑料）的食品饮料包装 |

`[公开源]`：[Retail NZ 禁塑时间表](https://retail.kiwi/advice/new-zealand-plastics-phase-out/) · [Detpak 新西兰禁塑说明](https://www.detpak.com/sustainability/single-use-problematic-plastics/new-zealand/)

**关键的一条**：这套禁令**把"可堆肥塑料 / 植物基塑料"也一起禁了**（只有产品标签除外）。也就是说，餐厅**不能拿 PLA 这类"可降解塑料"当替代品**去顶替被禁的塑料餐具。`[公开源]`

### 4.2 为什么这对 Bamwave 是好事

**竹子是纤维，不是塑料。** 禁令针对的是"塑料及含塑料产品"，竹纤维/甘蔗渣纤维这类植物纤维模塑产品不在被禁之列。`[公开源 + 推断]`

**这意味着一句可以反复讲的话**：

> "你以为换成可降解塑料就安全了？新西兰连可降解塑料一起禁了。竹子不是塑料，所以它不受这条禁令影响。"

**为什么这条现在还是空白**：市面上主流对手（见 §6）的宣传重心都在"compostable / 可堆肥认证"上，而"可堆肥"恰恰是被这条法规**咬到的那个词**，讲多了反而给客户制造混淆。**没有人在系统性地讲"纤维 ≠ 塑料"这个区分。** 这是内容和销售话术上的一块无人区。`[推断]`

> ⚠️ **动手前必须让客户/律师确认**：Bamwave 具体产品的材料构成（纯竹纤维？有没有 PE / PLA 淋膜？）。**只要盒子内壁有塑料淋膜，上面这套话术全部作废，还有法律风险。** 这条列进 §8 待确认清单第 1 位。

### 4.3 第二张牌：新西兰的堆肥现实很难看

| 事实 | 来源 |
|---|---|
| 全国只有 **10 个工业堆肥设施 + 2 个社区设施**接收可堆肥包装 | [公开源](https://www.plastics.org.nz/environment/environmental-news/where-can-commercially-compostable-packaging-and-serviceware-be-processed-in-new-zealand) |
| **没有任何一个市政厅的绿桶回收接收可堆肥包装**（少数经批准的厨余桶除外） | [公开源](https://www.wasteminz.org.nz/our-work/hot-topics/compostable-packaging-facilities) |
| 新西兰**至今没有一个全国统一的可堆肥包装标准** | [公开源](https://www.wasteminz.org.nz/our-work/hot-topics/compostable-packaging-facilities) |
| 可堆肥包装必须由废物公司专车运到堆肥厂，堆肥厂还会因为影响堆肥商业价值而拒收 | [公开源](https://sustainable.org.nz/learn/news-insights/sbn-guidance-on-compostable-packaging/) |

**翻译成生意话**：对手卖的"可堆肥盒子"，餐厅买回去以后**在现实中大概率还是进了垃圾填埋**，因为根本没地方送去堆肥。这是整个品类里最大的一根刺，也是餐厅老板被"绿色洗白"骗过一次之后最大的心理阴影。

**Bamwave 的机会是做那个说实话的人**：不吹"扔进绿桶就能堆肥"，而是讲"就算最后进了填埋场，它也只是植物纤维，不是一块要待 400 年的塑料"。**在一个所有人都在夸大的品类里，诚实本身就是差异化。** `[推断]`

### 4.4 第三张牌：PFAS（"永久化学物质"）

历史上很多纤维餐盒（甘蔗渣、竹纤维）会加 PFAS 做防油防水涂层，近年全球监管收紧，厂商纷纷改用其他工艺。澳新的家庭堆肥认证 **AS5810** 明确要求申报"未刻意添加含氟化学物质（PFAS/PFOA）"。`[公开源]`：[环境部《可堆肥产品添加剂》报告](https://environment.govt.nz/assets/publications/Waste/additives-in-compostable-products-in-aotearoa-nz.pdf) · [AS5810/AS4736 认证说明](https://www.compostablealternatives.com.au/compostable-certifications/)

**如果 Bamwave 能拿出"无刻意添加 PFAS"的第三方报告，这是能直接写进标书、直接击穿对手的一张牌**（尤其面向学校、医院、政府采购、连锁品牌）。反过来，如果拿不出，就绝对不能碰这个话题。列进 §8 待确认清单。

---

## 5. 搜索需求实测（新西兰）—— 泼一盆冷水

以下全部是 `[实测]`，Semrush 新西兰数据库，2026-08-09 拉取。

### 5.1 有商业意图的词，量都很小

| 关键词 | 月搜索量 | 每次点击成本(NZD) | 竞争难度(0-100) |
|---|---|---|---|
| sustainable packaging nz | 390 | $1.21 | 41 |
| takeaway containers | 390 | $1.00 | 14 |
| takeaway containers nz | 170 | $0.71 | 11 |
| food packaging nz | 170 | $0.93 | 29 |
| disposable food containers | 170 | $0.69 | 7 |
| eco friendly packaging | 170 | $1.41 | 21 |
| bamboo plates | 140 | $1.00 | 9 |
| **bamboo takeaway containers** | **30** | $0 | 2 |
| biodegradable food containers | 30 | $0.89 | 15 |
| paper takeaway containers | 30 | $0.61 | 3 |
| bamboo lunch box | 30 | $0 | — |
| catering supplies nz | 30 | $0.40 | 38 |
| compostable takeaway containers | 20 | $0 | — |
| bamboo packaging | 20 | $0 | — |
| compostable coffee cups | 20 | $1.03 | — |
| home compostable packaging | 20 | $0 | — |
| wholesale packaging nz | 20 | $0.85 | — |
| restaurant supplies nz | 20 | $0.62 | — |
| eco friendly takeaway containers | 10 | $0 | — |
| compostable packaging nz | 10 | $1.21 | — |

另有两个大词，但**买家意图不对，别被数字骗了**：
- `biodegradable packaging` 880/月 —— 主要是"什么是可降解包装"这类查资料的人，不是买家 `[实测 + 推断]`
- `food containers nz` 720/月 —— 主要是家用保鲜盒（SERP 首页是 Kmart、Briscoes、Pak'nSave），不是外卖盒 `[实测]`

**精准商业意图池合计 ≈ 2,000–2,500 次/月，全国。** 按行业常见的搜索点击转化率折算，就算把这个池子全吃下来，一个月带来的询盘也只是**两位数**。`[实测 + 推断]`

### 5.2 「bamboo」这个词是个陷阱

新西兰人搜 "bamboo" 的时候，搜的根本不是包装：

| 关键词 | 月搜索量 | 实际是什么 |
|---|---|---|
| bamboo spa | 5,400 | 按摩店 |
| bamboo | 3,600 | 泛词 |
| bamboo kitchen | 2,900 | 中餐馆店名 |
| bamboo garden | 1,300 | 园艺 / 餐馆店名 |
| bamboo mattress topper | 880 | 床品 |
| bamboo sheets nz | 590 | 床单 |
| bamboo blinds nz | 260 | 竹帘 |

**结论：不要把品牌和内容押在 "bamboo" 这个词上。** 前 40 个高量 "bamboo" 词里，**没有一个跟餐饮包装有关**。买家的语言是 `takeaway containers` / `compostable` / `eco friendly packaging`，不是 `bamboo`。竹子是**材料卖点**，不是**搜索入口**。`[实测]`

> 这条直接影响网站怎么写：页面标题必须是 "Compostable Takeaway Containers NZ"，而不是 "Bamboo Packaging"。

### 5.3 广告很便宜

上表点击单价基本在 **$0.4–$1.4 纽币**区间，最贵的 `eco packaging` 也只有 $1.98。`[实测]`

**这是个好消息**：整个品类的搜索广告几乎没人认真投（`compostable packaging nz` 这类词的 CPC 才 $1.21）。**用极小的预算（月 $300–500 纽币）就能把这批高意图词全部买断**，投产比大概率远好于花几个月做 SEO。`[实测 + 推断]`

---

## 6. 竞争格局实测

### 6.1 对手的搜索实力（Semrush 新西兰库，2026-08-09 `[实测]`）

| 对手 | 自然搜索词数 | 每月自然流量 | 在投搜索广告 | 定位 |
|---|---|---|---|---|
| **BioPak**（biopak.com/nz） | 838 | **1,698** | 16 个词 | 跨国，品类第一，唯一认真投广告的 |
| **BCS FoodPak** | 937 | **1,925** | 0 | 本土批发，品类全（也卖塑料盒） |
| **Ecoware** | 322 | 672 | 0 | 本土环保老牌，纯环保定位 |
| **Nature Pac** | 403 | 219 | 5 个词 | 本土环保，在做内容 |
| **Better Packaging Co** | 229 | 637 | 0 | 本土，设计驱动，品牌感最强 |
| **Friendly Pak** | 207 | 44 | 0 | 小 |
| **Bamwave（客户）** | **0（库里查无此域名）** | **0** | 0 | **搜索存在感为零** |

### 6.2 三条读得出来的结论

**① 客户的起点是绝对的 0。** `bamwave.co.nz` 在新西兰数据库里完全查不到 —— 没有任何一个词有排名。这不一定是坏事（说明还没投入过，也没历史包袱），但意味着**前 3 个月不要指望自然搜索带来任何东西**。`[实测]`

**② 天花板低，但门槛也低。** 品类第一名 BioPak 每月自然流量也才 1,698 次 —— 这在正常行业里是一个小博客的量。**这意味着投入 3–6 个月的正经内容，进品类前三是完全现实的目标**；但同时也说明，就算做到第一，自然搜索也只能带来每月一两千次访问。`[实测 + 推断]`

**③ 广告是一片空地。** 6 个对手里只有 2 个在投搜索广告（BioPak 16 个词，Nature Pac 5 个词），其余全是 0。`[实测]`

### 6.3 搜索结果页上真正的对手是谁

搜 `takeaway containers nz`，首页 20 条里坐着的是：`[实测]`

- **专业包装批发商**：BioPak、Nisbets、Jasco、Pack Centre、Bonson、The Packaging Co、OneStopPak、Disposable Tableware、NZ Safety Blackwoods
- **零售大卖场**：Kmart、Briscoes、Pak'nSave、The Warehouse、Look Sharp、Storage Box
- **环保定位的**：Nature Pac、BCS FoodPak

**注意**：环保定位的品牌在这个词上是**少数派**，多数位置被"什么都卖的批发商"和"卖家用保鲜盒的零售商"占着。`[实测]`

**这说明搜这个词的人意图很杂**（有找批发的，也有找家用保鲜盒的），**硬打这个词性价比不高**。更该打的是意图纯粹的中长尾：`compostable takeaway containers` / `eco friendly takeaway containers` / `plastic free takeaway packaging` —— 量小，但每一个搜的人都是精准买家，而且难度接近 0，一两篇好内容就能拿下。`[实测 + 推断]`

---

## 7. 战略建议

### 7.1 定位（一句话）

> **"不是塑料。连可降解塑料都被禁了的新西兰，竹子还能用。"**

理由：这句话同时踩中了 §4.2 的法规空白、§4.3 的堆肥信任危机、以及餐厅老板"我到底还能用什么"的真实焦虑。它不需要客户相信任何环保承诺，只需要客户相信一条法规。`[推断]`

### 7.2 渠道优先级（按投产比排序）

| 优先级 | 渠道 | 为什么 | 预期见效 |
|---|---|---|---|
| **1** | **搜索广告**（高意图词全买断） | 全品类 CPC 极低、竞争者只有 2 个、词池小到可以全吃 | 2 周内出询盘 |
| **2** | **B2B 直销 + 样品盒**，主攻 Queenstown-Lakes / Nelson | 近 7 成是独立小店，且旅游区付费意愿最高；外卖盒是"试用即转化"的品类 | 1–2 个月 |
| **3** | **社媒内容**（法规科普型，不是产品图） | §4 那套法规话术天生适合做短视频；B2C 侧完全没有搜索需求，只能靠种草 | 1–3 个月 |
| **4** | **SEO + AI 可见度** | 门槛低、能拿第一，但天花板只有一两千访问/月；当"成交护栏"做，不当增长引擎 | 3–6 个月 |
| **5** | 分销 / 批发合作（餐饮用品商、咖啡豆供应商搭售） | 能绕开获客成本，但依赖客户的产能和价格结构，信息不足暂不展开 | 待定 |

**最反直觉的一条**：**别把 SEO 当主力。** 这个市场的搜索池太小了（全国 2,000–2,500 次/月精准需求），SEO 做到极致也换不来一门生意。SEO 的作用是：当销售/广告/社媒把人带到品牌名前面时，他一搜 "Bamwave" 或者 "compostable takeaway containers nz"，我们必须在那儿。`[实测 + 推断]`

### 7.3 内容主线（法规科普 > 产品宣传）

按 §5.1 的实测，产品词根本没量；有量的是**"我该怎么办"**类的焦虑。建议第一批内容全部围绕法规写，每篇都能同时喂搜索和 AI 问答：

1. 新西兰 2025 年 7 月起还禁了什么？餐厅老板对照清单
2. 为什么"可降解塑料"在新西兰也是违规的（多数人不知道的一条）
3. 你的"可堆肥"外卖盒最后去了哪里？新西兰全国只有 10 个堆肥厂的真相
4. 竹纤维 / 甘蔗渣 / 纸 / PLA：四种替代材料，哪个真的合规
5. PFAS 是什么，为什么你该问供应商要这份报告
6. 咖啡店 / 寿司店 / 汉堡店分别该用哪种盒子（按业态拆，最容易被 AI 引用）

**这批内容的真正目的不是排名，是变成销售话术和 AI 回答的原料。** 当有人问 ChatGPT "新西兰餐厅还能用什么外卖盒"，答案里应该有 Bamwave。`[推断]`

---

## 8. 待客户确认清单（这些我不能编，必须客户给）

按重要性排序，**前 3 条不确认，任何对外内容都不能开写**：

| # | 要问什么 | 为什么关键 |
|---|---|---|
| 1 | **盒子的完整材料构成** —— 纯竹纤维？内壁有没有 PE 或 PLA 淋膜？ | 只要有塑料淋膜，§4.2 那套"不是塑料"的核心话术全部作废，且有法律风险 |
| 2 | **有没有 AS4736（工业堆肥）/ AS5810（家庭堆肥）认证**？证书编号 | 决定能不能用"compostable"这个词。没证书就说 = 绿色洗白，会被投诉 |
| 3 | **有没有"未刻意添加 PFAS"的第三方检测报告**？ | §4.4，能拿出来就能打政府 / 学校 / 连锁的标 |
| 4 | 产品线清单：规格、容量、有没有配盖、有没有防漏 | 决定能打哪些业态（汤 vs 干货完全不同） |
| 5 | 价格结构：单价 / 起订量 / 批发阶梯价 | 决定是打独立小店还是连锁 |
| 6 | 供货来源和产能：进口还是本地？备货周期多久？ | 决定敢不敢接大单、敢不敢投广告 |
| 7 | B2B 和 B2C 各自的目标占比 | §7.2 的渠道排序会因此改变 |
| 8 | 有没有现成客户 / 案例 / 门店合作？ | 最快的信任素材，没有就得从 0 造 |
| 9 | 有没有 Google Analytics、Google Search Console、社媒账号？ | 决定能不能拿到真实数据，还是只能靠外部估算 |

---

## 9. 客户侧现状 —— 本次仍未获取

> **本节是空的，而且是故意空的。** 官网打不开（§2），我不会拿"竹纤维盒子一般都是……"来填。
> 按红线规矩：**没有来源的客户业务信息，宁可留白，也绝不写进报告。** 一旦写了，后面所有内容、话术、广告都会建在假地基上。

### 9.1 逐项状态

标注含义：`[未获取]` = 没拿到，不是"没有"。**千万不要把"未获取"当成"客户没有"来用。**

| # | 要素 | 现状 | 官网打开后能否解决 |
|---|---|---|---|
| 1 | **内壁有没有 PE / PLA 塑料淋膜** ⚠️ 最关键 | `[未获取]` 官网未获取，需向客户确认 | **多半不能** —— 淋膜属于工艺细节，产品页几乎不会写。**必须客户本人或工厂规格书回答** |
| 2 | 完整产品线（名称 / 容量规格 / 有无配盖 / 防不防漏） | `[未获取]` 官网未获取，需向客户确认 | **能**，产品页通常写得全 |
| 3 | 堆肥认证 AS4736（工业）/ AS5810（家庭）/ EN13432 | `[未获取]` 官网未获取，需向客户确认 | **部分能** —— 官网常会挂认证标志，但**证书编号基本不会公开** |
| 4 | 认证证书编号（用于核验真伪） | `[未获取]` 官网未获取，需向客户确认 | **不能**，必须客户提供证书原件 |
| 5 | "未刻意添加 PFAS"第三方检测报告 | `[未获取]` 官网未获取，需向客户确认 | **不能**，必须客户提供报告原件 |
| 6 | 价格 / 起订量 / 批发阶梯价 | `[未获取]` 官网未获取，需向客户确认 | **看情况** —— B2C 站会标价，B2B 站常写"询价" |
| 7 | 面向 B2B / B2C / 两者都做 | `[未获取]` 官网未获取，需向客户确认 | **能**，从有没有批发入口、有没有购物车能看出来 |
| 8 | 供货来源与产能（进口 / 本地、备货周期） | `[未获取]` 官网未获取，需向客户确认 | **多半不能**，必须问客户 |
| 9 | 网站状态：有没有博客 | `[未获取]` 官网未获取 | **能** |
| 10 | 网站状态：有没有产品结构化数据（让谷歌/AI 读懂产品的代码标记） | `[未获取]` 官网未获取 | **能** |
| 11 | 网站状态：页面标题怎么写的 | `[未获取]` 官网未获取 | **能** |
| 12 | 有没有 Google Analytics / Search Console / 社媒账号 | `[未获取]` | **不能**，必须客户开权限 |

### 9.2 网站体检 —— 待做，判定标准先定死

官网一打开就跑这项检查，**结论怎么判现在就写死，免得到时候看图说话**：

按 §5.2 的实测，新西兰人搜 `bamboo` 搜的是按摩店、床单、园艺 —— **高量前 40 个 "bamboo" 词里没有一个跟餐饮包装有关**。所以：

| 检查项 | 合格 | 不合格（要改） |
|---|---|---|
| 首页页面标题 | 含 `compostable` / `takeaway containers` / `food packaging` + `NZ` | 押在 `bamboo` 上（例如 "Bamwave – Bamboo Packaging"） |
| 产品页标题 | 按业态或规格写（如 "Compostable Takeaway Containers 750ml"） | 只写产品型号或只写 "Bamboo Box" |
| 有没有博客 | 有，且能承载 §7.3 那 6 篇法规科普 | 没有 —— 那 §7.3 的内容主线要先建站点结构 |
| 产品结构化数据 | 有（谷歌和 AI 能直接读出产品名、规格、价格） | 没有 —— 影响 AI 可见度，属低成本高回报的第一批修复 |

> **这是"待办清单"，不是"体检结果"。** 本次没有做过任何一项实际检查，上表任何一格都不能当结论引用。

### 9.3 必须问客户本人的问题（官网也答不了）

以下 5 条，**就算官网明天能打开，也大概率查不到**，只能问客户本人 —— 建议**现在就发**，不要等白名单：

1. **盒子内壁有没有 PE 或 PLA 塑料淋膜？**（最要命的一条，理由见 §4.2）
2. **认证证书的编号和证书原件**（只看官网上的认证标志不够，标志可以随便贴）
3. **有没有 PFAS 检测报告**（有 = 能打政府/学校/连锁的标；没有 = 这个话题一个字都不能碰）
4. **进口还是本地生产、备货周期多久、能接多大的单**（决定敢不敢投广告 —— 广告拉来订单却发不出货，比没广告更伤）
5. **Google Analytics / Search Console / 社媒账号的访问权限**（决定后续是拿真实数据还是只能靠外部估算）

### 9.4 可以直接发给客户的邮件（复制粘贴即可）

> 客户是新西兰本地公司，所以用英文。**这封信不依赖白名单，现在就能发。**

```
Subject: A few product questions before we finalise your marketing plan

Hi [name],

We've finished the New Zealand market research for Bamwave and found a
strong angle we think you can own. Before we build any content or ads
around it, we need to confirm a few things about the products themselves —
we don't want to publish a single claim we can't back up.

MOST IMPORTANT
1. Do any of your containers have a plastic lining on the inside
   (PE, PLA, or any other coating)? Or are they 100% plant fibre with
   no lining at all?
   Why we're asking: NZ's plastic regulations also ban compostable and
   plant-based plastics. Our strongest message for you is "bamboo fibre
   is not plastic, so it isn't caught by the ban." If there is any
   plastic lining, we must not use that message — so we need a definite
   yes or no, ideally from your manufacturer's spec sheet.

CERTIFICATIONS
2. Do you hold AS4736 (commercial composting), AS5810 (home composting),
   or EN13432 certification? If so, could you send the certificates
   themselves — we need the certificate numbers to verify them.
3. Do you have a third-party test report showing no intentionally added
   PFAS ("forever chemicals")? If you do, it's a strong advantage for
   government, school and chain tenders.

PRODUCTS & COMMERCIALS
4. Could you send your full product list — product names, sizes/capacity,
   whether each comes with a lid, and whether it's leak-resistant?
5. What are your prices, minimum order quantities, and wholesale tiers?
6. Are your products made in New Zealand or imported? What's your typical
   lead time, and what's the largest order you could fill comfortably?

BUSINESS & ACCESS
7. Are you mainly selling to businesses (restaurants, cafés), direct to
   consumers, or both? Which do you want to grow first?
8. Do you have any existing customers or venues using your products that
   we could reference?
9. Could you give us access to your Google Analytics, Google Search
   Console, and social media accounts? Without these we can only estimate
   from outside data.

No rush on the nice-to-haves, but question 1 is genuinely blocking — we
can't start writing until we know the answer.

Thanks,
[your name]
```

---

## 10. 建议的下一步（等你拍板）

**按"不等任何人就能开始"排序：**

1. **你做（现在，不依赖任何东西）**：把 §9.4 那封邮件发给客户。**这是当前唯一的关键路径** —— §9.3 那 5 条就算官网能打开也查不到，只能客户本人回答。
2. **你做（现在，1 分钟）**：按 §2 的 A 方案把外网访问打开，**然后开一个新会话**（旧会话里改不生效）→ 我补齐 §9.1 里"官网打开后能解决"的 6 项 + §9.2 的网站体检
3. **我做（可以现在就并行，不等 1 和 2）**：把 §7.3 那 6 篇内容的选题和大纲先写出来 —— 这批内容讲的是**法规**，不是产品，所以不依赖客户产品信息，现在就能动笔
4. **我做（拿到 1 之后）**：出正式的品牌资料档案（master brief）+ 90 天打法方案
5. **暂停，等 §9.3 第 1 条**：§4.2 那套"竹子不是塑料"的核心话术、以及任何对外文案，**在塑料淋膜问题有明确答案之前一个字都不要写**

---

## 11. 本报告的可信度边界

- **§5、§6 全部是实测数字**，来自 Semrush 新西兰数据库，2026-08-09 拉取，可复现。
- **§3、§4 是公开资料**，每条都附了原始链接，可点开核对。
- **标 `[推断]` 的都是判断，不是事实** —— 尤其是 §7 的全部战略建议，以及"竹纤维不受禁令影响"这条法律解读（**必须经律师确认后才能对外讲**）。
- **客户自身的一切（产品、价格、认证、产能、现有客户）本报告全部为空**，一个字都没有猜测。§9 逐项列出了空在哪里 —— 那些 `[未获取]` 表示**我们没拿到**，不表示**客户没有**。
- **§9.2 的网站体检是待办清单，不是体检结果。** 本次没有对官网做过任何一项实际检查。
- **§2 里"网页搜索搜不到 bamwave.co.nz"用的是美国索引**，不能用来判断该网站在新西兰的收录情况。
