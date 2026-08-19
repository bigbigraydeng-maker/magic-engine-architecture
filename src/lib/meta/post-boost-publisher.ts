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
 * ── HTTP 层复用 ad-publisher.ts ──────────────────────────────────────────
 * `graphPost` / `graphUpdate` / `graphDelete` 从 `ad-publisher.ts` 导入 ——
 * 纯 HTTP 语义（建/改/删一个 Graph 对象），跟 AdDraft 的 kind 无关，
 * 不应该在两个文件里各写一份。
 *
 * ── 🔴 未经 Meta 官方文档证实的部分（M7 dry-run 前必须现场核实，见对应函数注释）
 * 1. `object_story_id` 建的 creative 能否用 `call_to_action` 覆盖原帖落地页
 * 2. `object_story_id` + `OUTCOME_TRAFFIC` + `LINK_CLICKS` 三件套的兼容性
 * 这两条在 R1 复核就已标记；M7 是设计好用来验证它们的那一步，不是靠这里的
 * 代码注释"假装验证过"。
 */

import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { metaTripletFor } from '@/lib/ads-strategy/ad-draft'
import { GRAPH_BASE, graphPost, graphUpdate, graphDelete } from './ad-publisher'

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
 * 🔴 城市和国家不能同时塞进 `geo_locations`（同 ad-publisher.ts targetingFor 的坑，
 * boost_existing_post v1 只用国家级投放，这里没有 geoCityKeys 分支，不是漏写）。
 *
 * placement 按 R2 已锁定的规则：`publisherPlatforms` 只能有一个元素（validateDraft
 * 已经拦住多平台组合），facebook 用 `facebook_reels` 位置，instagram 用
 * `reels`/`profile_reels`（Meta 官方文档 reels-ads 页确认的两套独立落位值）。
 */
function targetingForBoost(d: AdDraft): Record<string, unknown> {
  const platform = (d.publisherPlatforms?.[0] ?? '').toLowerCase()
  const positions: Record<string, unknown> =
    platform === 'instagram'
      ? { publisher_platforms: ['instagram'], instagram_positions: ['reels', 'profile_reels'] }
      : { publisher_platforms: ['facebook'], facebook_positions: ['facebook_reels'] }
  return {
    geo_locations: { countries: d.geoCountries },
    age_min: d.ageMin,
    age_max: d.ageMax,
    ...positions,
    // advantageAudience 已被 validateDraft 强制为 0，这里显式传，不留隐式默认值的空子
    targeting_automation: { advantage_audience: d.advantageAudience ?? 0 },
  }
}

/**
 * 🔴 未经 Meta 官方文档证实（R1 复核标记 #1，等 M7 dry-run 现场核实）：
 * `object_story_id` 建的 creative 是否接受 `call_to_action` 覆盖原帖落地页。
 *
 * 这里按业界常见的"boost 帖子 + 加一个 CTA 按钮"惯例传参 —— 这是给一条已发帖
 * 加投放时最常见的用法（帖子本身不必是链接帖，CTA 按钮独立于原帖内容）。
 * 如果 M7 实测发现这个字段被 Meta 忽略或报错，需要回来改这个函数，
 * 不能假装这行代码已经证明有效。
 */
function boostCreativeSpec(d: AdDraft): Record<string, string> {
  const body: Record<string, string> = { object_story_id: d.objectStoryId! }
  if (d.destinationUrl) {
    body.call_to_action = JSON.stringify({ type: 'LEARN_MORE', value: { link: d.destinationUrl } })
  }
  return body
}

/**
 * 建一条 boost_existing_post 广告，全 PAUSED，用 `object_story_id` 复用原帖 creative。
 *
 * @param d 已经过 validateDraft 的草案；`kind` 必须是 `boost_existing_post`。
 * @param adAccountId `act_<digits>` 形式的 Meta 广告账户 id。
 * @param accessToken Meta system user token（走 CTS token pool）。
 * @param runId Kernel run id，用来构造 `ME-SANDBOX-<runId>` deterministicTag。
 *
 * 四步全 PAUSED，任何一步失败按创建的**逆序**删回去（同 ad-publisher.publishDraftPaused
 * 的失败收拾逻辑），删不掉的原样上报进 orphans。
 *
 * 🔴 未经 Meta 官方文档证实（R1 复核标记 #2，等 M7 dry-run 现场核实）：
 * `object_story_id` + `OUTCOME_TRAFFIC` objective + `LINK_CLICKS` optimization_goal
 * 三件套的兼容性。如果 M7 实测 Meta 拒绝这个组合，需要回 `ad-draft.ts` 的
 * `metaTripletFor('boost_existing_post')` 改 objective/optimization_goal，
 * 不是在这里绕过。
 */
export async function createBoostAdPaused(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
  runId: string,
): Promise<BoostAdResult> {
  const tag = `ME-SANDBOX-${runId}`

  if (d.kind !== 'boost_existing_post') {
    return {
      ok: false,
      step: 'campaign',
      error: `createBoostAdPaused 只处理 boost_existing_post，实际 kind=${d.kind}`,
      orphans: [],
      deterministicTag: tag,
    }
  }
  if (!d.objectStoryId) {
    return {
      ok: false,
      step: 'creative',
      error: 'boost_existing_post 缺 objectStoryId（validateDraft 应该拦下这个）',
      orphans: [],
      deterministicTag: tag,
    }
  }

  const t = metaTripletFor(d.kind)
  const created: string[] = []
  const rollback = async (): Promise<string[]> => {
    const stuck: string[] = []
    for (const id of [...created].reverse()) {
      if (!(await graphDelete(id, accessToken))) stuck.push(id)
    }
    return stuck
  }

  // ── 1. 广告系列 ──────────────────────────────────────────────────────
  const campaign = await graphPost(
    `${adAccountId}/campaigns`,
    {
      name: `${d.campaignName} · ${tag}`,
      objective: t.objective,
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
    },
    accessToken,
  )
  if ('error' in campaign) {
    return { ok: false, step: 'campaign', error: campaign.error, orphans: [], deterministicTag: tag }
  }
  created.push(campaign.id)

  // ── 2. 广告组 ────────────────────────────────────────────────────────
  const start = new Date()
  const end = new Date(start.getTime() + d.durationDays * 86_400_000)
  const adSet = await graphPost(
    `${adAccountId}/adsets`,
    {
      name: `${d.adSetName} · ${tag}`,
      campaign_id: campaign.id,
      status: 'PAUSED',
      billing_event: t.billingEvent,
      optimization_goal: t.optimizationGoal,
      destination_type: t.destinationType ?? 'WEBSITE',
      // Meta 收的是最小货币单位（分）。传元会变成 1/100 的预算，静默跑不出量。
      daily_budget: String(Math.round(d.dailyBudget * 100)),
      start_time: String(Math.floor(start.getTime() / 1000)),
      end_time: String(Math.floor(end.getTime() / 1000)),
      targeting: JSON.stringify(targetingForBoost(d)),
      promoted_object: JSON.stringify({ page_id: d.pageId }),
    },
    accessToken,
  )
  if ('error' in adSet) {
    return { ok: false, step: 'adset', error: adSet.error, orphans: await rollback(), deterministicTag: tag }
  }
  created.push(adSet.id)

  // ── 3. 创意（复用原帖 object_story_id，不新建 creative post）───────────
  const creative = await graphPost(`${adAccountId}/adcreatives`, boostCreativeSpec(d), accessToken)
  if ('error' in creative) {
    return { ok: false, step: 'creative', error: creative.error, orphans: await rollback(), deterministicTag: tag }
  }
  created.push(creative.id)

  // ── 4. 广告 ──────────────────────────────────────────────────────────
  const ad = await graphPost(
    `${adAccountId}/ads`,
    {
      name: `${d.campaignName} Ad · ${tag}`,
      adset_id: adSet.id,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: 'PAUSED',
    },
    accessToken,
  )
  if ('error' in ad) {
    return { ok: false, step: 'ad', error: ad.error, orphans: await rollback(), deterministicTag: tag }
  }
  created.push(ad.id)

  return {
    ok: true,
    campaignId: campaign.id,
    adSetId: adSet.id,
    creativeId: creative.id,
    adId: ad.id,
    deterministicTag: tag,
  }
}

/**
 * 人点头之后：把 boost 广告开起来。
 *
 * 顺序**从下往上** (ad → adset → campaign)，跟 ad-publisher.activatePublished 一致 ——
 * 只开 ad、adset 还暂停等于没花钱但界面看着开了，那种"半开"状态会咬人。
 *
 * 部分成功恢复（Codex 复审 #9）：任一层失败时**统一 pause 已经激活的层**（不是留半开），
 * 然后 return 失败，`partiallyActivated` 带上"哪些层已经激活但被我们又 pause 回去了"，
 * 让 Capability 转人工时能说清楚现场是什么样。
 */
export async function activateBoostAd(
  artifacts: Pick<BoostAdArtifacts, 'campaignId' | 'adSetId' | 'adId'>,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string; partiallyActivated: string[] }> {
  const order = [artifacts.adId, artifacts.adSetId, artifacts.campaignId]
  const activated: string[] = []

  for (const id of order) {
    const r = await graphUpdate(id, { status: 'ACTIVE' }, accessToken)
    if (!r.ok) {
      // 部分成功：把已经激活的层重新 pause 回去，不留半开状态
      for (const doneId of activated) {
        await graphUpdate(doneId, { status: 'PAUSED' }, accessToken)
      }
      return { ok: false, error: `开 ${id} 失败：${r.error}`, partiallyActivated: activated }
    }
    activated.push(id)
  }
  return { ok: true }
}

interface GraphListResponse {
  data?: Array<{ id?: unknown; name?: unknown }>
}

/** GET 一个按名字过滤的对象列表；查询失败时抛错（不静默返空 —— 空是"查到了但没有"，不是"查炸了"）。 */
async function graphListByNameContains(path: string, tagFragment: string, accessToken: string): Promise<string[]> {
  const url =
    `${GRAPH_BASE}/${path}?fields=id,name` +
    `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: tagFragment }]))}` +
    `&access_token=${encodeURIComponent(accessToken)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(`graphListByNameContains(${path}) 网络请求失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`graphListByNameContains(${path}) HTTP ${res.status}：${text.slice(0, 400)}`)
  let json: GraphListResponse
  try {
    json = JSON.parse(text) as GraphListResponse
  } catch {
    throw new Error(`graphListByNameContains(${path}) 返回不是 JSON：${text.slice(0, 200)}`)
  }
  return (json.data ?? [])
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => id !== null)
}

/**
 * 按 deterministicTag 反查 Meta 广告账户里"这次 run 到底建成了没"。
 *
 * 三态判定的输入（Codex 复审 #8 recovery protocol）：
 *   - 全 0 → publisher 根本没写成，Capability 可以安全重建
 *   - 每层 1 → 全建成，Capability 接续到激活步
 *   - 混合 / 每层 >1 → 未知状态，转人工待办含 tag + 已建对象清单
 *
 * 🔴 查询失败一律抛错，不返回空数组 —— "查不到"和"查炸了"混在一起，会让
 * Capability 把一次网络抖动误判成"这次 run 什么都没建成"，进而错误地重建
 * （同 kernel/store.ts 头注释那条"查询失败一律抛错"的铁律）。
 */
export async function findByTag(
  adAccountId: string,
  accessToken: string,
  deterministicTag: string,
): Promise<BoostAdReconcileResult> {
  const [campaigns, adSets, creatives, ads] = await Promise.all([
    graphListByNameContains(`${adAccountId}/campaigns`, deterministicTag, accessToken),
    graphListByNameContains(`${adAccountId}/adsets`, deterministicTag, accessToken),
    graphListByNameContains(`${adAccountId}/adcreatives`, deterministicTag, accessToken),
    graphListByNameContains(`${adAccountId}/ads`, deterministicTag, accessToken),
  ])
  return { campaigns, adSets, creatives, ads }
}
