# ADR: Post-Boost Provider Contract（ME2 广告中枢 v1）

**状态：DRAFT，等 A 级设计复审（子牙 + 魏征）——未经复审，Day 2 不得实施**
**日期**：2026-08-20
**关联**：`feat/me-ads-hub-v1` Day 1 (`876e6124`) + R1 复核 + R2 修复

## 背景

ME2 广告中枢 v1 要验证的最窄闭环：把 CTS 已发的一条 Reel（Facebook 主页帖子）拿去 boost。
现有 `src/lib/meta/ad-publisher.ts` 只支持"从素材（videoId/imageHash）新建 creative"，
Meta 端会创建一个**新的 creative post**，观众看不到原帖的点赞/评论。这跟 v1 想要的
"保留原帖社交证明"不是一回事，所以另建 `src/lib/meta/post-boost-publisher.ts`。

## 决策

1. `boost_existing_post` 作为 `AdDraft.kind` 的第三种（不改现有两种的行为）
2. Meta 端用 `object_story_id`（`pageId_postId` 形式）而不是 `videoId`
3. `metaTripletFor('boost_existing_post')` 返 `OUTCOME_TRAFFIC / LINK_CLICKS / WEBSITE`
4. `publisherPlatforms` **只能给一个平台**（`facebook` 或 `instagram`，二选一，不可同时给）
5. 建成一律 `PAUSED`，走跟现有 `ad-publisher.ts` 一样的"建 → 回读 → 人点头 → 开"三段式
6. `advantageAudience` 必须显式传 `0`（不给默认值，缺失会被 `validateDraft` 拦）

## 为什么（决策 4 的证据）

R1 复核发现 Day 1 把 `publisherPlatforms` 默认值写成 `['facebook','instagram']`（只在注释和
测试夹具里，代码没有校验拦这个组合）。拉取 Meta 官方文档核实：

- `developers.facebook.com/docs/marketing-api/reels-ads`：
  - Instagram Reels boost：`publisher_platforms: ["instagram"]`，落位 `reels` / `profile_reels`
  - Facebook Reels boost：`publisher_platforms: ["facebook"]`，落位 `facebook_reels`
  - 复用已发布 Reel 建广告的机制（`source_instagram_media_id`）**只在 Instagram 侧有文档**，
    Facebook 侧没有对应机制
- **没有找到任何文档记载"一条 Reel 同时投 Facebook + Instagram 两个平台"的路径**

R2 已把这条硬拦进 `validateDraft`（`src/lib/ads-strategy/ad-draft.ts`）+ 补测试
（`publisherPlatforms 同时给 facebook+instagram → 拦`）。CTS Reel 发在 Facebook 主页，
v1 默认给 `['facebook']`。

## 未闭环的 Meta 官方契约（R1 发现，尚未证实）

以下三项在 Day 1/R2 期间**没有找到 Meta 官方文档确认**，仍是开放风险，A 级复审前必须
决定"先证实再写 Day 2 代码"还是"接受风险，用 sandbox 硬顶兜底"：

1. `object_story_id` 能否与 `objective=OUTCOME_TRAFFIC` 组合 —— 文档只说
   "`object_story_id`: ID of a Facebook Page post to use in an ad"，未给 objective 兼容矩阵
2. `object_story_id` 广告能否覆盖原帖的 destination URL（`destinationUrl` 字段）——
   文档未说明创建时传入的链接是否会覆盖原帖链接，还是被静默忽略、落回原帖原链接
3. `optimization_goal=LINK_CLICKS` 是否兼容 `object_story_id` 建的 creative —— 文档未涉及

**建议**：Day 2 实现前先用 Meta Graph API Explorer（sandbox 权限，不花钱、不实际发布）
对一条测试帖子跑一次 dry-run 建 PAUSED 广告，实测这三项，把结果写回本 ADR 再继续。

## Reuse Statement

- 复用：`ad-publisher.ts` 的"建 PAUSED → 回读 → 人点头 → 开"三段式模式（不改这个文件本身）
- 复用：`launch-readback.checkLaunch()`（R2 扩了 age/publisherPlatforms/advantageAudience 对照，
  但检查框架和输出结构不变）
- 新增 platform-shared：`post-boost-publisher.ts` 的 deterministicTag + reconcile probe 机制
  （Day 2 会补真实实现），这套机制对任何"boost 已发内容"场景都适用，不是 CTS 专属
- 新增 CTS-specific：v1 sandbox 的具体数值（55+、NZ$20、`ME-Sandbox-` 前缀）—— 这些进
  Capability 层，不进本文件

## 开放问题（等 A 级复审拍板）

- [ ] 上述三项 Meta 契约要不要在 Day 2 前用 sandbox 权限实测
- [ ] `object_story_id` 权限校验（page 有没有把这条帖子的 boost 权限开给当前 token）在哪一层查
- [ ] destinationUrl 万一被 Meta 忽略，v1 的止损策略是什么（sandbox 硬顶仍能兜住钱，但用户体验会错）
