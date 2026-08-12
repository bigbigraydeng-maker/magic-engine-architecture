# NZCPE 2026 — 社媒内容 + 广告计划（草案）

**建档日期**：2026-08-05 · 关联客户档：[client-brief.md](./client-brief.md)
**目标**：11月20-22日博览会 To C 推广（开幕仪式+周末公众日），当前 FB 主页 48 粉丝，冷启动。
**核心判断**（见对话历史）：粉丝基数≈0，自然发帖没人看，**内容首要作用是广告素材，不是排期发帖**。

---

## 一、关键词调研倒推的内容方向（真实数据，非拍脑袋）

DataForSEO 查了新西兰市场真实搜索量，结论跟 brief 里"品牌向"的关键词清单完全相反：

| 关键词 | 月搜索量 | 难度 | 结论 |
|---|---|---|---|
| things to do with kids auckland | 1,900 | 20（低） | **最大机会**——亲子家庭是真实、可触达的搜索需求 |
| things to do auckland this weekend | 880 | 27 | 周末出行决策入口 |
| free events auckland | 320 | 20（低） | "免费"是强触发词 |
| family events auckland | 260 | 22 | 同上 |
| food festival auckland | 210 | 29 | 美食是强钩子 |
| weekend markets auckland | 170 | 32 | 市集/逛感 |
| "NZCPE"/"中国商品展"类品牌词 | ~0 | — | 品牌还没起来，别指望品牌词流量 |

**内容不要围着"贸易博览会"这个品牌讲，要围着"奥克兰周末免费亲子活动/美食文化"这个真实搜索意图讲。** 品牌名放标题/角标，钩子用受众真正在搜的东西。

---

## 二、内容日历（倒计时节点）

今天 2026-08-05，距开幕 20 Nov 还有约 15 周。分四个阶段，内容同时服务"自然搜索(如果做博客)"+"广告素材"两个用途。

### 阶段一 · T-15 至 T-8 周（8/5 – 9/26）：认知铺垫
低频、攒素材、测试钩子，不急着大量花钱。
- 3-4 条素材：往届活动氛围片段（人潮、美食摊位、文化表演、开幕嘉宾）——用现有 2024/2025 图库（`assets/img/photos/`）剪成 15-30s 竖版视频
- 1 张"日期公布"海报（倒计时+三条报名入口）
- 主打钩子：「奥克兰又办一次超大型中国美食文化周末，还免费」型文案，不提"贸易""展会"这类 B2B 词

### 阶段二 · T-8 至 T-4 周（9/27 – 10/24）：广告起量
预算主力投放期，配合 register-visitor.html 已加的周五开幕仪式报名入口。
- 3 组素材做 A/B：①亲子向（calligraphy & dumpling making 活动）②美食向（tasting 摊位）③文化演出向（Shaanxi 非遗）
- 每组配一条 15s 竖版 + 一张 1:1 图文
- CTA 统一："Free entry — register your pass"，落地页链接 register-visitor.html

### 阶段三 · T-4 至 T-1 周（10/25 – 11/13）：紧迫感
- 倒计时素材（"3 weeks to go" / "2 weeks to go"）
- 开幕仪式专属素材（周五20日，强调"免费但建议提前登记"）
- 加映"已报名 XXX 人"社交证明类文案（真实数字，从表单后台实时取，不能编）

### 阶段四 · T-1 周至开幕（11/14 – 11/22）：最后冲刺 + 现场
- 每日倒计时 + "本周末就是了"
- 开幕当天/周末现场花絮（如果有人在现场拍，当天剪当天发，冷启动页面最需要这种真实感）

**素材来源**：往届图库已有（`~/Documents/Claude/Projects/NZCPE/site/assets/img/photos/`），够撑阶段一。阶段二/三需要新素材（AI 图或找摄影师），届时另行沟通制作方式。

---

## 三、Facebook 广告计划

### 账户 & 目标
- 广告账户：待定（[client-brief.md](./client-brief.md) 里記录的两个选项——NZCPE 自建 vs 挂 Magic Engine 现成账户 `1018365291238494`），本计划先按"能投"来写，账户定了直接套
- Meta 后台权限：主页已共享给 Magic Engine 业务组合（内容+广告+成效分析），传播确认中

### 冷启动定向（没有历史数据，不能做 lookalike）
- **地域**：奥克兰为主(broad, 不细分郊区)，次选 Waikato/Bay of Plenty/Wellington
- **兴趣**：Chinese culture / Asian food / family activities / things to do in Auckland / farmers markets — 这几个兴趣包组合广撒网，不要窄
- **年龄**：25-54为主(家庭决策者)，不锁性别
- **语言**：英文+中文双语版素材各投一版，中文版针对"华人社区"兴趣/语言定向单独建 adset

### 阶段化预算建议（具体金额需 PM 拍板，这里给结构不给数字）
| 阶段 | 目标(campaign objective) | 优化目标 |
|---|---|---|
| T-15~T-8周 | Awareness/Video Views | 便宜的曝光和素材测试，找出哪条素材停留时间长 |
| T-8~T-4周 | Traffic / Conversions（Pixel 已装好，`Lead` 事件已在收） | 往 register-visitor.html 引流，优化目标=完成报名 |
| T-4~T-1周 | Conversions | 加大预算，冲报名量，用阶段二跑出来的赢家素材 |
| T-1周~开幕 | Conversions + Reach | 收尾冲量，同时保基础曝光 |

### 前置依赖（跟 client-brief.md 待办对齐，不重复记）
- ~~Meta Pixel：register-visitor.html 目前没有埋 Pixel，投 Conversions 目标前必须先装~~
  ✅ **2026-08-05 已装好，这条前置已解除。** Pixel `1109538797562911` 已装到**全站**，
  三个报名表单（含 `register-visitor.html`）提交成功时触发 `Lead`（GA4 同步 `generate_lead`）。
  详见 [client-brief.md](./client-brief.md)「追踪工具接线状态」。
  **投 Conversions 之前要做的是「验证事件真的在收」，不是再装一次** ——
  重复埋点会造成重复计数，把转化数直接做假。
  验证方法：Meta 事件管理工具看 `Lead` 最近有没有进；或用 Meta Pixel Helper 实际提交一次表单。
- 广告账户定案（NZCPE 自建 or Magic Engine 代投）

---

## 四、跟 SEO 那条线怎么配合

- register-visitor.html 已经是"周五开幕仪式+周六日"三天统一报名入口，广告和自然搜索流量都导到这一个页面，不用分裂多个落地页
- 关键词调研发现的"things to do with kids auckland"(1900/月, 低难度)是新的内容机会——如果后面要做网站博客/news.html 扩展，这个方向比"贸易博览会"品牌词好抓，但**这属于额外工作量，不在这次改动范围内**，先记进 ROADMAP 待 PM 决定要不要做

---

## 待 PM 决定的点

1. 广告预算量级和起投时间（结构已给，金额没定）
2. 广告账户挂谁的（NZCPE 自建 vs Magic Engine 代投）
3. 要不要做"things to do with kids"方向的博客内容（额外工作量）
4. 中文素材由谁写文案/配音（找现成克隆音还是新录）
