# NZCPE 2026 — 网站 SEO 内容计划

> **2026-08-05 方向调整**：PM 拍板改回 B2B 核心——中国企业出海/新西兰入市机会 + 新西兰企业对华商业机会（采购/供应链），不再做 To C 亲子/周末活动方向。下方"七、B2B 方向真实关键词"是新查的数据，第一篇 To C 文章(Family Day)已上线不撤，但后续按 B2B 方向排产。

**建档日期**：2026-08-05 · 关联：[client-brief.md](./client-brief.md) · [content-and-ads-plan.md](./content-and-ads-plan.md)（那份是社媒+广告，这份专门是**网站自然搜索内容**）

---

## 一、现状问题（2026-08-05 已处理，详见 client-brief.md）

`news.html`/首页/`about.html` 里建站时留下的编造内容已清理：假的 Foodstuffs 合作、假的贸易数据彻底删除；场地历史（换到 NZICC）经 PM 确认是真的已恢复；2024 届具体金额、展区面积因拿不到真数字已删除。历史文章的"Read more"仍是死链——那批是纯文字公告没做独立页面，跟这次新增的三篇长文（有真链接）不是一回事，暂不处理。

---

## 二、真实关键词机会（DataForSEO 数据，2026-08-05 查）

| 关键词 | 月搜索量 | 难度 | 意图 |
|---|---:|---:|---|
| things to do with kids auckland | 1,900 | 20（低） | 家庭出行决策 |
| things to do auckland this weekend | 880 | 27 | 周末计划 |
| free events auckland | 320 | 20（低） | 免费活动搜索 |
| family events auckland | 260 | 22 | 同上 |
| food festival auckland | 210 | 29 | 美食活动 |
| weekend markets auckland | 170 | 32 | 市集/购物 |
| auckland trade show | 40 | 28 | B2B(买家/展商) |

品牌词（"NZCPE"等）搜索量≈0，不值得单独做内容优化，靠事件本身+外链慢慢积累。

## 三、内容策略：诚实的落点，不是"奥克兰全攻略"

**红线**：不编造没验证过的奥克兰其他景点/商家信息（客户数据红线）。每篇内容只能围绕 NZCPE 自己真实有的东西展开——brief 里的活动清单、历届数据、场地信息。这意味着内容不是"假装自己是 Auckland 旅游指南"去抢流量，而是"用真实存在的东西，诚实地回答这几个搜索意图"。

## 四、内容排期（按机会值排序，ICE = 影响力×信心×易做程度）

| 优先级 | 目标关键词 | 页面标题(暂定) | 落点 | 状态 |
|---|---|---|---|---|
| 1 | things to do with kids auckland (1900/低难度) | Family Day at NZCPE 2026 — Free Things to Do With Kids in Auckland This November | 亲子活动详情 + 免费入场 + 引到 register-visitor | **本次生成** |
| 2 | free events auckland | Free Events in Auckland This November — NZCPE 2026 Public Weekend | 周末公众日全貌 + CTA 报名 | 待做 |
| 3 | food festival auckland | Food Festival Auckland — Taste China at NZCPE 2026 | 美食摊位/tasting 详情 | 待做 |
| 4 | things to do auckland this weekend | (评估是否跟#1/#2 内容重叠过高，可能合并) | — | 待评估 |
| 5 | weekend markets auckland | (需要更多关于"市集/零售折扣"的真实细节才能写，目前 brief 信息不够) | — | 缺素材，暂缓 |
| 6 | auckland trade show | (B2B 侧，非本轮 To C 重点，暂缓) | — | 暂缓(跟 FDE 接手范围一致) |

## 五、技术执行规范（每篇都要）

跟这次 SEO 技术修复用的同一套：canonical、OG/Twitter Card、Article/FAQPage JSON-LD 结构化数据、加进 sitemap.xml、从 news.html 挂真实链接（不再是死链 `#`）。另外每篇加 AI 可见度块（隐藏 div，给 ChatGPT/Perplexity 之类 AI 抓取用，Magic Engine 内容标准做法）。

## 六、第一篇已上线

**URL**：https://nzcpe.co.nz/family-day-things-to-do-with-kids-auckland.html（2026-08-05 部署并验证生效）
关键词：things to do with kids auckland（1900/月）。所有具体信息（活动/时间/免费入场）均可溯源 Marketing Asset Kit Brief，未添加任何未证实的 Auckland 场馆/商家信息。技术规格：canonical/OG/Twitter Card + Article/FAQPage 双结构化数据 + AI 可见度隐藏块，已加进 sitemap.xml，从 news.html 挂了真实链接（原来那条位置的假新闻卡片没动，只是新增一条在最前面）。

**顺带发现一个站点级小问题**：Cloudflare Pages 对所有 `.html` 页面都会自动 308 跳转到去掉后缀的"干净 URL"（比如 `/about.html` → `/about`），这是这个站从建站起就有的行为，不是这次改动引入的。不影响用户访问、Google 也认跳转，但严格来说这次加的 canonical 标签指向的是会跳转的 `.html` 版本而不是最终地址，属于可以优化但不紧急的项——要彻底解决得把全站内部链接的 `.html` 后缀都去掉，工作量不小，先记录，不在本轮处理。

## 七、B2B 方向真实关键词（2026-08-05 重新查，PM 拍板改方向后）

跟"亲子活动"那批完全不是一个量级——贸易/出海类关键词本来就流量小，符合品牌类目原本的规律。这批内容打的不是"靠自然搜索大流量"，是**dual-track**：搜索量虽小但难度也低容易排到，同时是 AI 问答引擎（ChatGPT/Perplexity）被问"中国企业怎么进新西兰市场""新西兰怎么找中国供应商"时会引用的那种权威内容——服务的是招展商/买家这两条真实业务目标（招160+展商、注册2200+买家），不是流量数字本身。

| 关键词 | 月搜索量 | 难度 | 意图 | 对应受众 |
|---|---:|---:|---|---|
| starting a business in new zealand | 720 | 34 | 泛NZ创业查询，非中国专属 | 出海方(展商) |
| china sourcing agent | 30 | 18（低） | 找中国供应商 | NZ买家方 |
| source products from china | 30 | 26 | 同上 | NZ买家方 |
| china new zealand free trade agreement | 30 | 26 | FTA/政策 | 双方 |
| doing business in new zealand | 30 | 9（很低） | 泛NZ经商 | 出海方(展商) |
| buying from china wholesale | 20 | 0 | 批发采购 | NZ买家方 |
| new zealand china trade | 20 | 0 | 泛贸易 | 双方 |
| trade shows new zealand | 20 | 0 | 展会本身 | 双方 |
| foreign investment new zealand | 20 | 0 | 投资 | 出海方 |

**已排产**：
1. ✅ **已上线** 面向中国出海企业：[How Chinese businesses can enter the New Zealand market](https://nzcpe.co.nz/china-business-entry-new-zealand-market.html)——落点是 NZCPE 展商权益里真实存在的东西（12个月市场进入咨询、NZ 实体注册协助、Superoutlets.co.nz 寄售、免费仓储、booth 定价、申请截止时间），目标词 starting/doing business in new zealand + china new zealand free trade agreement。2026-08-05 部署验证生效。
2. ✅ **已上线** 面向新西兰买家方：[China sourcing for NZ retailers: agents, Alibaba, or a trade show?](https://nzcpe.co.nz/china-sourcing-agent-nz-retailers.html)——中立对比代理/线上平台/展会三条路的真实取舍（不贬低阿里巴巴或代理，只讲权衡），落点是买家真实权益（免费买家证、已审核展商配对、买家休息室、翻译支持、13行业分区、审批2个工作日），目标词 china sourcing agent / source products from china / buying from china wholesale。2026-08-05 部署验证生效。

3. ✅ **已上线** [China-focused trade shows in New Zealand: where NZCPE fits](https://nzcpe.co.nz/china-focused-trade-shows-new-zealand.html)——把 NZCPE 定位成"新西兰唯一专注中国贸易的展会"，目标词 trade shows new zealand（20/月，难度 0，最好排）+ new zealand china trade，落点覆盖展商/买家/赞助商三条路径，赞助五档定价也放进去了（brief 可溯）。2026-08-05 部署验证生效。

**B2B 方向三篇 + 假新闻清理都完成**。`news.html` 现在是 4 条真实长文链接（亲子1篇 + B2B 3篇）+ 4 条真实但无独立页面的公告（申请开放/2025总结/2024总结/换场地）。下一步待 PM 定：继续加第四篇，还是转去做广告/GBP 那些待办。
