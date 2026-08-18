/**
 * ME2 Product Map 控制台的**老板摘要**塑形层——把 `presenter.ts` 已经算好的
 * ~50 个组件，按业务线（lane）收成一行一张卡片。纯函数，零 IO，跟
 * `presenter.ts` 同一种设计哲学，不放进 presenter.ts（它已经 974 行，
 * 超过 CLAUDE.md 的 800 行上限，新逻辑不该继续往里堆）。
 *
 * 🔴 这不是重新判定——只读 `ConsolePresentation` 已经算好的字段
 * （`bucket` / `isBlocked` / `isLegacy` / `roadmap` / `decisionsNow`），
 * 不重新实现 `bucketOf` 那一套判定逻辑。
 */

import type { RunBucket } from './presenter'

/** 一条 lane 的聚合状态。「blocked」永远优先——不能报喜不报忧。 */
export const LANE_STATUS_TONE = ['operating', 'built_not_live', 'building', 'blocked'] as const
export type LaneStatusTone = (typeof LANE_STATUS_TONE)[number]

/**
 * 只声明这个文件真正要读的字段（子集），不要求调用方传完整的
 * `ComponentView` / `RoadmapItemView` / `DecisionView`（各自二三十个字段，
 * 这里只用得上四五个）。`ConsolePresentation` 的真实输出结构上兼容这些
 * 子集类型，调用方不需要做任何转换（Scope 闸：只认领当前用得到的最小契约）。
 */
export interface LaneComponentInput {
  readonly name: string
  readonly bucket: RunBucket
  readonly isBlocked: boolean
  readonly isLegacy: boolean
}
export interface LaneGroupInput {
  readonly laneLabel: string
  readonly components: readonly LaneComponentInput[]
}
export interface RoadmapStepInput {
  readonly laneLabel: string
  readonly nextMilestoneLabel: string
}
export interface DecisionInput {
  readonly componentName: string
}
export interface LaneSummaryInput {
  readonly lanes: readonly LaneGroupInput[]
  /** 已按依赖深度升序排好（presenter.ts 的既有顺序），本文件不重排。 */
  readonly roadmap: readonly RoadmapStepInput[]
  readonly decisionsNow: readonly DecisionInput[]
}

export interface LaneSummaryView {
  readonly laneLabel: string
  readonly statusTone: LaneStatusTone
  readonly statusLabel: string
  readonly operatingCount: number
  readonly totalCount: number
  /** 卡住的组件数——即使 statusTone 不是 'blocked'（比如没有任何组件卡住）也是 0，不是 undefined。 */
  readonly blockedCount: number
  /**
   * 🔴 魏征二审发现的真实缺口：这条线唯一在跑的可能是老系统（legacy），
   * 新体系（ME2.0）还一件没接完。不标出来，「1/7 在跑」会被读成
   * 「这条线基本没在干活」，而实际上老系统天天在生产出结果
   * （跟组件级 `legacyNote` 是同一个问题，这里是线级的版本）。
   */
  readonly legacyOperatingNote: string | null
  /** 这条线依赖深度最靠前（最该先做）的下一步，没有就是 null（这条线暂时没有认领的下一步）。 */
  readonly nextStepLabel: string | null
  /** 这条线有没有等 PM 拍板的事——直接核对 `decisionsNow`，不经过 `roadmap`
   *  （`roadmap` 只含有 `nextMilestone` 的组件，`poDecisionRequired` 和
   *  `nextMilestone` 是两个独立字段，靠 roadmap 判会漏掉「有决策但没里程碑」的组件）。 */
  readonly needsYourCall: boolean
  /** 组件数 ≤ 2——样本太小，UI 需要标注，不能显得跟大样本线一样有把握。 */
  readonly smallSample: boolean
}

/**
 * 「其余那些」怎么说——按剩余组件的**实际 bucket** 生成，不能一律说「还在建」：
 * 一条线同时有「建好了但没通电」和「还在建」时，笼统说成「还在建」会把已经
 * 接完线、只差通电的组件说矮一档，跟组件详情页自相矛盾（Codex 复审 P2）。
 */
function restPhrase(rest: readonly LaneComponentInput[]): string {
  const hasBuiltNotLive = rest.some((c) => c.bucket === 'built_not_live')
  const hasBuilding = rest.some((c) => c.bucket === 'building')
  if (hasBuiltNotLive && hasBuilding) return '有的建好了但没通电、有的还在建'
  if (hasBuiltNotLive) return '建好了但没通电'
  return '还在建'
}

function statusLabelOf(
  tone: LaneStatusTone,
  components: readonly LaneComponentInput[],
  blockedAwaitsDecision: boolean,
): string {
  if (tone === 'blocked') {
    // 「卡住等你决定」是一句**因果**话，只有当**被卡住的那个组件本人**在 `decisionsNow` 里
    // 才成立。同线另一个没卡住的组件等拍板，不能拿来解释这次卡点——那是把代码/数据/上游
    // 依赖的技术卡点栽给老板（CLAUDE.md 铁律 2 + 3，Codex 复审 P2 第二轮）。
    // 「这条线另有事等你拍板」由 `needsYourCall` 字段 + UI 独立徽章表达，跟这句话分开。
    return blockedAwaitsDecision ? '卡住等你决定' : '卡住了，我们在处理'
  }
  const rest = components.filter((c) => c.bucket !== 'operating')
  if (tone === 'operating') {
    return rest.length === 0 ? '全部在跑' : `有在跑的，其余${restPhrase(rest)}`
  }
  // 零在跑的两档（built_not_live / building）共用同一套「其余」措辞，
  // 免得「建好了但没通电」把混在里面、还在建的组件一起吞掉。
  return restPhrase(rest)
}

const SMALL_SAMPLE_THRESHOLD = 2

/**
 * 把 `data.lanes`（已经过滤空线）收成一行一张卡片。
 * 顺序沿用 `data.lanes` 本身的顺序（presenter.ts 里固定的业务优先级）。
 */
export function buildLaneSummaries(data: LaneSummaryInput): readonly LaneSummaryView[] {
  // decisionsNow 是唯一权威的「现在就等你一句话」清单——按组件名反查属于哪条线。
  const decisionComponentNames = new Set(data.decisionsNow.map((d) => d.componentName))

  // roadmap 已经按依赖深度升序排好（「谁垫着谁先做」），按线过滤后第一条就是这条线最该先做的事。
  const firstRoadmapStepByLane = new Map<string, string>()
  for (const item of data.roadmap) {
    if (!firstRoadmapStepByLane.has(item.laneLabel)) {
      firstRoadmapStepByLane.set(item.laneLabel, item.nextMilestoneLabel)
    }
  }

  return data.lanes.map((lane) => {
    const total = lane.components.length
    const operating = lane.components.filter((c) => c.bucket === 'operating')
    const blocked = lane.components.filter((c) => c.isBlocked)
    const hasBuiltNotLive = lane.components.some((c) => c.bucket === 'built_not_live')

    const statusTone: LaneStatusTone =
      blocked.length > 0
        ? 'blocked'
        : operating.length > 0
          ? 'operating'
          : hasBuiltNotLive
            ? 'built_not_live'
            : 'building'

    const legacyOperating = operating.filter((c) => c.isLegacy)
    // 新体系余项同样按实际 bucket 说——固定写「新体系还在建」会把已经建好、
    // 只差通电的新组件说矮一档，跟同一张卡的状态摘要打架（Codex 复审 P2 第二轮）。
    const legacyOperatingNote =
      operating.length > 0 && legacyOperating.length === operating.length && operating.length < total
        ? `在跑的是老系统，新体系${restPhrase(lane.components.filter((c) => c.bucket !== 'operating'))}——分数低不代表这条线没在干活`
        : null

    // 这条线有没有等 PM 拍板的事（lane 级，UI 独立徽章用）。
    const needsYourCall = lane.components.some((c) => decisionComponentNames.has(c.name))
    // 「卡住等你决定」只认被卡住的组件本人是否在等拍板，不吃同线其他组件的决策。
    const blockedAwaitsDecision = blocked.some((c) => decisionComponentNames.has(c.name))

    return {
      laneLabel: lane.laneLabel,
      statusTone,
      statusLabel: statusLabelOf(statusTone, lane.components, blockedAwaitsDecision),
      operatingCount: operating.length,
      totalCount: total,
      blockedCount: blocked.length,
      legacyOperatingNote,
      nextStepLabel: firstRoadmapStepByLane.get(lane.laneLabel) ?? null,
      needsYourCall,
      smallSample: total <= SMALL_SAMPLE_THRESHOLD,
    }
  })
}
