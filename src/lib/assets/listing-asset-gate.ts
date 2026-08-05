/**
 * 一张素材能不能拿去给某套房做广告。
 *
 * PM 2026-08-05 的要求原话：「这些推广素材必须要严谨，不能随意更改」。
 * 翻成机器判据，是三条**独立**的检查，缺一条都不算严谨：
 *
 *   1. **是这套房的** —— 不是同一个客户名下另一套房的，也不是没主的
 *   2. **是客户自己给的** —— 不是图库、不是 AI 生成的
 *   3. **有人签过字** —— 有人逐张确认过它确实是这套房
 *
 * ── 为什么第 1 条不能松 ────────────────────────────────────────────────
 * 拿 A 房的画面去卖 B 房，在 NZ 属于误导性广告，风险落在中介的执照上，不在我们。
 * 「同一个客户的照片，看起来差不多，先用着」是最容易发生也最贵的那种偷懒。
 *
 * ── 为什么第 2、3 条要分开 ─────────────────────────────────────────────
 * 上传链接是可以无限转发的：客户完全可能从网上存一张图再传进来。所以
 * 「从客户上传口进来的」只证明**是客户主动提供的**，不证明**是这套房实拍的**。
 * 两件事分成两个字段、两道判据 —— 合成一条就等于用弱证据冒充强证据。
 *
 * 纯函数，不碰 DB。取数在调用方。
 */

/** 素材的来源。`client_provided` 只说明「客户给的」，不代表「实拍」。 */
export type AssetSource = 'client_provided' | 'stock_library' | 'ai_generated' | 'unknown'

export interface AssetRow {
  id: string
  clientId: string
  /** 绑定的房源。null = 客户级素材，没绑到任何一套房。 */
  listingId: string | null
  source: AssetSource | string | null
  /** 谁签的字。null = 没人逐张确认过。 */
  verifiedBy: string | null
  verifiedAt: string | null
  archivedAt: string | null
  mimeType: string | null
  storageUrl: string
}

export type RejectReason =
  | 'archived'
  | 'wrong_listing'
  | 'no_listing'
  | 'not_client_provided'
  | 'not_verified'

export interface AssetVerdict {
  usable: boolean
  reasons: RejectReason[]
  /** 人话，直接能显示给 FDE 看。 */
  why: string
}

const REASON_TEXT: Readonly<Record<RejectReason, string>> = {
  archived: '这张已经归档了',
  wrong_listing: '这张属于另一套房 —— 拿别的房子的画面卖这套，是误导性广告',
  no_listing: '这张没绑到任何房源（多半是老链接传的），不知道拍的是哪套',
  not_client_provided: '这张不是客户自己提供的（图库或 AI 生成）—— 不能当成这套房的真实画面',
  not_verified: '还没有人逐张确认过它确实是这套房',
}

/** 只有「客户自己提供」才可能当真实房源画面。其余一律不行。 */
function isClientProvided(source: AssetSource | string | null): boolean {
  return source === 'client_provided'
}

/**
 * 判一张素材能不能给 `listingId` 这套房用。
 *
 * 把**所有**不通过的理由一次列全，不是撞到第一条就返回：FDE 修完一条又被
 * 挡一次，第三次就绕开这道闸了。
 */
export function judgeAsset(asset: AssetRow, listingId: string): AssetVerdict {
  const reasons: RejectReason[] = []

  if (asset.archivedAt) reasons.push('archived')

  if (!asset.listingId) reasons.push('no_listing')
  else if (asset.listingId !== listingId) reasons.push('wrong_listing')

  if (!isClientProvided(asset.source)) reasons.push('not_client_provided')

  // 两个字段都要有：只有 verified_at 没有 verified_by＝查不出是谁签的，
  // 出问题时没法追责，等于没签。
  if (!asset.verifiedBy || !asset.verifiedAt) reasons.push('not_verified')

  return {
    usable: reasons.length === 0,
    reasons,
    why: reasons.length === 0
      ? '可用：属于这套房、客户自己提供、已有人确认。'
      : reasons.map((r) => REASON_TEXT[r]).join('；'),
  }
}

export interface PickResult {
  usable: AssetRow[]
  rejected: { asset: AssetRow; verdict: AssetVerdict }[]
  /** 一句话交代这套房现在能不能出广告。 */
  summary: string
}

/**
 * 从一堆素材里挑出这套房能用的。
 *
 * **被挡下的一律带着理由返回**，不是悄悄过滤掉。悄悄过滤的后果是
 * 「传了 10 张却一张都用不了」，而屏幕上只显示「没有素材」—— 人会以为是没传。
 */
export function pickUsableForListing(assets: readonly AssetRow[], listingId: string): PickResult {
  const usable: AssetRow[] = []
  const rejected: { asset: AssetRow; verdict: AssetVerdict }[] = []

  for (const a of assets) {
    const v = judgeAsset(a, listingId)
    if (v.usable) usable.push(a)
    else rejected.push({ asset: a, verdict: v })
  }

  let summary: string
  if (usable.length > 0) {
    summary = `这套房有 ${usable.length} 张可用素材` +
      (rejected.length > 0 ? `，另有 ${rejected.length} 张不能用（理由逐张列出）。` : '。')
  } else if (rejected.length > 0) {
    // 「有素材但都不能用」和「一张都没传」是完全不同的两件事，必须分开说。
    summary = `这套房有 ${rejected.length} 张素材，但一张都不能用于投放 —— 不是没传，是没过关。`
  } else {
    summary = '这套房还没有任何素材。'
  }

  return { usable, rejected, summary }
}

/** 图片 / 视频 —— 建广告时要按类型分开取。 */
export function isVideoAsset(a: AssetRow): boolean {
  return (a.mimeType ?? '').startsWith('video/')
}
