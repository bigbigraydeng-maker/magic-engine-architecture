/**
 * 漏斗角色判定（ads IMPACT 阶段 1，设计 §3.1）。
 *
 * 按**设置快照**判（不按名字判），每个结论带可信度与理由，给诊断用：
 *   破冰 awareness   —— 优化目标是 ThruPlay/触达/曝光/视频观看/互动，且**包含**列表没有自定义受众
 *   获客 acquisition —— 优化目标是留资/私信/网站转化，面向冷流量（**只有排除受众也算冷流量**）
 *   再营销 retargeting —— 包含互动/网站/客户名单类受众，且 advantage_audience=0 且名单外扩展=0
 *   扩量 expansion   —— 包含类似人群
 *   mixed            —— Advantage+ 购物（ASC）系列；系列目标与优化目标错位；再营销但扩展开着
 *   unknown          —— 以上都不符
 *
 * 同时命中破冰+再营销（如 ThruPlay 投视频观众名单）→ 以包含受众优先判再营销，可信度「中」。
 * 特殊广告类别读**广告系列自己的** special_ad_categories，不按客户行业推断。
 *
 * 纯函数、平台共享：不许出现客户名、客户 ID、行业判断。
 */

import type { EntitySnapshotRow } from './snapshot'

export type FunnelRole = 'awareness' | 'acquisition' | 'retargeting' | 'expansion' | 'mixed' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low'

export interface RoleVerdict {
  role: FunnelRole
  confidence: Confidence
  reasons: string[]
  /** 读自广告系列自己的 special_ad_categories（住房/就业/信贷/政治）。 */
  specialAdCategories: string[]
  /** 包含受众里被认作「再营销类」的受众 id（D4 判「已收割」要用）。 */
  retargetingAudienceIds: string[]
}

const AWARENESS_GOALS = new Set(['THRUPLAY', 'REACH', 'IMPRESSIONS', 'VIDEO_VIEWS', 'POST_ENGAGEMENT', 'ENGAGED_USERS', 'AD_RECALL_LIFT', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'])
const ACQUISITION_GOALS = new Set(['LEAD_GENERATION', 'QUALITY_LEAD', 'CONVERSATIONS', 'OFFSITE_CONVERSIONS', 'VALUE', 'QUALITY_CALL', 'APP_INSTALLS'])

/** 系列目标 → 允许的优化目标组。不在表里的目标不判错位（未知 ≠ 错位）。 */
const OBJECTIVE_ALLOWS: Readonly<Record<string, ReadonlyArray<'awareness' | 'acquisition' | 'traffic'>>> = {
  OUTCOME_AWARENESS: ['awareness'],
  OUTCOME_ENGAGEMENT: ['awareness', 'acquisition'],
  OUTCOME_LEADS: ['acquisition'],
  OUTCOME_SALES: ['acquisition'],
  OUTCOME_TRAFFIC: ['traffic'],
}
const TRAFFIC_GOALS = new Set(['LINK_CLICKS', 'LANDING_PAGE_VIEWS'])

/** Meta 受众子类型 → 包含时的含义 */
const RETARGETING_SUBTYPES = new Set(['ENGAGEMENT', 'WEBSITE', 'CUSTOM', 'OFFLINE_CONVERSION', 'APP', 'VIDEO'])
const LOOKALIKE_SUBTYPES = new Set(['LOOKALIKE'])

/** 名字里带「再营销」一类通用词但设置判成冷流量 → 名字与设置矛盾，可信度下调。 */
const RETARGETING_NAME_HINT = /retarget|remarket|再营销|收割|warm/i

function goalGroup(goal: string | null): 'awareness' | 'acquisition' | 'traffic' | null {
  if (!goal) return null
  if (AWARENESS_GOALS.has(goal)) return 'awareness'
  if (ACQUISITION_GOALS.has(goal)) return 'acquisition'
  if (TRAFFIC_GOALS.has(goal)) return 'traffic'
  return null
}

export interface RoleInput {
  adset: EntitySnapshotRow
  campaign: EntitySnapshotRow | null
  /** 本账户受众快照，按 id 查子类型 */
  audiences: ReadonlyMap<string, EntitySnapshotRow>
}

export function classifyAdsetRole({ adset, campaign, audiences }: RoleInput): RoleVerdict {
  const reasons: string[] = []
  const special = campaign?.special_ad_categories ?? []
  const base = { specialAdCategories: special }

  const included = adset.included_audience_ids
  const retargetingIds: string[] = []
  const lookalikeIds: string[] = []
  let unknownIncluded = 0
  for (const id of included) {
    const subtype = audiences.get(id)?.audience_subtype ?? null
    if (subtype && LOOKALIKE_SUBTYPES.has(subtype)) lookalikeIds.push(id)
    else if (subtype && RETARGETING_SUBTYPES.has(subtype)) retargetingIds.push(id)
    else { unknownIncluded++; retargetingIds.push(id) }
  }
  if (unknownIncluded > 0) reasons.push(`${unknownIncluded} 个包含受众查不到子类型，按再营销类受众处理`)

  // ── mixed：Advantage+ 购物系列 ──
  if (campaign?.smart_promotion_type === 'AUTOMATED_SHOPPING_ADS') {
    return { ...base, role: 'mixed', confidence: 'low', reasons: [...reasons, 'Advantage+ 购物系列：受众由 Meta 自动决定'], retargetingAudienceIds: [] }
  }

  const group = goalGroup(adset.optimization_goal)

  // ── mixed：系列目标与优化目标错位 ──
  const allowed = campaign?.objective ? OBJECTIVE_ALLOWS[campaign.objective] : undefined
  if (allowed && group && !allowed.includes(group)) {
    return {
      ...base,
      role: 'mixed',
      confidence: 'low',
      reasons: [...reasons, `系列目标 ${campaign?.objective} 与优化目标 ${adset.optimization_goal} 错位`],
      retargetingAudienceIds: retargetingIds,
    }
  }

  // ── 再营销（包含受众优先）──
  if (retargetingIds.length > 0) {
    const advantageOff = adset.advantage_audience === 0
    const relaxation = adset.targeting_relaxation?.custom_audience
    const relaxationOff = relaxation === 0
    if (!advantageOff || !relaxationOff) {
      return {
        ...base,
        role: 'mixed',
        confidence: 'low',
        reasons: [
          ...reasons,
          `包含再营销类受众，但${!advantageOff ? ` Advantage+ 受众=${adset.advantage_audience ?? '未知'}` : ''}${!relaxationOff ? ` 名单外扩展=${relaxation ?? '未知'}` : ''}——实际在投冷流量`,
        ],
        retargetingAudienceIds: retargetingIds,
      }
    }
    const alsoAwareness = group === 'awareness'
    return {
      ...base,
      role: 'retargeting',
      confidence: alsoAwareness || unknownIncluded > 0 || lookalikeIds.length > 0 ? 'medium' : 'high',
      reasons: [
        ...reasons,
        '包含再营销类受众，Advantage+ 受众与名单外扩展均已关闭',
        ...(alsoAwareness ? ['优化目标属破冰类，以包含受众优先判再营销'] : []),
        ...(lookalikeIds.length > 0 ? ['同时包含类似人群'] : []),
      ],
      retargetingAudienceIds: retargetingIds,
    }
  }

  // ── 扩量 ──
  if (lookalikeIds.length > 0) {
    return { ...base, role: 'expansion', confidence: 'high', reasons: [...reasons, '包含类似人群'], retargetingAudienceIds: [] }
  }

  // ── 冷流量：破冰 / 获客 ──
  const nameConflict = RETARGETING_NAME_HINT.test(adset.entity_name ?? '')
  const coldNote = adset.excluded_audience_ids.length > 0 ? '只有排除受众，按冷流量处理' : '没有包含受众'
  if (group === 'awareness') {
    return {
      ...base,
      role: 'awareness',
      confidence: nameConflict ? 'medium' : 'high',
      reasons: [...reasons, `优化目标 ${adset.optimization_goal}，${coldNote}`, ...(nameConflict ? ['名字像再营销，但设置是冷流量'] : [])],
      retargetingAudienceIds: [],
    }
  }
  if (group === 'acquisition') {
    return {
      ...base,
      role: 'acquisition',
      confidence: nameConflict ? 'medium' : 'high',
      reasons: [...reasons, `优化目标 ${adset.optimization_goal}，${coldNote}`, ...(nameConflict ? ['名字像再营销，但设置是冷流量'] : [])],
      retargetingAudienceIds: [],
    }
  }

  return {
    ...base,
    role: 'unknown',
    confidence: 'low',
    reasons: [...reasons, `优化目标 ${adset.optimization_goal ?? '缺失'} 不在任何角色判据里`],
    retargetingAudienceIds: [],
  }
}

/**
 * CBO 系列作为独立预算单位时的角色：组内角色一致 → 该角色（可信度取最低）；不一致 → mixed。
 */
export function rollupCampaignRole(verdicts: RoleVerdict[]): { role: FunnelRole; confidence: Confidence } {
  if (verdicts.length === 0) return { role: 'unknown', confidence: 'low' }
  const roles = new Set(verdicts.map(v => v.role))
  if (roles.size > 1) return { role: 'mixed', confidence: 'low' }
  const order: Confidence[] = ['low', 'medium', 'high']
  const minConf = verdicts.map(v => order.indexOf(v.confidence)).reduce((a, b) => Math.min(a, b), 2)
  return { role: verdicts[0].role, confidence: order[minConf] }
}
