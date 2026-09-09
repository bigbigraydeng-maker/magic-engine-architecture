# Creatomate Connector 接入计划 · 内容工厂第三条渲染路径 · spec v1

> 起草：Claude Code · v1 2026-09-09
> Tier 判定：**L3 Connector**（me-platform-tier-gate 已过，理由见 §2）——挂在既有「内容工厂」能力下，不新增能力线，不登记 platform-candidates
> 对外大白话名（提案，待三审确认）：复用 **Video Studio**（CLAUDE.md 现有映射表 Seedance→Video Studio；Creatomate 和 Seedance 对客户来说都是"把素材变成视频"，选型细节不该让客户感知）
> 状态：spec · 未写任何生产代码 / migration / cron
> 数据来源声明：Creatomate API 字段/端点/计费公式全部来自官方文档实测抓取（2026-09-09，逐条附来源），价格页 Essential 月费 $54 为 PM 口头拍板（官方定价页价格数字为前端动态渲染，抓取工具拿不到，本 spec 不冒充查到）；仓库现状盘点为 2026-09-09 只读 grep + 文件阅读，逐条附 `文件:行号`
> 前情：延续 window bda74d92 的 4 个已合 PR（[#1351](https://github.com/bigbigraydeng-maker/magic-engine/pull/1351) / [#1360](https://github.com/bigbigraydeng-maker/magic-engine/pull/1360) / [#1367](https://github.com/bigbigraydeng-maker/magic-engine/pull/1367) / [#1373](https://github.com/bigbigraydeng-maker/magic-engine/pull/1373)）和 [#1396](https://github.com/bigbigraydeng-maker/magic-engine/pull/1396) 登记的分档配额闸候选

---

## 0. 一句话

**PM 已经在 Creatomate 可视化编辑器里手搭好模板、踩完了 5 个没文档的坑（见 §5）；这次要做的不是"要不要用 Creatomate"（已拍板），是把"提交渲染 → 等结果 → 落库"这条链路从"人在编辑器里点"变成"代码调 API 自动跑"，而且要按 CLAUDE.md 的 Inngest 硬约束把这条外部副作用链路做成可审计、fail-closed 的。quota 闸和后台选模板 UI 这次不做，留好接口，等跑起来再加。**

---

## 1. 现状盘点（2026-09-09 只读 grep）

| 检查项 | 结果 |
|---|---|
| `src/lib/creatomate/` 是否已存在 | **不存在**（`ls src/lib` 无此目录），本次是从零建 |
| `docs/STATE.md` / `docs/ENV.md` / `docs/PITFALLS.md` 是否已登记 Creatomate | 均**未登记**，只在 `docs/history/CHANGELOG.md`（PR #1373 提及）和 `docs/registry/platform-candidates.md`（#1396 候选备注）里作为"未来依赖"提到过 |
| `package.json` 是否已有 creatomate/ffmpeg/remotion 相关依赖 | 无。Creatomate 走纯 REST API，不需要 SDK 依赖 |
| 现有视频渲染管线 | `content_factory_render_jobs` 表（[`supabase/migrations/20260731081328_content_factory_render_jobs.sql`](../../supabase/migrations/20260731081328_content_factory_render_jobs.sql)），状态机 `queued→planning→rendering→assembling→ready_for_review／failed`，由**本机 worker**（`scripts/factory-worker/`）驱动：[`render-pipeline.ts`](../../src/lib/factory/render-pipeline.ts) 出分镜+配音，[`render-assemble.ts`](../../src/lib/factory/render-assemble.ts) 用 ffmpeg 拼接（"需 ffmpeg+PIL，只在 worker 容器里跑"） |
| 现有云端 Inngest 架构 | 双 app 隔离：云端 `magic-engine-web`（前缀 `cloud-`）vs 本机 worker `magic-engine-cts-workflow`，**一事件一主**，`WORKER_OWNED_EVENTS` 契约测试锁死跨 app 越权（[`src/lib/inngest/client.ts:32-38`](../../src/lib/inngest/client.ts)） |
| 现有云端 Inngest 函数范式 | fanout + 单客户处理两函数分离，回执落 `cronRunHandle`/`startCronRunId`（[`src/lib/inngest/functions/flywheel-seo-weekly.ts`](../../src/lib/inngest/functions/flywheel-seo-weekly.ts)） |
| MTC 配额闸参考实现 | [`src/lib/mtc/budget-guard.ts`](../../src/lib/mtc/budget-guard.ts)（`checkBudget`/`getMonthlySpend`），本次**不接线**，只留字段 |
| `clients.factory_config` 结构 | 松散 jsonb，逐文件内联断言读取（如 `render.voice_id`、`render.avatar_image_url`，见 [`render-pipeline.ts:26-32`](../../src/lib/factory/render-pipeline.ts)），无中心 schema——本次沿用同一惯例，不新建中心化配置系统 |

**前情 4 个 PR 实际做了什么**（澄清：都不是 Creatomate 连接器本身）：
- #1351：写规则"做模板前先查爆款配方对账"（纯文档）
- #1360：把 `imageToClip()` 从 `generateBrollClip()` 抽出来复用，顺带把 Muapi 单价从错误的 $0.15 修正为实测 $0.30/条
- #1367：写规则"发片前先出分镜自检表"（纯文档）
- #1373：`verifyPlaceProvenance` + `classifyRenderMode` 两个纯函数 + 测试，**尚未接进 live 出片管线**
- #1396：登记"分档 AI 视频配额闸"候选，**明确写了依赖"接 Creatomate Connector"落地**——本 spec 就是那个依赖

---

## 2. Tier 判定（me-platform-tier-gate Inline）

**建议层级**：L3 Connector

**判据**：对接外部系统（Creatomate 渲染引擎）的 Act（提交渲染）+ Read（查状态/拉结果）+ Listen（webhook 回调）三项都占，provider-specific 逻辑（API 字段、认证方式、credit 计费公式）全部封在 `src/lib/creatomate/` adapter 内，不泄漏进 shared runtime；不同客户可以配不同 `template_id`（可挂可摘）。

**红线检查**：
- 红线 1（禁包装升级）：✓ 不包装成"智能层"，明确是外部渲染引擎的执行手
- 红线 2（禁客户事实进 shared runtime）：⚠️ 需要在实现时守住——`template_id` / `modifications` 映射必须走 `clients.factory_config`（客户配置），**不能**把某个客户（如 CTS）的 `template_id` 硬编码进 `src/lib/creatomate/` 任何文件
- 红线 3（禁直建 L1）：N/A，本来就判 L3，不占候选名额
- 换客户测试：✓ 连接器本身（认证/提交/轮询/webhook 解析）对任何客户行为一致；唯一因客户而变的是 `template_id` 和 `modifications` 的值，走配置注入

**结论**：不登记 `platform-candidates.md`，直接进入实现设计。

---

## 3. Creatomate API 实测摘录（2026-09-09 抓取官方文档，全部标来源）

来源：[creatomate.com/llms/api.md](https://creatomate.com/llms/api.md)、[creatomate.com/llms/quick-start.md](https://creatomate.com/llms/quick-start.md)、[creatomate.com/llms/credits.md](https://creatomate.com/llms/credits.md)（Creatomate 官方发布的 AI-可读文档索引，比营销页更接近真实字段）

### 3.1 端点与认证

| 项目 | 值 |
|---|---|
| 认证 | 每个请求带 `Authorization: Bearer <project API key>` |
| 提交渲染 | `POST https://api.creatomate.com/v2/renders`，body：`{ template_id, modifications, webhook_url? }` |
| 查询状态 | `GET https://api.creatomate.com/v2/renders/{id}` |
| 限流 | 约 **30 请求 / 10 秒 / key** |
| 错误格式 | 400/401/402/404 返回 `{ "hint": "...", "documentation": "..." }`；429 返回纯文本（不是 JSON，解析代码要分支处理） |
| 输出文件保留期 | **渲染产物 30 天后过期**——必须在拿到 `url` 后立刻转存到 Supabase Storage，不能只存 Creatomate 的临时链接 |

### 3.2 渲染状态机

```
planned → waiting → transcribing → rendering → succeeded | failed | cancelled
```
成功时响应带 `url`（产物地址）；失败时带 `error_message`。**这是终态枚举，我们自己的 `content_factory_render_jobs.status` 不能直接照抄**——要映射成既有的 `rendering → assembling → ready_for_review／failed`（细节见 §4.2）。

### 3.3 Webhook（⚠️ 关键缺口，见 §6.1）

官方示例确认 `webhook_url` 放在提交请求体里，渲染完成后会 POST 到这个地址。**但官方文档没有说明**：
- webhook payload 的具体字段结构
- 是否对 webhook 请求做签名（HMAC 或类似机制）验证来源

这不是我们没查到——是官方 AI-可读文档本身就没写。**默认必须当作"无法验证来源"处理**（见 §6.1 的安全设计）。

### 3.4 Credit 计费公式（用于成本核算，§7）

| 类型 | 公式 |
|---|---|
| 图片 | 固定 1 credit（任意分辨率） |
| 视频 | `width × height × frame_rate × duration(秒) ÷ 100,000,000`，向上取整 |
| 自动字幕 | 10 credits/分钟（仅当超过渲染本身成本时才计） |
| 便宜测试 | 编辑器预览免费；`snapshot_time` 出静帧只要 1 credit；`render_scale: 0.5` 草稿约省 3/4 成本 |

官方示例：1080×1920 @ 30fps 竖屏视频 ≈ **37.3 credits/分钟**。

---

## 4. 架构设计

### 4.1 定位：第三条渲染路径，不是替换

ME 现在有两条内容生产线（见 memory `project-me-video-two-line-strategy`）：真图蒙太奇（ffmpeg 拼接，`render-assemble.ts`）和 i2v 工厂（Muapi 逐帧重画）。Creatomate 是**第三条**：**结构化品牌模板渲染**——PM 在可视化编辑器里设计好版式（logo 位置、字幕条、价格卡、片头片尾），代码只负责填值（图片 URL / 文案 / 客户 logo），不负责设计。三条路径服务不同场景，互不替代。

新增 `content_factory_render_jobs.render_engine` 字段（`'ffmpeg' | 'creatomate'`，默认 `'ffmpeg'` 保持向后兼容），由 `clients.factory_config.render.engine` 决定客户走哪条路。

### 4.2 状态机映射

| Creatomate 状态 | 映射到 `content_factory_render_jobs.status` |
|---|---|
| `planned` / `waiting` / `transcribing` / `rendering` | `rendering`（复用既有值，不新增） |
| `succeeded` | 先转 `assembling`（转存产物到 Supabase Storage 这一步），转存成功后 `ready_for_review` |
| `failed` / `cancelled` | `failed`，`error` 字段写 Creatomate 的 `error_message` |

### 4.3 目录结构（L3 Connector）

```
src/lib/creatomate/
  client.ts        — 认证 fetch 封装：Bearer header、429 纯文本 vs 4xx JSON hint 分支解析、限流退避
  types.ts         — CreateRenderParams / RenderStatus / RenderResult
  render.ts         — submitRender() / getRender() / pollUntilTerminal()（webhook 超时兜底用）
  cost.ts           — creditsForVideo(width, height, fps, durationSec) / creditsToUsd()（§7 公式的唯一实现处，禁止别处重算）
  __tests__/
```

### 4.4 Inngest 工作流（CLAUDE.md 硬约束：跨步骤异步接力 + 外部副作用 → 必须 Inngest）

沿用 `flywheel-seo-weekly.ts` 的云端函数范式（[`src/lib/inngest/client.ts`](../../src/lib/inngest/client.ts) 的双 app 隔离规则）：

1. `runRenderGeneration()` 完成分镜/素材后，若 `render_engine === 'creatomate'`，改为发 Inngest 事件 `me/factory.creatomate_render.requested`（`{ jobId, clientId, templateId, modifications }`），**不再**调 `render-assemble.ts`（ffmpeg 路径专属）
2. 云端函数 `cloud-factory-creatomate-render-submit`：`step.run` 提交渲染（带 `webhook_url` 指向新端点 + jobId 标识），落 `creatomate_render_id`
3. **双保险**（因为 §3.3 webhook 字段/签名文档缺失，不能只信 webhook）：
   - `step.waitForEvent('me/factory.creatomate_render.webhook_received', { match: 'data.jobId', timeout: '15m' })`
   - 超时未收到 webhook → 兜底 `step.run` 直接 `GET /v2/renders/{id}` 轮询确认真实状态，不能因为等不到 webhook 就假设失败或假设成功
4. 拿到 `succeeded` + `url` 后：`step.run` 下载产物 → 上传到 Supabase Storage `content-factory` bucket（复用 `render-assemble.ts` 已用的同一个 bucket，见 [`render-assemble.ts:10`](../../src/lib/factory/render-assemble.ts)）→ patch job 到 `ready_for_review`
5. 回执字段（CLAUDE.md Inngest 硬约束要求的机器可读 receipt）：`request_id`（Inngest event id）、`client_id`、`source_record_id`（render job id）、`status`、`cost_usd`（§7 公式算出）、`no_publish: true`（连接器只产出素材，不触碰任何对外发布/客户可见渠道，发布授权是下游 `review_actions.ts` 的事，本连接器不碰）、`created_at`。落在 `content_factory_render_jobs` 本行（`cost_usd`/`error`/`updated_at` 已有字段）+ Inngest 自带的事件历史，**不新建独立 receipts 表**（沿用现有做片任务表就是回执落点的惯例）——这一点留给子牙确认是否够用

### 4.5 Webhook 接收端点

`src/app/api/webhooks/creatomate/route.ts`：接 Creatomate 的 POST，只做一件事——把 payload 转成 Inngest 事件 `me/factory.creatomate_render.webhook_received` 发出去，不在这个端点里做任何业务判断（业务判断留给上面 step 4 的云端函数，同一事件不能两处处理，呼应"一事件一主"）。

### 4.6 数据模型改动

```sql
ALTER TABLE content_factory_render_jobs
  ADD COLUMN render_engine text NOT NULL DEFAULT 'ffmpeg',
  ADD COLUMN creatomate_render_id text;
```
风险低（纯加列带默认值，向后兼容，不影响现有 ffmpeg 路径任何一行）。

### 4.7 新增 env

`CREATOMATE_API_KEY`（渲染 API 用）、`CREATOMATE_WEBHOOK_SECRET`（§6.1 提出的缓解方案，若采纳）——本次 spec 阶段只登记名字，不写值，落地 PR 里再进 `docs/ENV.md`。

---

## 5. 官方文档没写、PM 实测踩出来的 5 个坑要不要进代码

结论：**四个坑发生在"PM 在可视化编辑器里设计模板结构"这一步，连接器代码管不到**；只有一个跟连接器代码直接相关。逐条对齐 memory `reference-creatomate-silent-failures`：

| # | 坑 | 谁的责任范围 | 本 spec 怎么处理 |
|---|---|---|---|
| 1 | 动画 `"time": "end"` 元素静默消失 | 模板结构（编辑器） | 连接器不生成/不改动画时间轴，只填 `modifications` 值，管不到；进 §8 模板设计检查清单 |
| 2 | audio 元素不写 `duration`，撑爆全片时长 | **两边都有关系** | 若某模板允许通过 `modifications` 替换背景音乐 URL，`render.ts` 的 `submitRender()` 必须**强制**同时要求传 `duration`（该 key 不存在则拒绝提交，不静默放行）——这是唯一进代码断言的坑 |
| 3 | image 只给 width 不给 height，铺满全屏 | 模板结构（编辑器） | 同 #1，进检查清单 |
| 4 | 用 x_alignment/y_alignment 当定位 | 模板结构（编辑器） | 同上 |
| 5 | 同 track 号后加的顶掉先加的 | 模板结构（编辑器） | 同上 |

**渲染验证铁律**（承接 memory "预览黑 ≠ 模板坏，别据此改模板；用渲染验证"）：连接器测试和上线前必须对一条真实 render 走完整 submit→poll→拿到 `url`→打开验证，不能只信编辑器预览通过。

---

## 6. 未决问题（留给三方复审拍板，spec v1 不擅自下结论）

### 6.1 Webhook 安全 ⚠️（魏征重点）

官方文档没提供 webhook 签名机制，端点等于"任何人知道 URL 就能 POST 一个假的 `succeeded` payload 进来"。候选缓解方案（未选定）：
- A. Webhook URL 里带一次性 token 查询参数（`?token=<random>`，每个 job 生成一个，比对后立刻失效）
- B. 收到 webhook 后不直接信任，仍然用 §4.4 步骤 3 的轮询结果做最终确认（webhook 只当"提前触发轮询"的信号，不当"事实来源"）
- **本 spec 倾向 B**（webhook 只做"加速"，事实来源永远是轮询 `GET /v2/renders/{id}` 的真实返回）——因为 A 需要额外一张 token 表，B 零新增状态、attacker 伪造 webhook 最坏情况只是白轮询一次，不会导致假成功落库。请子牙/魏征确认这个判断。

### 6.2 超出 2,000 credits/月怎么办

官方定价页价格数字是前端动态渲染，本次没能实测到 Essential 档超额计费规则（按量加购还是硬顶）。**这是一个真实缺口，不是我编的答案**——落地前必须由 PM 去后台或联系 Creatomate 支持确认，否则超额时的行为（继续扣钱 / 直接拒绝渲染）无法在代码里正确处理。

### 6.3 首个试点客户 / 模板

前情 4 个 PR 的实测场景全部是 CTS 圣诞团 reel。本 spec 假设首个接入客户是 **CTS**，`template_id` 来自 PM 已经在编辑器里搭好的模板。若试点客户另有安排，需要在实现前明确（走 `clients.factory_config.render`，不影响架构，只影响首个真实验证对象）。

---

## 7. 成本测算（真实公式代入，不是拍脑袋）

Essential 档：PM 拍板 **$54/月**，官方文档确认额度 **2,000 credits/月**（[creatomate.com/pricing](https://creatomate.com/pricing) 页面文字，价格数字未抓到但额度数字抓到了）。

按 §3.4 公式：$54 ÷ 2,000 credits ≈ **$0.027/credit**（均摊单价，用于 `cost_usd` 记账，即便订阅制下"边际成本"在额度内是 $0——为了利润率核算不能让这部分渲染显示为免费，参考 PR #1396 对 Muapi 单价校准的同一原则）。

| 场景 | credits | 均摊成本 | 月度容量上限（吃满 2,000 credits） |
|---|---|---|---|
| 1080×1920 @ 30fps，30 秒竖屏 reel | ≈18.65 | ≈$0.50 | ≈107 条/月 |
| 1080×1920 @ 30fps，60 秒竖屏 reel | ≈37.3 | ≈$1.01 | ≈53 条/月 |

对比 Muapi i2v 单价 $0.30/条（PR #1360 实测）：Creatomate 模板渲染均摊成本更低，但用途不同——i2v 是"给静图配 AI 运动"，Creatomate 是"按品牌模板排版拼装"，不是同一件事的两个供应商选择，不能只比价格。

---

## 8. 范围边界（PM 已拍板：这次做什么 / 明确不做什么）

**做**：
1. `src/lib/creatomate/` L3 Connector（§4.3）
2. Inngest 工作流：提交 → webhook/轮询双保险 → 转存 → 落库（§4.4-4.5）
3. `content_factory_render_jobs` 加两列（§4.6）
4. 音频 duration 断言（§5 唯一进代码的坑）
5. 成本记账（`cost_usd` 按 §7 公式，只记不拦）

**不做（本轮明确排除，留接口）**：
1. **quota 闸**——`checkBudget` 式配额拦截。#1396 已登记候选，等这条 PR 落地后配额才有地方消费；`cost_usd` 字段和 MTC ledger 的挂钩点本次留空但不堵死
2. **后台选模板 UI**——FDE/PM 选 `template_id`、维护 `modifications` 映射，本次走 `clients.factory_config.render`（jsonb 直配），不做 Settings 页面控件

---

## 9. 给三方复审的具体待办

- **子牙（架构）**：§4.4 的 Inngest 双保险设计是否真的不会跟本机 worker 的 `WORKER_OWNED_EVENTS` 撞车？§4.4 步骤 5"复用 job 行当回执，不建独立表"是否够用？§4.6 migration 风险评级是否同意"低"？
- **鲁班（执行视角）**：§4.3 目录结构 4-5 天能不能真的搭完？§5 只挑音频 duration 一个坑进代码，是否遗漏了其他能在代码层拦的坑？失败重试策略（对齐鲁班手册"广告 API 返回 4xx 标记 failed 不重试"的既有模式）套在 Creatomate 429/5xx 上是否合适？
- **魏征（挑刺）**：§6.1 webhook 安全方案 B 是否真的够——有没有被绕过的路径？§6.2 超额计费未知是不是应该在 spec 阶段就拦成 BLOCKER，不许进 GO BUILD？有没有客户事实（红线 2）已经悄悄写死在这份 spec 里自己没发现？

---

## Reuse Statement（spec 本身，代码落地后需重新对账）

- **复用了什么已有平台能力**：`content_factory_render_jobs` 状态机与表（不新建表）、Supabase Storage `content-factory` bucket（不新建 bucket）、`src/lib/workflows/inngest-event.ts` 的发送封装、`flywheel-seo-weekly.ts` 的云端 Inngest 函数范式、`clients.factory_config` 松散 jsonb 配置惯例、MTC `budget-guard.ts` 的接口形状（留作未来配额闸挂点，本次不调用）
- **新增内容哪些是真正 platform-shared**：`src/lib/creatomate/` 整个 L3 Connector——认证/提交/轮询/计费公式对所有客户行为一致
- **哪些是 industry-specific**：无——渲染模板本身归属由客户配置决定，模板设计（视觉风格）是 L4 客户配置，不是行业级
- **哪些是 client-specific**：`template_id` 和 `modifications` 映射值（走 `factory_config`，不进 shared runtime）；§6.3 提出的 CTS 试点假设
- **有没有把客户名/客户 ID/行业判断写进 shared runtime**：没有——本 spec 唯一提到 CTS 的地方是"试点客户假设"（§6.3）和成本对比引用 PR #1360 的历史数据，均为文档说明，不进代码
- **学习升级情况**：memory `reference-creatomate-silent-failures` 里 5 个坑的处置方式（§5）本次做了明确分工（4 个进模板设计检查清单、1 个进代码断言），这个分工判断本身建议回写进该条 memory 的 "How to apply"，避免下次有人重新论证一遍
