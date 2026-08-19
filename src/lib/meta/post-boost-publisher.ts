/**
 * 把一条**已经发出去的**帖子（Reel / 图文）用 Meta 付费流量推。
 *
 * ── 为什么另建一个 publisher，不复用 ad-publisher.ts ────────────────────────
 * 现有 `ad-publisher.publishDraftPaused()` 是"从 videoId/imageHash 建新 creative"
 * 的路子 —— Meta 端会创建一个**新的 creative post**（观众看不到原帖的点赞数/评论区）。
 *
 * boost_existing_post 的 v1 目标是**保留原帖的社交证明**：付费流量导给已经发过的
 * 帖子，观众看到的是有 X 个赞 / Y 条评论的活的社群产物，不是"崭新广告"。这条路
 * Meta 端用 `object_story_id`（`pageId_postId`）而不是 videoId，creative spec 形状
 * 完全不同（`object_story_id` 用于 `adcreatives`，不能跟 `object_story_spec` 混）。
 *
 * ── 谁调它 ─────────────────────────────────────────────────────────────────
 * 只有 `src/lib/capabilities/ads-meta-boost-sandbox.ts` 会调这里 —— 而且它经过 Kernel
 * outward 授权 + 预算预留 + verification。**别绕过 Kernel 直调**。
 *
 * ── Day 1 状态：骨架 ────────────────────────────────────────────────────────
 * 本文件目前只有类型 + 骨架函数（返 mock）。真实 Meta API 调用在 Day 2 补齐。
 * 骨架先落是为了让 Capability / vitest / architecture check 能编译通过。
 */

import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

/**
 * 建成 PAUSED 状态之后的四个 id + 用于 reconcile 的 tag。
 *
 * `deterministicTag` 是"这次 run 的所有对象"的共同标记：`ME-SANDBOX-<runId>`。
 * publisher 建每一层时把 tag 写进 name 后缀，超时后 Capability 用 `findByTag()`
 * 反查 Meta 判断"到底建成了没"。三态：唯一命中→接续；零条→重建；多条→转人工。
 */
export interface BoostAdArtifacts {
  campaignId: string
  adSetId: string
  creativeId: string
  adId: string
  /** `ME-SANDBOX-<runId>` 形式；每层对象 name 末尾必带。 */
  deterministicTag: string
}

/** 建到一半失败的信息 —— Capability 层据此决定是删回去还是留 orphans。 */
export interface BoostAdFailure {
  ok: false
  step: 'campaign' | 'adset' | 'creative' | 'ad'
  error: string
  /** 已经建出来但没删掉的 id —— 必须走 orphan queue 或人工去 Meta 后台删。 */
  orphans: string[]
  /** 失败时也带 tag，便于事后按 tag 反查是否有残留。 */
  deterministicTag: string
}

export type BoostAdResult = ({ ok: true } & BoostAdArtifacts) | BoostAdFailure

/**
 * reconcile probe 的返回。三态判定的输入。
 *
 * Kernel 授权那套 `providerIdempotency: 'unsupported'` + `maxAttempts: 1` 是
 * 保守方向：不重放。但保守不等于弃疗 —— 超时后必须能查明"Meta 端到底是啥状态"，
 * 然后按状态分派。这个 probe 就是查明的手段。
 */
export interface BoostAdReconcileResult {
  /** 按 tag 查到的对象 id（可能 0-N 个）。 */
  campaigns: string[]
  adSets: string[]
  creatives: string[]
  ads: string[]
}

/**
 * 建一条 boost_existing_post 广告，全 PAUSED，用 `object_story_id` 复用原帖 creative。
 *
 * @param d 已经过 validateDraft 的草案；`kind` 必须是 `boost_existing_post`。
 * @param adAccountId `act_<digits>` 形式的 Meta 广告账户 id。
 * @param accessToken Meta system user token（走 CTS token pool）。
 * @param runId Kernel run id，用来构造 `ME-SANDBOX-<runId>` deterministicTag。
 *
 * @remarks Day 1 骨架：返 mock 数据。真实 Graph API 调用在 Day 2 补齐（会调
 * `campaigns/create` → `adsets/create` → `adcreatives/create`（用 object_story_id）
 * → `ads/create`，全 PAUSED，name 后缀 `ME-SANDBOX-<runId>-{campaign,adset,...}`）。
 */
export async function createBoostAdPaused(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
  runId: string,
): Promise<BoostAdResult> {
  if (d.kind !== 'boost_existing_post') {
    return {
      ok: false,
      step: 'campaign',
      error: `createBoostAdPaused 只处理 boost_existing_post，实际 kind=${d.kind}`,
      orphans: [],
      deterministicTag: `ME-SANDBOX-${runId}`,
    }
  }
  if (!d.objectStoryId) {
    return {
      ok: false,
      step: 'creative',
      error: 'boost_existing_post 缺 objectStoryId（validateDraft 应该拦下这个）',
      orphans: [],
      deterministicTag: `ME-SANDBOX-${runId}`,
    }
  }

  // Day 1 mock —— Day 2 会替换成真实 Graph API 序列
  //   参考 ad-publisher.publishDraftPaused 的模式，四步全 PAUSED：
  //   1. POST /{adAccountId}/campaigns   (name = <campaignName>-ME-SANDBOX-<runId>)
  //   2. POST /{adAccountId}/adsets       (targeting 全字段 + destination_type=WEBSITE)
  //   3. POST /{adAccountId}/adcreatives  (body: { object_story_id })
  //   4. POST /{adAccountId}/ads           (creative_id 挂到 adset)
  //   失败时按逆序删（graphDelete）。
  void adAccountId
  void accessToken

  return {
    ok: true,
    campaignId: `mock_campaign_${runId}`,
    adSetId: `mock_adset_${runId}`,
    creativeId: `mock_creative_${runId}`,
    adId: `mock_ad_${runId}`,
    deterministicTag: `ME-SANDBOX-${runId}`,
  }
}

/**
 * 人点头之后：把 boost 广告开起来。
 *
 * 顺序**从下往上** (ad → adset → campaign)，跟 ad-publisher.activatePublished 一致 ——
 * 只开 ad、adset 还暂停等于没花钱但界面看着开了，那种"半开"状态会咬人。
 *
 * @remarks 部分成功恢复（Codex 复审 #9）：任一层失败时**统一 pause 三层**（不是留半开），
 * 然后 return 失败 —— 让 Capability 转人工。Day 1 骨架返 mock success；Day 2 补真实调用。
 */
export async function activateBoostAd(
  artifacts: Pick<BoostAdArtifacts, 'campaignId' | 'adSetId' | 'adId'>,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string; partiallyActivated: string[] }> {
  // Day 1 mock
  void artifacts
  void accessToken
  return { ok: true }
}

/**
 * 按 deterministicTag 反查 Meta 广告账户里"这次 run 到底建成了没"。
 *
 * 三态判定的输入（Codex 复审 #8 recovery protocol）：
 *   - 全 0 → publisher 根本没写成，Capability 可以安全重建
 *   - 每层 1 → 全建成，Capability 接续到激活步
 *   - 混合 / 每层 >1 → 未知状态，转人工待办含 tag + 已建对象清单
 *
 * @remarks Day 1 骨架返空。Day 2 用 Graph API 的 filtering 查
 * `GET /{adAccountId}/campaigns?filtering=[{field:'name',operator:'CONTAIN',value:tag}]`
 * （同理 adsets/adcreatives/ads）。
 */
export async function findByTag(
  adAccountId: string,
  accessToken: string,
  deterministicTag: string,
): Promise<BoostAdReconcileResult> {
  // Day 1 mock
  void adAccountId
  void accessToken
  void deterministicTag
  return { campaigns: [], adSets: [], creatives: [], ads: [] }
}
