---
name: me-google-ads-discipline
description: Magic Engine Google Ads 纪律门 · 任何客户的 Google Ads 决策前必先加载。触发信号：(a) 出现 `Google Ads` `Search Ads` `PPC` `campaign` `ad group` `RSA` `responsive search ad` `keyword` `match type` `broad match` `phrase match` `exact match` `negative keyword` `Smart Bidding` `tROAS` `tCPA` `Learning Limited` `Quality Score` `Search Terms` 等 Google Ads 名词；(b) 出现 `重启广告` `开广告` `建 campaign` `调预算` `优化广告` `广告没效果` `CPC 太高` `烧钱` `ROAS 差` 等广告运营诉求；(c) 要写 / 改 ad copy · headline · description · 落地页 URL；(d) 要拉 Search Terms 报告 / Change History / Conversion Actions 做诊断；(e) 判断某个 campaign / ad group 该不该重启 · 该不该暂停。命中任一 → 必须按本 skill 的 6 条纪律逐条自检 + 输出 Discipline Report，再进入具体操作。**任何"改 Google Ads 后台"的动作都是半不可逆 · 必须 PM 显式 go**。
---

# Magic Engine Google Ads 纪律门（me-google-ads-discipline · v0.1 EXPERIMENTAL）

> ⚠️ **v0.1 EXPERIMENTAL · 单一 case 来源** —— 本 skill 的 6 条规则全部抽自 **2026-08-29 CTS Tours NZ 一家客户**的 Google Ads 实战。硬证据缺口：需 ≥2 个已付费客户跨行业复用后才能升为正式 L1 Capability（登记在 [`docs/registry/platform-candidates.md`](../../../docs/registry/platform-candidates.md) · 复查日 2026-10-29）。
>
> **使用时的自觉**：遇到规则跟当前客户情况冲突时，**先怀疑规则**（它只有一个样本），把冲突记进候选行的"硬证据进度"列，不要硬套。

---

## 存在的原因

**触发事故（2026-08-29 · CTS Tours NZ）**：PM 要求"重启 CTS Google 广告 · 每天 $40 看能做什么"。主 agent 直接出了一版 Path A / Path B 优化方案，**在没查 Change History、没查 Conversion Actions 配置、没读全 memory 红线原文的情况下**就下了四个结论：

1. 判定 4 个 paused ad group "该重启" —— 实际上它们是 PM 自己 2026-06-20~22 手动关的，因为 **CPC 高得离谱**
2. 判定 "Since 1928" ad copy "必删" —— 实际上 memory 原文只禁"单独出现"，并列 "25 Years Kiwi-led" 时合规，直接删是越权毁客户资产
3. 判定 conv value "失真" —— 是**猜的**，没打开 Conversion Actions 页确认（后来查实确实是 default NZD 1，但那是运气不是方法）
4. Path B 把 NZD 25/day 摊到 5 个 ad group = 每个 NZD 5/天 —— **触发 Smart Bidding 学习期死锁**，全部会陷 Learning Limited

子牙对抗性复审判定 **"需改"**，四条硬挑刺全部命中。修订成 v2 后加了 Phase 0 前置调查，才发现真相。

**根因不是分析能力不够，是缺少一套动手前必跑的检查纪律**：广告后台的每一个"看起来该改"的地方，背后都可能有历史原因、有 memory 红线、有平台机制约束。**广告改动是花客户真钱且半不可逆的**——错了就是烧掉的预算加上重新爬坡的学习期。

---

## 触发条件

### A. 名词触发
出现下列任一即触发：
- `Google Ads` · `Search Ads` · `PPC` · `SEM` · `Google 广告`
- `campaign` · `ad group` · `广告组` · `RSA` · `responsive search ad`
- `keyword` · `关键词` · `match type` · `broad match` · `phrase match` · `exact match` · `negative keyword` · `否定关键词`
- `Smart Bidding` · `tROAS` · `tCPA` · `Maximize Conversions` · `Learning Limited` · `学习期`
- `Quality Score` · `Search Terms` · `搜索词报告` · `Optimisation score`
- `conversion action` · `conv value` · `转化价值` · `归因窗口`

### B. 运营诉求触发
- `重启广告` · `开广告` · `建 campaign` · `新建广告`
- `调预算` · `加预算` · `减预算` · `每天 $X`
- `优化广告` · `广告没效果` · `CPC 太高` · `烧钱` · `ROAS 差` · `转化不好`
- `暂停广告` · `关掉 ad group` · `停 campaign`

### C. 内容触发
- 要写 / 改 ad headline · description · sitelink · callout
- 要改落地页 URL / final URL / display URL
- 要设 / 改 conversion action 或 value

### D. 诊断触发
- 要拉 Search Terms 报告 / Change History / Conversion Actions / Auction Insights
- 判断某 campaign / ad group 该不该重启、该不该暂停

**命中任一 → 必须先跑 Phase 0 前置调查 + 输出 Discipline Report，再进入具体操作。**

---

## 硬约束：动手前必须停

| 动作 | 是否需要 PM 显式 `go` |
|---|---|
| **查看**（Search Terms · Change History · Conversion Actions · 报表）| ❌ 不需要 · 随便查 |
| 暂停 / 启用 campaign 或 ad group | ✅ **需要** |
| 改预算（任何方向）| ✅ **需要** |
| 加 / 删 keyword 或 negative keyword | ✅ **需要** |
| 改 / 新建 / 暂停 ad copy | ✅ **需要** |
| 改 bidding strategy | ✅ **需要** |
| 改 conversion action 配置 / value | ✅ **需要** |
| 应用 Google 的 Recommendation | ✅ **需要**（Google 的推荐经常是让你多花钱）|

**理由**：Google Ads 改动直接花客户真钱 · 学习期重置不可逆 · Quality Score 绑定 keyword×ad group 历史（迁移 = 重新爬坡）。符合 CLAUDE.md 铁律 2「不可逆操作必须 PM 显式 go」。

---

## Phase 0 · 动手前必跑的四查（缺一条就是 CTS 事故重演）

在提出**任何**优化方案之前，必须完成：

### 0.1 · Change History（查"这里以前发生过什么"）
```
Google Ads → Change history → 时间范围拉到 All Time → Status 筛选 → Paused
```
**查什么**：每个 paused campaign / ad group / keyword **是谁、什么时候、为什么关的**。
**为什么**：`Paused` 状态不等于"忘了开"。绝大多数情况是**有人关它是有原因的**。原样重启 = 重复踩同一个坑。
**输出**：一张表 —— 对象 / 关闭日期 / 操作人 / 工具（Web manual vs Recommendation vs API）。
**Change History 查不到原因时**：直接问 PM「这个当时为什么关的」，并给出可选项（见 §规则 6 的四象限）。

### 0.2 · Conversion Actions 配置（查"报表数字是不是真的"）
```
Google Ads → Goals → Conversions → Summary / Settings / Value rules
```
**查什么**：
- Value 是 **dynamic**（从 tag 传真实金额）还是 **static**？static 是多少？
- **Value rules 页是不是空的**？空 = 没有任何 value 缩放
- Attribution window · Enhanced Conversions on/off
- 各 conversion action 分别的 count 与 value

**速判铁证**：如果报表里 `Conversions` 数字 == `Conv. value` 数字（1:1），基本可以确定用的是 **每转化 default 1 元**。
**为什么**：value signal 错 → Smart Bidding 优化方向全错 → ROAS 报表全部失真。**在错的 value 上做的任何优化都是错的**。

### 0.3 · 客户 memory / master_brief 红线原文（查"这句话能不能写"）
```
先读 memory 全文，不要凭印象。再查 master_briefs。
```
**为什么**：CTS 事故里 agent 凭印象判"Since 1928 必删"，实际 memory 原文只禁"单独出现"。**凭印象执行红线 = 越权毁客户资产**。
**规则**：涉及品牌表述 / 客户事实 / 合规声明的 ad copy，**拉全文给 PM 判**，不是 agent 说删就删。

### 0.4 · Search Terms 报告（查"钱到底花在哪"）
```
Google Ads → Insights and reports → Search terms → 时间范围 ≥ 30 天
```
**查什么**：按 Cost 排序，逐条分类 —— 品牌真流量 / 竞品名字 / 泛意图词 / 完全无关。
**为什么**：这是**唯一一份"用户真正打了什么词才触发你广告"的诚实数据**。keyword 列表说的是你想买什么，search terms 说的是你实际买到了什么。

---

## 六条纪律

### 规则 1 · Brand 与 Non-brand 必须分账

**规则**：品牌词（客户品牌名 + 拼写变体 + 竞品品牌名）和非品牌词（品类意图词）**必须放在不同的 campaign**，各自独立预算。

**为什么**：
- 两者的 CTR / CPC / 转化率差一个数量级（品牌词 CTR 常 10%+，非品牌 2-5%）
- 混在一起 → ROAS 无法拆解，你永远不知道钱是品牌流量赚的还是拓新赚的
- Smart Bidding 会被品牌词的高转化率"骗"，把预算全推给品牌词，拓新永远起不来

**CTS 实证**：Campaign #1 "Brand Defense" CTR 11.88% · CPC NZD 2.31；Campaign #2 "Differentiation" CPC NZD 3.98（1.7 倍）。如果混在一起，后者会被前者的表现掩盖。

**边界**：预算极小（< 单转化 CPA × 20 / 天）时分账会导致两边都进不了学习期——见规则 3。这种情况下先集中打品牌防守，拓新等预算够了再拆。

---

### 规则 2 · Broad match 在品牌共现品类是重灾区

**规则**：默认全部用 **phrase / exact match**。broad match 只在一个专门的 exploration ad group 里用，且必须配 negative keyword 清单 + 每周看 Search Terms。

**为什么**：某些品类里所有竞争对手的品牌名都会在同一批搜索结果里共现（旅游、地产、留学、保险尤其严重）。broad match 会把你的钱直接送去给对手的品牌词竞价——**你在替对手做品牌广告**。

**CTS 实证**（Search Terms 报告 · 2026-07）：
| 搜索词 | 花费 | 性质 |
|---|---|---|
| `wendy wu tours china` | NZD 14.54 | 竞品品牌名 |
| `wendy woo tours china` | NZD 39.84 | 竞品品牌名（还是拼错的）|
| `avg travels` | NZD 18.42 | 完全无关的公司 |
| `beijing travel` | 23 impressions 0 clicks | 泛意图 |
| `travel` | 31 impressions 0 clicks | 泛到极致 |

估算 broad match 漏出 **30-40% 预算**给这类词。

**标准 negative 起手式**（每个新 campaign 都先加）：
- 所有已知竞品品牌名 + 常见拼错变体
- `free` · `cheap` · `diy` · `job` · `career` · `salary` · `review`（除非做口碑）
- 单个泛词（`travel` · `property` · `flooring` 这种一个词的）
- 客户明确不做的服务 / 地区

---

### 规则 3 · 主题化 ad group + Smart Bidding 学习期数学门槛

**规则 3a**：ad group 按**主题**切分（每个主题独立的 keyword × ad copy × landing page 三元组精准匹配），不做大杂烩 ad group。

**规则 3b（数学门槛 · 硬约束）**：切分前先算：
```
每 ad group 月预算 = (日预算 ÷ ad group 数) × 30
每 ad group 月转化数 ≈ 每 ad group 月预算 ÷ 单转化 CPA

如果 每 ad group 月转化数 < 15 → 这个切分方案不成立
```
Smart Bidding（tROAS / tCPA / Maximize Conversions）需要每个学习单元月 15-30 个转化才能跑出学习期。低于门槛 → 全部陷 `Learning Limited` → 出价失控 → CPC 飙高 → 比不切分还差。

**低于门槛时的三条出路**：
1. **收敛 ad group 数**：从 5 个减到 2 个，集中喂
2. **改用 manual CPC**：放弃 Smart Bidding，人工控价
3. **提预算**：让每个 ad group 都够门槛（PM 拍板）

**CTS 事故**：原 Path B 把 NZD 25/day 摊到 5 个 ad group = 每个 NZD 5/天 ≈ 月 NZD 150。若 CPA NZD 20-50 → 月转化 3-7 个，**远低于 15 门槛**。子牙挑刺命中，方案改为收敛到 2 个。

---

### 规则 4 · Conversion value 必须是真实客单价

**规则**：开任何 value-based bidding（tROAS / Maximize Conversion Value）之前，conversion value 必须反映**真实业务价值**——真实成交金额（dynamic）或至少客单价均值（static）。**绝不能留 default 1**。

**为什么**：
- default NZD 1 意味着"一个 NZD 50 的小单和一个 NZD 8000 的大单价值相同"
- Smart Bidding 会拼命优化转化**数量**而不是**价值** → 你买到一堆低价值线索
- ROAS 报表系统性低估 → 老板看报表以为广告不行，实际是仪表盘坏了

**这不是旅游行业特有的** —— 任何 lead-gen 或电商客户都会踩：
| 客户类型 | 真实单笔价值 | default 1 的后果 |
|---|---|---|
| 地产中介 | 佣金数万 | 优化成"多拿垃圾线索" |
| 大宗建材 | 单笔数千 | 小单大单同权重 |
| 电商 | AOV 数十至数百 | 高毛利品被低毛利品稀释 |
| 出境旅游 | 单人数千 | 同上 |

**速查法**：报表里 `Conversions` == `Conv. value`（1:1）→ 基本确定是 default 1。

**CTS 实证**：Campaign #1 显示 88 conversions / 88 conv value · Value rules 页空 → 确认 default NZD 1。CTS 真实 lead 价值 NZD 2000-8000，**ROAS 被低估 2000-8000 倍**。

**修法顺序**：
1. 先问客户真实客单价 / 平均成交金额（PM 提供，不能猜）
2. 短期：给 conversion action 设 static value = 客单价 × 平均成交率
3. 长期：落地页 / CRM 回传真实成交金额（dynamic value）
4. **value 修好之后**才开 value-based bidding

---

### 规则 5 · Heritage 词必须并列本地经营年数

**规则**：`Since XXXX` / `Established XXXX` / `百年品牌` 这类 heritage 声明，如果客户的**本地实体经营年数** ≠ 该年份，则：
- **必须**在同一条 ad 里并列本地年数（如 `Since 1928 · 25 Years Kiwi-led`）
- **或者**降级到 description，不放 headline
- **绝不能**在 headline 里孤立出现

**为什么**：搜索用户看到 headline 里的 `Since 1928` 会默认"这家公司在我这个国家做了 1928 年至今"。如果实际本地只做了 25 年，这构成**误导性表述**——既有 Google Ads 政策的隐性风险（misleading claims），也违反客户自己 master brief 的品牌红线。

**这不是旅游行业特有的**：
- 地产：Ray White since 1902（澳洲）vs 某个 2019 年才开的分行
- 教育：某大学 since 1636 vs 本地校区 2015 年设立
- 汽车：品牌 since 1886 vs 本地经销商 2020 年拿牌
- 任何"跨国母品牌 + 本地分支"结构都命中

**CTS 实证**：
| 位置 | 表述 | 判定 |
|---|---|---|
| Campaign #1 headline | `CTS Tours NZ — Since 1928 \| Small-Group China Tours` | ⚠️ **违规**（1928 孤立在 headline）|
| Campaign #2 description | `CTS NZ — 25 years Kiwi-led, backed by CTS global brand since 1928` | ✅ 合规（并列）|

**执行纪律**：发现疑似违规的 ad copy 时，**拉全文给 PM 判**，不要 agent 自己删。memory 红线的原文措辞往往比印象中更精确（CTS 那条只禁"单独出现"，不是禁用 1928）。

---

### 规则 6 · Change History 是 audit 的第一步，不是最后一步

**规则**：任何"该不该重启 / 该不该开这个"的判断之前，**必须先拉 Change History**。

**为什么**：`Paused` 状态携带信息。绝大多数被关掉的东西是**有人关它是有原因的**。不查历史就重启 = 把当初那个坑重新踩一遍，而且要再烧一次预算才能发现。

**查到"是谁关的"之后，追问"为什么关"** —— 四象限定位（这四种的修法完全不同）：

| 症状 | 表现 | 修法 |
|---|---|---|
| **(a) 花不出去** | impressions / clicks 极少 | 关键词太窄 → 加长尾意图词、放宽到 phrase |
| **(b) 花了没转化** | CTR 正常但 conversion = 0 | 落地页转化路径断了 → **先修落地页再重启广告** |
| **(c) CPC 高得离谱** | 烧钱但 clicks 少 | 短词竞价太贵 → **换长尾 3-5 词组合**，CPC 常降 3-10 倍 |
| **(d) CTR 极差** | impressions 多但没人点 | ad copy 不匹配搜索意图 → 重写 ad copy |

**重启前的硬要求**：
- 拉出该对象**被关之前 30 天**的 CTR / CPC / CPA / Quality Score
- 找出属于上面哪一象限
- 明确说出"这次哪里不同"——如果说不出，就不是重启，是重建（换 keyword 组合、换 ad copy、换落地页）
- PM 逐个签字

**CTS 实证**：4 个 paused ad group 全是 PM 自己 2026-06-20~22 手动关的，原因是 **(c) CPC 高得离谱**。原样重启必然重蹈覆辙 → 方案改为「换长尾 phrase match，每个候选真实 CPC 必须低于品牌词 CPC」。

---

## 输出格式 · Discipline Report

命中触发条件后，动手前必须输出：

```
## Google Ads Discipline Report · [客户名] · [日期]

### Phase 0 四查结果
- **0.1 Change History**：[谁 / 何时 / 关了什么 / 是否问出原因]
- **0.2 Conversion Actions**：[dynamic or static / value 是多少 / Value rules 空否 / 1:1 铁证有无]
- **0.3 客户红线原文**：[查了哪些 memory / master_brief · 原文措辞是什么 · 有无疑似违规 ad copy 待 PM 判]
- **0.4 Search Terms**：[总花费 / 品牌真流量占比 / 竞品名占比 / 泛意图占比 / 无关占比]

### 六条纪律自检
| # | 规则 | 当前状态 | 需要动作 |
|---|---|---|---|
| 1 | Brand/Non-brand 分账 | ✅/⚠️/❌ | |
| 2 | Broad match 谨慎 | ✅/⚠️/❌ | |
| 3 | 主题化 + 学习期门槛 | ✅/⚠️/❌ | 算式：日预算 ÷ ad group 数 × 30 ÷ CPA = ___ 个/月（门槛 15）|
| 4 | Conv value 真实客单价 | ✅/⚠️/❌ | |
| 5 | Heritage 词纪律 | ✅/⚠️/❌ | |
| 6 | Change History 先查 | ✅/⚠️/❌ | |

### 建议动作（按 impact 排序）
1. [动作] —— 需 PM go：是/否
2. ...

### PM 待拍板
- [ ] ...

### 不动的东西
[明确列出这次不碰什么，避免范围蔓延]
```

---

## 与既有机制的关系

| 机制 | 关系 |
|---|---|
| [`me-platform-tier-gate`](../me-platform-tier-gate/SKILL.md) | 讨论"要不要把某条广告经验做成 ME 能力"时先跑 tier-gate；本 skill 只管**执行纪律**不管**层级判定** |
| `src/lib/google-ads/`（L3 Connector）| 本 skill 是决策纪律；实际 API 调用走该 Connector（`client.ts` / `creds-loader.ts`）|
| CLAUDE.md 铁律 2（PM 角色边界）| 广告后台改动 = 花钱 + 半不可逆 → 必须 PM 显式 go |
| CLAUDE.md 铁律 4（大任务 2 审）| 一次改 ≥3 个 ad group / 拆 campaign / 换 bidding strategy = 大任务 → 召魏征 + 板桥 |
| CLAUDE.md 铁律 8（客户数据红线）| ad copy 里的客户事实必须可溯源（官网 / master_brief），不能编 |

---

## 未来演化（**未建 · 等硬证据**）

### `google-ads-auditor` Cron Agent（规则 4 + 6 的自动化）
规则 4（conv value 真值）和规则 6（change history）本质是**周期性巡检**，靠"人刚好想起来查"会断头（违反 CLAUDE.md 铁律 3）。设想形态：

- 挂在既有 `pm-daily-todo` cron 下（**不新起 cron**）
- 每周扫所有活跃 client 的 Google Ads：
  - conv value 是否仍是 default 1 / 是否明显低于客单价
  - Change History 有无异常操作（批量 pause · 预算大跳变 · Recommendation 被自动应用）
  - Search Terms 里无关词占比是否超阈值
- 命中 → 生成"🙋 需要你动手"待办（what + how + href 三件套）
- 落点：`src/lib/google-ads/auditor.ts` + `src/app/api/cron/google-ads-audit-weekly/route.ts`

**建之前必须**：走完整五道 Build Gate + 大任务 2 审（子牙 + 魏征）。当前**硬证据不足**（1/3 客户复制），不建。

### 升为正式 L1 Capability 的条件
- ≥2 个已付费客户分属不同行业跑过同一套纪律，或某条规则在 ≥3 客户处出现事实复制
- 复查日 2026-10-29（[`platform-candidate-reviews.ts`](../../../src/lib/pm-todo/platform-candidate-reviews.ts) 自动提醒）
- 达标 → 晋升提案 → 2 审 → 五道 Build Gate

---

## 版本

- **v0.1 EXPERIMENTAL · 2026-08-29** · 因 CTS Tours NZ Google Ads $40/day 重启事故设立。6 条规则抽自单一客户实战，经子牙对抗性复审（4 条挑刺）+ 张良 tier 判定（修正"1-3 通用 / 4-5 旅游特有"→ 6 条全 L1 通用）。PM 明确拍板"现在建骨架"，已告知抽象过度风险。硬证据 1/3，登记在 `platform-candidates.md` 待 2026-10-29 复查。
