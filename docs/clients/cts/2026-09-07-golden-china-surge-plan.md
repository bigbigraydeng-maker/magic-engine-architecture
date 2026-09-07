# CTS Golden China Tour 冲量方案 · 2026-09-07

**产品**:China Discovery — Golden China · 12 天 · NZD $4,999 起 · **2026-11-16 出发**(唯一确认团期)· 小团 12 人封顶 · 上海→北京→西安→上海 · 4 星酒店 · 26 顿餐 · 英文导游 · 高铁 · 机票全含
**天然紧迫感**:NZ 护照免签中国**到 2026-12-31 到期**
**产品页**:https://www.ctstours.co.nz/tours/china/discovery/golden-china
**订电话**:0800 287 888 · info@ctstours.co.nz

---

## 目标 · 今日先扩池不奔 lead

- **今天**:$80/天扩池 + 素材换血 + 建付费客户 lookalike 新种子
- **3-5 天后评估**:池子厚了、素材新了,再决定加不加到 $150-200 冲 20 lead/天
- **不做**:$240 一次砸到位(素材不换、池子不扩,砸也白砸)

## 现状盘点(基于 2026-09-07 真实数据)

**受众池水位(现成金矿)**
| 池子 | 人数 | 用途 |
|---|---|---|
| Video viewers 50%(365d) | ~4 万 | 中层线索最强种子 |
| ThruPlay viewers(365d) | ~2.4 万 | 备用种子 |
| Leadform 填过没提交(90d) | 1300-1600 | 底层再营销最肥 |
| Leadform 已提交(90d) | ~1000 | 🚫 全线排除 |
| FB Page engaged(365d) | 2400-2800 | 底层辅助 |
| **4 条 Lookalike (INACTIVE)** | 各 1000 | 🔴 建了没跑,今天激活 |

**广告成本基线**:$60/天,5-6 lead/天,$11-12/lead

**技术能力已现成(2026-09-05~07 陆续上线)**
- ✅ 名单一键 CSV 导出:`GET /api/admin/conversions/audience-export?client_id=<CTS>&format=csv&source=combined`
- ✅ PM 成交/咨询核对页:`/dashboard/conversions`(键盘 Y/N 批,三闸防重发)
- ✅ Meta CAPI Writer:`src/lib/meta/capi/writer.ts`(等 CRM 上线自动跑;此前 PM 页面手工批也能用)
- ✅ Reel 发布→表现回流 Inngest 链:`factoryReelMeasurementAdapter` 已上线

**硬约束**
- 🔴 接口不能建 Lead 表单广告(Meta 政策),必须 FDE 在 Meta Ads Manager 手工建
- 🔴 CRM 未上线,CAPI 靠 PM 每天 3 分钟批核对页
- 🔴 CTS 广告仍投在个人号(PM 已决不迁移)
- 🔴 Factory 真发 `FACTORY_PUBLISH_LIVE=true` 是 PM 显式动作(不可逆)

---

## 4 个广告钩子(Golden China 专版)

**A · 免签窗口倒计时** ⏰
> 11 月中国免签窗口只剩最后 6 周
> 2026 年 12 月 31 日之后,NZ 护照免签中国的窗口关闭。
> Golden China 12 天全包团 · 11 月 16 日最后一批出发。
> 上海外滩、北京故宫、西安兵马俑 · 4 星酒店 · 26 顿餐 · 英文导游全程陪同 · 小团 12 人封顶。
> **CTA**:了解详情 · **建议素材**:兵马俑视频 / 长城视频

**B · 一辈子该走一次** 💝
> 一辈子该走一次的中国
> 走一趟长城,才知道课本里的中国是什么样。
> 11 月 16 日 · 12 天 · 上海北京西安三城 · NZD $4,999 全包 · 小团 12 人。
> 4 星酒店 · 26 顿餐 · 英文导游 · 高铁 · 机票全含。
> **CTA**:预留座位 · **建议素材**:长城视频 / 老团员见证

**C · 全包不折腾** 📦
> 去中国,只需要打包行李
> 12 天 · $4,999 全包 · 机票酒店餐食门票导游高铁一次搞定。
> 11 月 16 日出发,现在预留还有位。
> 0800 287 888
> **CTA**:预留座位 · **建议素材**:上海外滩视频 / 全景走团 vlog

**D · 兵马俑震撼** 🗿
> 站在 2000 岁的兵马俑面前 · 只有真看过才懂
> Golden China 12 天团 · 11 月 16 日出发 · NZD $4,999 全包
> 小团 12 人封顶 · 剩最后位子
> **CTA**:立即锁定 · **建议素材**:winner reel `video_id 2259550698170048`(已跑赢的兵马俑帖)

---

## 今日 24 小时行动清单

### 👤 PM(15 分钟操作,今天必做)
1. 同意 Meta「潜在客户信息下载」权限(避免线索漏)
2. 手工挑 5-8 条 CTS 主页存量视频(视频改造 agent 会给候选清单)
3. 激活 4 个 INACTIVE Lookalike(Ads Manager 一键)

### 👤 PM(30 分钟 · 建付费客户 Custom Audience + Lookalike 新种子)
1. 下载合并名单 CSV:`GET /api/admin/conversions/audience-export?client_id=c0000000-0000-0000-0000-000000000000&format=csv&source=combined`(约 537 人:193 fbleads + 526 newsletter 去重)
2. Meta Ads Manager → Audiences → Create → Customer List → 上传
3. 基于它建 1% Lookalike (NZ)
4. **这个 Lookalike 就是今日中层新种子**——比视频观众更值钱(真金买过 = 相似人也更值钱)

### 👤 FDE(30 分钟 · 上广告)
1. **地基总开关**:Render `crazycontent` 服务 env 确认:
   - `META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ` = 新钥匙(带 ads_management)
   - `META_PIXEL_ID_CTSTOURS_CO_NZ` = `1824094338280968`
2. **顶层 4 条视频广告**(用 PM 挑的素材,套 A/B/C/D 4 钩子)
3. **中层 1 条 Meta 原生轻表单广告**——种子=付费客户 Lookalike
4. **底层 1 条再营销**——种子=(看视频 50% OR Leadform 填过没提交) NOT 已提交表单
5. **中层轻表单钩子**:「🎁 免费领 Golden China 12 天详细行程 PDF + 早鸟 $200 优惠」;2 问「几人 · 出发时间」
6. **24h 未回停发规则** 严格执行(隔壁提的)

### 🤖 我(Consultant · 今晚)
1. 派视频素材改造 sub-agent(见下)
2. 打开 CAPI Preflight 只读探活(不真发)
3. 明天 09:00 拉初步数据

## 💰 今日预算

| 层 | 每天 | 干什么 |
|---|---|---|
| 顶层视频 4 版(每版 $10) | $40 | 用新素材灌陌生新客池 |
| 中层轻表单(种子=新 Lookalike) | $25 | 从付费客户相似人里筛 |
| 底层再营销 | $15 | 收现有池子 |
| **合计** | **$80/天** | |

## 明天早上 09:00 我看什么

- 4 条视频广告的 CPM / VideoView 成本 / 加池速度(**顶层不看 lead**)
- 中层新 Lookalike 是否产出线索、$/lead vs $11-12 基线
- 底层再营销的疲劳度(受众重合太多会飙升)

## 5-7 天决策点

- 池子涨速 & 素材消耗速度 → 决定要不要加到 $150-200 冲 20 lead/天
- Lookalike 质量 vs 视频观众种子 → 决定往哪个种子加倍下注

---

## 关联

- 平台候选:[基于产品事实的 Meta 广告方案生成](../../registry/platform-candidates.md)(今天新登)
- 上游 me_ad_launch 候选待 #1424 全链 + CRM 上线
- CAPI 候选待 CRM 团队签合约(1-2 周)

---

*落档人:CTS 广告顾问窗口 · 2026-09-07*

---

# v2 补(2026-09-07 晚)· 两个 sub-agent 交付 + 隔壁窗口执行

## 隔壁窗口(🌈Meta广告lead成交数据上报)交付 · 付费客户 Custom Audience

**Audience 已建**:id `52549822861673` · 名 `CTS · LIST · fb+newsletter · 20260907` · 目标 530 人(193 fbleads + 526 newsletter,去重、剔退订/DNC/agent)

**卡在最后一步(Meta 网页上传)**:
- 隔壁写了完整脚本、CSV 已生成发 PM 手机(`CTS_Meta_Audience_530.csv`)
- 但**能写这个 audience 的令牌只在 Meta MCP 连接器里、agent 取不出来**,Meta 网页上传又不许 agent 代操作
- 因此**收尾靠 PM 手工 30 秒**:登录 → https://business.facebook.com/adsmanager/audiences?act=2202695063810470 → 找 `CTS · LIST · fb+newsletter · 20260907` → 编辑客户名单 → 上传 CSV → 对列(email→Email · phone→Phone · fn→First Name · ln→Last Name · country→Country)→ 上传 → 30-60 分钟 Meta 出匹配率

**PM 传完必做**:把匹配率告诉两个窗口——决定明天中层要不要往这个 Lookalike 加钱

**这个 audience 上传完 = 明天中层广告的新种子**。基于它建 1% Lookalike (NZ),比现有视频观众种子更值钱(真金买过的相似人)。

## 我这边 sub-agent 交付 · 视频素材改造清单

从广告账户 Media Library 反查出 15 个独立视频主题,给出 Top 5 完整改造规格(FDE 明早直接照做):

| # | Creative ID | 钩子 | 剪辑动作 |
|---|---|---|---|
| 1 | `1341169247630742` (A1 免签+全包) | **A 免签** | 加片头字幕「⏰ 6 周窗口关闭」+ 换封面 + CTA 结尾 |
| 2 | `1700370431015323` (C1 Best of China) | **C 全包** | 🔴 **原 15 天版剪到 12 天,把杭州/桂林/成都镜头剪掉,片尾字幕改「12 days」** —— 不改就是虚假宣传 |
| 3 | `2238712206984237` (C3 胡同 POV) | B 一辈子 或 C | 保留原样 + 加字幕 + CTA |
| 4 | `28293395376927458` (B3 Kiwi Vol.1 北京) | **A 免签**(避 B 疲劳) | 换封面 + 倒计时字幕 |
| 5 | `1942436436558662` (D4 Beijing vs Xi'an debate) | **D 变体** | 保留原样 + CTA 「不用选,12 天都能去」 |

**重大发现**:A1(`1341169247630742`)是**过去 3 个月最大的浪费素材**——直接命中免签+全包双钩子,却只投了 2 次就 PAUSED,几乎没跑。这是明天冲量的 dream 素材。

**红线(sub-agent 拦下的真雷)**:
- 🔴 C1 剪 15→12 天必须**逐镜看**,把非 Golden China 城市剪掉(Bayside 假信息教训)
- 🔴 B3 Kiwi 系列如果有真人客户,投前**必须确认已有肖像权 release form**
- 🔴 CTA 字幕「From NZD $4,999」(不写 $4,999,消费者法)
- 🔴 D1 兵马俑老素材(52.8k imp)5 天冷却,别再复用同角度

**FDE 明早排期(30-40 分钟)**:5 条视频 → 8 个广告位素材(3 条只做 9:16,2 条做双版 9:16 + 1:1)→ 顶层 4 版 × $10/天 = $40

**已知数据缺口**:sub-agent 用 env 的 CTS token 探自然视频拉不到(令牌失效),只从广告账户 Media Library 反查——**PM 明早 09:00 前用手机登录 facebook.com/CTSToursNZ/videos 扫一眼**,看有没有观看 >10k 的自然爆款是清单没覆盖的(纯自然帖不在广告库里)

## 明早 09:00 我(顾问窗口)会做的

1. 查 audience `52549822861673` Meta 匹配率
2. 拉顶层 4 条广告基线数据(CPM / VideoView 成本 / 加池速度)
3. 出「今天 vs 明天」调整建议($80 → $120 加不加、中层加不加钱、素材要不要换)

---

*v2 落档人:顾问窗口统筹隔壁 + 视频 sub-agent 交付 · 2026-09-07 晚*

---

# v3 补(2026-09-07 深夜)· 账户错位真相 + 双账户并跑决策

## 🔴 隔壁上传收尾后发现的关键错位

**Meta 政策事实**(隔壁 2026-09-07 实测):
- 个人号 `2775766642787274`(现所有 CTS 广告投放地) **建不了 Custom Audience**——`error_subcode 1870050`「账户要先加入 Business 才能建/编辑客户名单受众」
- 因此隔壁把 530 人 audience 建在 **CTStours 账户 `2202695063810470`**(受众 id `52549822861673`)
- **跨账户不通用**:CTStours 账户建的 Custom Audience 和 Lookalike,**只能被 CTStours 账户里的广告使用**

**PM 之前(2026-09-06)决策「不迁账户」是基于旧信息**——那时不知道 Custom Audience 是企业账户独有能力。今晚上传后暴露真相。

## PM 2026-09-07 拍板 · 方案 B 双账户并跑

**个人号 `2775766642787274`**:现有 3 条 CTS 广告不动(保留历史学习)
- Reborn Lead Form 继续投
- Retargeting Warm 继续投
- 顶层 4 条视频广告(明早 FDE 建的)也在这里

**CTStours 账户 `2202695063810470`**:开一条**实验性 Lookalike 广告**
- 目的:验证「真金付费客户 Lookalike」种子的价值
- 预算:**$20-30/天**(实验预算,别多)
- 一周后看数据决定要不要 A 迁移(全部搬 CTStours)or C 认账停止

**总每日预算调整**:$80(个人号顶层+中层+底层) + $25(CTStours 实验) = **~$105/天**

## Lookalike 建法(顾问窗口负责,60 分钟匹配率出后自动动)

- 用 `ads_create_custom_audience` API 建 1% NZ Lookalike,种子 = `52549822861673`
- 命名:`CTS · LAL · list-paid · 1pct · NZ`(遵守命名分区约定)
- 建成后在 CTStours 账户 `2202695063810470` 新开:
  - Campaign objective: OUTCOME_LEADS(或 OUTCOME_TRAFFIC 引流官网)
  - Ad set 受众:该 Lookalike,排除 已提交表单 90d
  - 3 条创意 A/B/C(用视频 sub-agent 交付的清单里的 Top 3)
  - 日预算 $20-30

## 已删的东西

- **ME dashboard 里 newsletter 按钮**(PM 决定去掉,功能已用 audience 上传路做成,按钮报红没用了)——隔壁窗口负责清理

## 明早 09:00 我做的(更新)

- 查匹配率 → 达标就建 Lookalike → 在 CTStours 账户开实验广告
- 拉个人号 4 条视频广告基线数据
- 出「个人号 vs CTStours 两账户对比」监控口径

## 关键教训进记忆(避免下次踩)

- Meta 政策:Custom Audience 只能建在 business 账户
- 跨账户 audience/lookalike 不通用
- 「不迁账户」决策要基于「知道能力边界后」再拍(不知道 Custom Audience 是企业特权就拍不迁,是残缺信息决策)

---

*v3 落档人:顾问窗口 · 隔壁上传后暴露账户错位 · PM 拍板双账户并跑 · 2026-09-07 深夜*


