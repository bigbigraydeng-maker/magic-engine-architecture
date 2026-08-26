# Magic Insight（market-intel）设计文档

> 内部代号 `market-intel`，对外/邮件产品名 **Magic Insight**。PM 个人使用的每日全球
> AI / 数字营销资讯雷达，纯内部工具，不面向客户，不对外发布。
>
> **文档状态说明**：本文档在 v1→v2 设计审之后的原始版本，因一次并发会话事故
> （另一个窗口在主仓库目录跑了 `git reset`，冲掉了当时未提交的文档文件，见
> [docs/history/CHANGELOG.md](../history/CHANGELOG.md) 2026-08-20 条目）实际丢失、
> 从未真正进过仓库——CHANGELOG 和 PR #1112 引用的这个路径此前是个死链接。
> 本文档是 2026-08-21（v3 扩展同一个 PR）按代码当前真实状态重建的，historical
> v1→v2 review 的具体逐条修复内容已不可完整复原，只保留结论性总结。

## 一、目标

PM 每天收到一封邮件（发到 `hello@`），汇总过去一天全球范围内：
- AI 创业动态、大模型（Grok / DeepSeek / Claude / OpenAI）产品与行业动态
- 数字营销大盘（含澳新 / 东南亚 / 中东企业数字营销）
- Meta / Facebook / Instagram 广告、Google Ads、TikTok 广告、ChatGPT 广告
- 中国企业出海新闻

不对外发布、不展示在官网（早期设计曾包含官网展示，PM 2026-08-19 明确收窄为纯个人使用，见 §12 PM 决策记录）。

## 二、核心约束

1. **不编造事实**：AI 只做翻译/压缩，绝不允许添加原文没有的信息、数字、公司名。
2. **跨信源去重**：同一条新闻从多个信源重复抓到只发一次；且要用真正发过的
   `digests` 表做 7 天去重窗口，不是所有抓到过的 `items`（否则一条新闻抓到过
   一次、哪怕当天没入选，也会永久失去未来再次入选的资格）。
3. **信源健康度监控**：区分"请求本身失败"（连续 N 次报警）和"抓到 0 条新条目"
   （不算故障）；此外要监控"分类级"零命中（某分类连续 N 天候选池零命中，
   覆盖"单个信源都活着，但整体覆盖不住这个分类"的盲区）。
4. **AI 摘要事实核对（grounding）**：摘要生成后自动核对——摘要里出现的英文
   专有名词和数字，是否都能在原文摘录里找到。核对不过不进邮件，留库供人工翻查，
   不是静默丢弃、也不是完美事实核查（数字格式变化会有已知误判，可接受）。

## 三、分类与信源（v3，2026-08-21）

首日实跑（v1 上线当天）只收到 4 条，且 3 个分类（Meta/TikTok/LLM）候选池
零命中——诊断出信源覆盖不够广、且分类范围本身太窄（`llm_pricing` 只收定价新闻）。
PM 反馈后做了这次扩展，把 6 类扩到 8 类，信源从 12 个扩到 20 个。

### 8 个分类

| 分类 key | 中文标签 | 判定方式 |
|---|---|---|
| `ai_startup` | AI 创业动态 | 来源即数（垂直媒体已收窄话题） |
| `llm_news` | 大模型动态（Grok/DeepSeek/Claude/OpenAI） | 来源即数（v3 从 `llm_pricing` 改名放宽，不再局限于定价） |
| `marketing` | 数字营销大盘（含澳新/东南亚/中东） | 来源即数 |
| `meta_ads` | Meta/Facebook/Instagram 广告 | 标题/摘要完整短语白名单命中 |
| `google_ads` | Google Ads | 白名单命中 |
| `tiktok_ads` | TikTok 广告 | 白名单命中 |
| `chatgpt_ads` | ChatGPT 广告 | 来源即数（v3 新增） |
| `china_outbound` | 中国企业出海 | 来源即数（v3 新增） |

判定逻辑见 [`src/lib/market-intel/categorize.ts`](../../src/lib/market-intel/categorize.ts)：
`matchCategory` 按信源声明的候选分类顺序逐个尝试，无白名单的分类"来源即数"，
有白名单的分类要求标题或摘要包含完整短语（大小写不敏感，不做拆词模糊匹配——
避免"Meta 财报"这类泛科技新闻被误判进 `meta_ads`）。

### 20 个信源

v1 原有 12 个（TechCrunch AI、VentureBeat AI、Search Engine Land、Search Engine
Journal、SEJ·PPC、Marketing Dive、AdExchanger、Digiday、Social Media Today、
HubSpot Marketing Blog、PPC.org、OpenAI News）全部保留，见
[`src/lib/market-intel/sources.ts`](../../src/lib/market-intel/sources.ts)。

v3 新增 8 个（2026-08-21，逐个用真实抓取路径——同生产 UA 的 `fetch` + `rss-parser`
解析，不只是网页工具能读——验证过）：

| 信源 | 分类 | 备注 |
|---|---|---|
| Google News · xAI/Grok | `llm_news` | 裸查询 "Grok" 混进大量诉讼/儿童安全新闻，加了排除词才干净 |
| Google News · DeepSeek | `llm_news` | 查询本身干净 |
| Google News · Anthropic/Claude | `llm_news` | 查询本身干净 |
| Google News · ChatGPT Ads | `chatgpt_ads` | 查询本身很精准 |
| Google News · 中国企业出海 | `china_outbound` | 4/5 命中真正相关，1/5 是"外企在中国"反向新闻，可接受 |
| Mumbrella | `marketing`（澳新） | 澳新营销行业媒体，真实 RSS |
| Marketing-Interactive | `marketing`（东南亚/APAC） | 真实 RSS |
| Campaign Middle East | `marketing`（中东） | 真实广告营销行业媒体；曾先选 MenaBytes，实测生产同款 UA 直接 403（泛创投媒体也不对口），换成这个 |

**已知取舍，不是 bug**：
- 北美没有单独信源——12 个 v1 信源本身就是英文商业媒体，默认底色已经是北美为主。
- Google News RSS 的 `<link>` 是跳转链接不是原文直链，点开会多一次 Google 中转
  （不影响事实核对，grounding 检查用的是 `contentSnippet` 不依赖这个链接）。
- Instagram 广告没有单独信源，走 `meta_ads` 白名单加了 "Instagram Ads" /
  "Instagram advertising" / "IG Ads" 三个短语，靠已有的 AdExchanger/Digiday/
  Social Media Today 等信源自然命中。

## 四、数据模型

四张表，全部不挂 `client_id`（ME 自身内容资产，不属于任何客户），全部
`FOR ALL TO service_role USING (true)`：

- `market_intel_sources` — 信源配置 + 健康度计数
- `market_intel_items` — 抓取到的原始条目（跨信源、跨天查重靠 `dedupe_hash`）
- `market_intel_digests` — 真正发进邮件的成品（`grounding_check` 记录核对结果）
- `market_intel_daily_notes` — 每日编者按

详见 [`supabase/migrations/20260820000001_market_intel_v1.sql`](../../supabase/migrations/20260820000001_market_intel_v1.sql)（已 apply 到生产，RLS 已独立验证）。

## 五、Pipeline 阶段

`src/lib/market-intel/pipeline.ts` `runMarketIntelDaily()`：抓取信源 → 分类匹配 →
落原始条目 → 7 天去重 + 每分类最多 2 条（`MAX_PER_CATEGORY`） → AI 摘要 + grounding
核对 → 落成品行 → 分类健康度检查 → 发邮件 → 健康度报警（信源级 + 分类级）。

**分类健康度检查有个 day-1 假警报 bug，已修复**（PR #1124）：pipeline 自己
才跑第一天时，任何 0 命中的分类都会被误判成"连续 5 天零命中"。修复用
`market_intel_sources` 最早的 `created_at` 当 pipeline 出生锚点，窗口没跑满
就跳过报警。

## 六、Cron

`render.yaml` 的 `market-intel-daily`，每天 UTC 18:00（NZ 早上）跑一次，
`/api/cron/market-intel-daily`，走 `fromGroup: me-shared-cron-secret`。

**未接**：healthchecks.io 监控 ID（需要有权限的人手动申请）。

## 七、风险分级

**B 级**（普通业务逻辑，内部工具，不面向客户，无资金/发布/不可逆副作用）：
核心单测（20 个，覆盖去重/分类/事实核对/时区）+ `npm run build` 通过 +
一次集中 review，不需要 A 级强度的 mutation 全跑。

## 八、PM 决策记录

- 2026-08-19：官网展示范围收窄为纯个人使用，明确"忽略版权和'是否达成营销目标'
  这个问题——这里主要是让我能与时俱进"。
- 2026-08-20：范围削减尝试（GitHub 评论触发 `claude[bot]` 改成极简版）被 PM
  拍板覆盖，保留完整版（四表 + AI 摘要 + grounding + 健康监控）。
- 2026-08-20：建表批准。
- 2026-08-21：首日实跑反馈"还是有点偏"，扩展出这次 v3（8 分类 / 20 信源）。
