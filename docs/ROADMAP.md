# Magic Engine — Roadmap（未完成事项）

> 最后整理：2026-07-25 · **本文件只留未完成的事**（147 条）。
> 已上线的功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。
> 系统当前跑着什么见 [STATE.md](./STATE.md)。架构决策见 [DECISIONS.md](./DECISIONS.md)。
> 完整历史底稿（含 344 条已完成 + 全部 Phase 背景）：[archive/ROADMAP-full-2026-07-25.md](./archive/ROADMAP-full-2026-07-25.md)

**新增任务的规则**：先登记到本文件，再写代码。完成后从本文件删除、追加到 `history/CHANGELOG.md`。commit 带 Phase ID，如 `feat(ads): xxx [P18.B.1]`。

---

## 近期待办（跨 Phase 汇总）

- [ ] **P29.SEO.14** AU/NZ SME service page QA pass - verify titles, canonicals, internal links, sitemap exposure, and only make tiny fixes if the new service pages need one more polish pass.
- [ ] **P30.S2.4** real_estate_auckland 8 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.5** flooring_tiles_brisbane 12 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.6** logistics_3pl_nz 9 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S4.4** real_estate_sydney — 悉尼房产（等客户）
- [ ] **P30.S4.5** real_estate_melbourne — 墨尔本房产（等客户）
- [ ] **P30.S4.6** real_estate_christchurch — 基督城房产（等客户）
- [ ] **P30.S5.5** 前端加趋势列（domain 历史折线 / 14d 30d 涨跌）
- [ ] **P30.S5.6** 异常预警（domain 单次掉分 >10% 报警 FDE）
- [ ] **P30.S5.7** 客户对照视图（客户 vs 行业 P50 折线图）
- [ ] **P31.X.1** 月营收"季度签字对账"流程（避免客户自报数据失真）
- [ ] **P31.X.2** 主指标 measurement='auto' 时自动拉取 current_value（GA4 / SerpAPI / Apify）
- [ ] **P31.X.3** AI 参谋升级：基于历史 outcome 推荐 Initiative 组合（依赖数据沉淀）
- [ ] **P31.X.4** 评分公式重做（reputation / SEO / ai_visibility 维度独立大工程）
- [ ] **P31.X.5** Retention / Reactivation intent（需先接通 CRM/EDM）
- [ ] **P31.X.6** Initiative 类型扩展：Operations / Market Intelligence / Product / Partnerships
- [ ] **P33.11** Goal 详情页 Initiative 卡片展开显示：关联 Campaign 数量 + action 完成率
- [ ] **P33.12** Goal 详情页底部「执行进度摘要」区块（各 Initiative 进度条 + 总数统计）
- [ ] **P34-P3.9**（降级 backlog）`createMcpAuthAdapter(kind)` 抽取防 verifyToken 漂移（两 endpoint 已工作+测试覆盖，纯重构）
- [ ] **二期补强**（狄仁杰/魏征 backlog）：真 colleague-confirm code 流程 · IP 白名单升 DB 强约束 · 过期邮件（依赖 P2 SendGrid）· 老 mcp_access_log.key_id 列下线
- [ ] **P35.7** 转化闭环接线：replied → 发 `/discover` magic link；converted → `converted_client_id` 关联 clients
- [ ] **P35.8** 定价页 / 官网 Digital Foundation 套餐文案（板桥必审：C 端文案）。**退款保证措辞红线（PM 拍板 2026-07-06）**：保证挂「交付」不挂「效果」——「7 天内四项升级全部交付并附验证截图，做不到全额退款」；绝不承诺排名/客流/生意变好（SEO 见效 8-12 周，写效果 = 给退款开后门）；交付验证截图（前后对比）同时是 case study 素材；「提升」的证据由 $199 Keep-Alive 月报在第 2-3 个月兑现（续费 + 升 FDE 钩子）
- [ ] **P35.9** AI 语音外呼（PM 指定方向 2026-07-06）：ElevenLabs Conversational AI / Bland.ai / Vapi 选型 PoC。用途分级：**warm 跟进优先**（邮件已回复/未接来电回拨），cold call 需先查 AU Do Not Call Register 合规（企业号码也可注册 DNC）。AU/NZ 口音语音 + 通话结果回写 outbound_prospects
- [ ] **P35.10** 外呼专用域名（PM 已拍板不用主域）：候选近似域名查询 → PM 选定注册 → SPF/DKIM/DMARC 配置 → 2-3 周预热计划。主域只收回复，保 magic link 通道信誉
- [ ] **P35.11 邮箱深挖（治本，PM 拍板 2026-07-13）⭐**：**「假邮箱」≠「没邮箱」** —— 诊断 9 个被判无邮箱的商家（Maddren Homes / Clinic 1 / ETF Electrical / Roofing Excellence / Space Air / The Cosmetic Store / Factory Carpets / Voltsy / Moore Quality），**全部有真实官网 + 电话，4 家还有在线询盘表单**。根因 = 抓取器只读首页 HTML、抓到主题占位符（`user@domain.com`/Wix `mysite.com`）就当邮箱、漏了真邮箱。三条深挖路径（PM 全部同意）：
- [ ] **P35.12 $19.90 Tripwire Onboarding（获客漏斗第一钩，PM 拍板 2026-07-13）⭐⭐**：一次性 $19.90「onboarding 数字优化」当 tripwire → 建联建信任 → 上钩 $990 套餐（GEO / FB 代运营 / newsletter+WhatsApp）。**设计原则**：每个 $19.9 交付物 = 一个 $990 套餐的「种子」，展示价值同时暴露只有 $990 能补的缺口。
- [ ] **P35.13 社媒内容引擎升级（IG 原生 + 品牌套件，为 $990 代运营铺路）**：现输出主打 FB 文字帖、太粗不符 IG。三支柱：① IG 原生格式模板库（轮播/Reel/精修图/Story）② **每客户品牌套件**（从 logo/官网抽主色+2 字体+滤镜，治「粗犷」根因，精致来自模板不是原始 AI）③ 视频优先（Higgsfield shorts_studio/Seedance 出竖版 Reel + virality_predictor 筛）。能力已有（Atlas/Higgsfield/HeyGen/Publer），缺模板+品牌系统。医美 before/after 有 Meta+NZ 合规限制 → 主打不需临床照的科普/团队/FAQ。**先建一套医美 IG 样板跑通一家再产品化**。此项是「医美 Wave 2」的前置。

## Phase 7 — 遗留尾项 ⚠️ 计划执行日期已过期，需判断是否作废

- [ ] **P7.4.14** 第 2/4 周复跑 AI Tracker，对比排名变化（2026-05-12 执行）
- [ ] **P7.4.15** 第 4 周生成首份月报（2026-05-26 执行）

## H2 规划（Phase 8-10）

- [ ] **P8.2.4** 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn）
- [ ] **P8.P.1** 新建 `paid_ad_sets` 表（client_id / brief_id / set_name / format_matrix / status / created_at）
- [ ] **P8.P.2** 新建 `paid_ad_copies` 表（set_id / format_type / headline / body / cta / visual_prompt / visual_asset_id / status）
- [ ] **P8.P.3** `src/lib/paid-social/brand-dna-extractor.ts` — 从 Master Brief 提炼 Brand DNA（价值主张 / 受众痛点 / 差异化 / 证据点），Strategy Engine（Claude）输出结构化 JSON
- [ ] **P8.P.4** `src/lib/paid-social/ad-copy-generator.ts` — 按格式矩阵批量生成广告文案，Content Engine（GPT-4o-mini）输出，AU/NZ 本地英语拼写强制约束
- [ ] **P8.P.5** `src/lib/paid-social/visual-prompt-builder.ts` — 为每条广告生成配图提示词（结合产品图描述 + 品牌色调 + 格式规格）
- [ ] **P8.P.6** `POST /api/clients/[id]/paid-social/generate` — 触发一次完整生成（brief_id + 可选 format_filter + 可选 reference_image_desc）
- [ ] **P8.P.7** `GET /api/clients/[id]/paid-social/sets` — 广告集列表
- [ ] **P8.P.8** `GET /api/clients/[id]/paid-social/sets/[setId]/copies` — 单集文案列表
- [ ] **P8.P.9** `PATCH /api/clients/[id]/paid-social/copies/[copyId]` — 编辑单条文案 / 更新状态
- [ ] **P8.P.10** `POST /api/clients/[id]/paid-social/copies/[copyId]/generate-image` — 单条文案触发 Visual Studio 配图生成
- [ ] **P8.P.11** 路由 `/dashboard/paid-social/[clientId]` 创建（含客户选择 landing）
- [ ] **P8.P.12** 生成面板：选择 Brief + 勾选格式类型 + 可选填产品图描述 → [Generate Ad Set] 按钮（预估 10 分钟）
- [ ] **P8.P.13** 广告集列表视图（按格式分组 Tab，每条展示 headline / body / CTA / 状态）
- [ ] **P8.P.14** 单条广告卡片：文案内联编辑 + 右侧配图提示词展示 + [Generate Image] 按钮
- [ ] **P8.P.15** 批量操作：[Generate All Images] 一键触发全集配图生成（复用视觉生成队列）
- [ ] **P8.P.16** 侧边栏导航加 "Paid Social 📣" 菜单项
- [ ] **P8.12.S1.6** 张骞 Apify 商业情报扩展 — 社媒真实指标 + FB 广告 + 小红书 + Google Search（张骞按需调用，非每次全跑）
  - [ ] **S1.6b** 小红书 RedNote scraper（新封装 `apify/xiaohongshu-scraper.ts`，actor `zhorex/rednote-xiaohongshu-scraper`）+ `SocialPlatform` 枚举加 `xiaohongshu` + 接入（⚠️ 该 actor 无评价，先小范围实测）
- [ ] **P9.1** 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图）
- [ ] **P9.2** 客户 Portal（client-facing view，只看自己内容 + 当月月报）
- [ ] **P9.3** 站点权威度追踪（DA / 外链 / 内链趋势）
- [ ] **P9.4** Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议
- [ ] **P9.5** 批量执行：一键为所有 approved 策略条目生成对应内容
- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持（中文市场优先）
- [ ] **P10.3** Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做）

## 技术债

- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）
- [ ] **TD.10** Git 本地分支堆积（20+ 个 `claude/*` 和 `feat/*` 废弃分支）
- [ ] **TD.11** `agitated-mahavira-be6d17` 等 worktree 物理目录占用磁盘空间
- [ ] **TD.7** 收集器模块（6 个）缺少错误重试机制
- [ ] **TD.8** 月报聚合库缺少事务型一致性保证
- [ ] **TD.9** 聚合器性能未优化（N+1 查询）
- [ ] **TD.10** 月报查询端点缺少分页 / 排序参数
- [ ] **TD.11** API 缺少速率限制（Rate Limit）
- [ ] **TD.12** 月报页面缺少加载骨架屏（loading skeleton）
- [ ] **TD.13** 分节组件之间缺少交互（drill-down / tooltip）
- [ ] **TD.14** 月报导出功能（PDF / 邮件）未实现（P8.2 任务）
- [ ] **TD.15** 聚合器单元测试覆盖率 < 70%
- [ ] **TD.16** 未做月报端到端测试（CTS Tours 实际客户）
- [ ] **TD.17** 聚合器架构文档缺失
- [ ] **TD.18** 缺少聚合器性能 / 错误监控仪表板

## Phase 11 — Creative Intelligence Engine（未来重点开发方向）

- [ ] Markifact API 能否回传 `creative_parent_id`（绑定我们的 seed creative）
- [ ] Markifact 能否提供"创意 × 受众 × 转化"三维数据切片
- [ ] Supabase `visual_assets` 表加 `embedding vector(512)` + `style_scores jsonb` 列

## Phase 12 — 飞轮数据闭环 ⭐⭐⭐（活跃，2026-05-17 启动）

- [ ] **P8.S.8** — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并）

## Phase 24 — Execution Loop Closure（执行闭环修复）📋 已登记，2026-06-06 启动

- [ ] P24.A.1 migration: `20260606000001_execution_items_zhuge_source.sql`
- [ ] P24.A.2 `action-persister.ts` 新增 `writeExecutionItems` + 接入 `persistZhugeActions`
- [ ] P24.A.3 `__tests__/action-persister.test.ts` 补充测试（TDD 先写）
- [ ] P24.B.1 `src/app/api/cron/zhuge-recalculate/route.ts`
- [ ] P24.B.2 `render.yaml` 追加 cron 定义
- [ ] P24.C.1 `deploy/page.tsx` + `DeploymentForm.tsx` 改造
- [ ] P24.C.2 `publish-geo-snippet/route.ts` 新增路由

## Phase 25 — Self-Serve Portal ⚠️ 已并入 Phase 20.0

- [ ] **P25.A.1** Migration：`public_scan_jobs` 加 `client_id` 可空 FK
- [ ] **P25.A.2** 新建 `POST /api/onboard/self`
- [ ] **P25.A.3** `/prospect` 页面加转化 CTA
- [ ] **P25.B.1** 新建 `/portal/[clientId]/discovery/page.tsx`
- [ ] **P25.B.2** Portal 首页加 Discovery 摘要卡
- [ ] **P25.B.3** PortalNav 加 Discovery 链接
- [ ] **P25.C.1** 新建 `/portal/[clientId]/diagnosis/page.tsx`
- [ ] **P25.D.1** 新建 `/portal/[clientId]/prescription/page.tsx`
- [ ] **P25.D.2** 新建 `/portal/[clientId]/plan/page.tsx`

## Phase 21 — AI Content Factory（旗舰能力 · FDE 默认产能引擎）📋 MVP 计划已登记，待开工 P21.1

- [ ] **P21.J.M1 地基**(≈1 周):migration 7 表 + `clients.brand_redline_phrases` + claim RPC + `content-factory` bucket(**一次 PM 拍板 apply,worker 严禁自行 apply**);`POST /api/factory/signals`;策略 agent 全闸(brief/goal 溯源 + 去重 + fail-closed)+ 工单生成。验收:模拟疲劳信号→带溯源+人话理由的工单;撞红线→人话拒绝;同 ad 重复信号→`duplicate_open_order`
- [ ] **P21.J.M2 生产线**(≈1.5-2 周):本地 worker(claim/heartbeat/complete/fail)+ Video Studio + Edit Engine 接入;独立审核 base `ME Factory Ops`(Factory Review + Winner Intake)+ 双向 sweeper + 审核人白名单;`BrandRedlinesPanel`;muapi 计费模式+视频上传权限双 spike(开工第一天)。验收:PM 在 Airtable 卡片内直接播片,过审/打回(分类+意见)全链路跑通
- [ ] **P21.J.M3 闭环**(≈1-2 周):发布($50 绝对硬顶 + publish_intent 幂等 + publish_failed 收敛)+ UTM 沿用 + 表现回流单链路 + winner 判定拆片入库 + 工厂内部自发疲劳信号。验收:真实成片上 CTS Meta 账户(**PM 显式 go 后才首发**,$10/天×3 天)+ 回流数据落 `flywheel_metrics` + 工作日志人话叙事无"工厂"字眼
- [ ] **开放项**:信号契约与 34.A 对齐冻结(M1 前置)· asset_gap 信号归属 · MTC 计费触点(v1 占位不扣)· Airtable 观测层↔ME 真值同步(M2 起)
- [ ] **P21.J.SEC 接口安全完整审计**:狄仁杰三审报"26 个 `/api/clients/[id]/*` 无鉴权",逐个核实后发现多数(ads 执行/cms 发布)其实已有锁、是误报,真裸奔仅 5 个已补。**需一次系统性复核**:grep 全部 access 守卫关键词 + 逐个确认,把"真裸奔"与"已有锁被误报"彻底分开,补齐真缺的。今天只是止血
- [ ] **P21.J.UP 上传链接两取舍**:①无单条吊销(作废靠换 `UPLOAD_LINK_SECRET`,所有链接一起失效)②无速率限制(有真链接者可刷存储/烧 Vision 额度)。规模化前需补 per-client 限流 + 单链接吊销
- [ ] **本地 worker 没在认领**:今天 00:18 有 CTS 新工单卡在 `queued` 没人做 = 那台 Mac 的 worker 没跑/没连。工厂要真转,先确认 worker 进程在跑(仓库无 launchd/pm2 配置,`ps`/`pm2 list` 上机看)且已在 07-24 后重启(否则风格下发用旧逻辑)
- [ ] **`FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿**:未配时片子 `status=published`+三落库全绿,FB 主页却只是没人看见的 DRAFT。验完草稿格式后 PM 显式在 Render 设 `=true` 才真发
- [ ] **`auto_order_enabled` 无客户开启**:调度器每天照跑但一单不下(安全默认)。要工厂自己下单,逐客户开;首个跑通客户 = CTS
- [ ] **`creative_profile` 无客户填**:出片风格仍全靠本地 JSON。CTS 现有风格(龙旗破云/golden_hour/短句大字/xfade 0.35)可抄进 ME 配置页接管
- [ ] **1 条 `rendered` 旧单**(CTS 07-12,有 caption)永久卡住:交付直连修复只对新单生效,这条旧单需手动迁 `in_review` 或归档(PM 判断)
- [ ] **P21.K.7 ad 级数据脊柱**(登记 2026-07-25,PM 拍板):日度 cron 补拉 **ad 级**(每条广告每天一行,复用 `ad_daily_insights` 的 `level='ad'`),让「某天新增了哪条广告 / 哪条在拖后腿」可被系统自查,不依赖 Meta MCP(Oztop 账户未开通)也不用人翻广告后台。**背书案例**:Oztop Lead Form Cold Broad 的 CPL 7/17 起翻倍,campaign 级只能定位到「填表率腰斩 + 出现出站点击」。含 `parent_id` 列(ad→campaign 归属,**migration 待 PM `go apply`**)+ 首拉 30 天回补 + 分页完整性守卫。顺带铺好 34.B Creative Lifecycle 要的作品层日度基础设施
- [ ] **多视角对抗复盘工作流**(1-2 天,可后置):battle-plan §8 方法论固化成可复用 Workflow/agent(N 视角互相证伪前提 → 作战计划 → 喂鲁班),异常触发非每日跑
- [ ] **开放项**:三张新表 migration 逐次 PM `go apply`(`ad_daily_insights` / `ad_strategy_configs`+`_triggers` / `ad_health_narratives`)· P5 泛化首批客户(Oztop?)· 姊妹 spec Creative Lifecycle 同一 GHA 笔误待独立小 PR 修

## Phase 27 — Visual Reference Library（视觉参考库）📋 已登记，待开发

- [ ] **P27.1** — DB migration：`visual_reference_library` 表
- [ ] **P27.2** — FDE 上传 UI：Assets 页面「参考库」标签，支持批量上传 + 标注来源（FDE/客户/竞品）
- [ ] **P27.3** — GPT-4o Vision 分析管道：提取配色 + 构图 + 元素类型 + 风格标签
- [ ] **P27.4** — 行业标签过滤 + 相似图搜索（pgvector embedding）
- [ ] **P27.5** — 视觉得分：参考 viral_score 逻辑，给每张图打 1-10 分
- [ ] **P27.6** — 竞品爬取接入：URL 输入 → Jina.ai 抓取 OG 图 → 自动入库分析
- [ ] **P27.7** — AI Factory 注入：图片/封面生成时，从参考库取 top-3 相似风格约束注入 prompt
- [ ] **P27.8** — 参考库浏览 UI：瀑布流展示 + 筛选 + 得分排序 + 删除

## Phase 28 — FDE Inbox（待处理收件箱）📋 已登记 · ⚠️ 待并入 Phase 20.D（统一看板扩展）

- [ ] **P28.1** — DB migration：4 张产物表各加 `reviewed_at TIMESTAMPTZ`
- [ ] **P28.2** — 执行看板顶部「📥 待处理」收件箱区域 UI（聚合查询 + 时间倒序）
- [ ] **P28.3** — 收件箱条目点击展开 + 「标记已读」动作（PATCH reviewed_at）
- [ ] **P28.4** — 「发送到看板」后写入 reviewed_at=NULL（已是默认，确认 reels_drafts 行为）
- [ ] **P28.5** — 收件箱 badge 计数：侧边栏「执行看板」入口显示未读数

## Phase 29 — Unified User Experience（统一用户体验 · Portal/Dashboard 合并 + Self-Serve 准入门）📋 已登记，待开工

- [ ] **P29.C.1** — Brief 填写页 `/dashboard/clients/[id]/brief`：5 字段表单 + 保存 → `brief_completed_at = NOW()`
- [ ] **P29.C.2** — `BriefGateBanner` 通用组件：检查 `isBriefComplete`，未完成时显示 Banner + 内容操作区覆盖半透明蒙层
- [ ] **P29.C.3** — 接入内容生成页（博客 / 社媒 / Reels Studio）
- [ ] **P29.C.4** — 接入执行看板顶部
- [ ] **P29.C.5** — 接入 Launch Hub
- [ ] **P29.D.1** — AI Agent 辅助补 Brief：给出公司名 / 网址后 AI 自动提议 5 字段（可编辑确认）
- [ ] **P29.D.2** — Brief 完成后可随时在 Settings 页完善为 Full Brief

## Phase 36 — Voice Agent（AI 电话销售/客服）🔄 建设中

- [ ] 首呼后校准 `mapRealtimeEvent`（需真呼一次才知实际事件名）
- [ ] **0. 真机 spike**（验 verbatim 哑巴模式，最先做 · 1d）— 决定后 3 周走法
- [ ] 1. **真实外呼发起**（现为 mock stub，provider 真拨号 API · 2–3d）
- [ ] 2. 浏览器↔通话实时通道（SSE 下行 + POST 上行 · 3–4d）
- [ ] 3. operator 编排层（STT→翻译/KB→注入 · 3–4d）
- [ ] 4. bridge 改造（逐字朗读 + 哑巴模式 + 垫场 · 4–6d）
- [ ] 5. 操作台 UI（纯语音，双语字幕+模式开关+价格确认+kill switch · 4–5d）
- [ ] 6. 操作员语音转文字 STT 接入（1–2d）
- [ ] 7. 安全（通道租户鉴权 + kill switch + 掉线兜底 · 2–3d）+ 狄仁杰攻击验证
- [ ] 8. 填充语/轮次管理/快捷话术打磨（2–3d）
- [ ] 9. 合规（披露脚本 + DNC + 录音，**过法务** · 1–2d + 法务）
- [ ] WhatsApp 文字 + 语音消息（P1）
- [ ] CRM adapter（接外部 CRM，现只内置权威）
- [ ] 全自动外呼 campaign（批量）+ suppression 逻辑
- [ ] 生产级知识库（OpenAI 向量库语义检索，替代关键词版）
