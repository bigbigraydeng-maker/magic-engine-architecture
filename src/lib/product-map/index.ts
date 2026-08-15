/**
 * ME2 Product Map —— facade。
 *
 * 消费方（PR 3 控制台 / PR 2 同步器）从这里拿：组件清单、成熟度推导、
 * 依赖邻接、blocker 传播、校验结果。warnings 随快照一起返回 ——
 * 「声明高于证据」这类事必须露头,不许死在测试日志里。
 */

import { MANUAL_FACTS_SNAPSHOT } from './external-facts'
import type { ExternalFacts } from './external-facts'
import { deriveMaturity } from './maturity'
import type { MaturityDerivation } from './maturity'
import { neighboursOf, propagateBlocked } from './graph'
import type { ComponentNeighbours } from './graph'
import { PRODUCT_MAP_COMPONENTS } from './registry'
import { validateRegistry } from './validate'
import type { ValidationResult } from './validate'
import type { ProductMapComponent } from './types'

export * from './types'
export * from './external-facts'
export { deriveMaturity, evidenceCeiling } from './maturity'
export type { MaturityDerivation } from './maturity'
export { validateRegistry } from './validate'
export type { ValidationIssue, ValidationResult } from './validate'
export {
  findDanglingDependencies,
  findOrderingCycles,
  neighboursOf,
  propagateBlocked,
} from './graph'
export { PRODUCT_MAP_COMPONENTS } from './registry'

export interface ComponentSnapshot {
  readonly component: ProductMapComponent
  readonly maturity: MaturityDerivation
  readonly neighbours: ComponentNeighbours
  /** 沿 requires 边传导过来的上游 blocker 源（空 = 没被上游卡住）。 */
  readonly inheritedBlockedBy: readonly string[]
}

export interface ProductMapSnapshot {
  readonly components: readonly ComponentSnapshot[]
  readonly validation: ValidationResult
  /** 这份快照用的外部事实是哪来的（PR 1 恒为手工快照,控制台必须明示）。 */
  readonly factsSource: 'manual_snapshot' | 'github_sync'
}

export function buildProductMapSnapshot(
  facts: ExternalFacts = MANUAL_FACTS_SNAPSHOT,
): ProductMapSnapshot {
  const components = PRODUCT_MAP_COMPONENTS
  const blocked = propagateBlocked(components)
  const snapshots = components.map((component) => ({
    component,
    maturity: deriveMaturity(component, facts),
    neighbours: neighboursOf(component.id, components),
    inheritedBlockedBy: blocked.get(component.id) ?? [],
  }))
  // TODO(PR2): 混源快照(部分 PR 已同步、部分仍手抄)不许整体自称 github_sync ——
  // PR2 落地前改为按 PR 粒度暴露来源,或加 'mixed' 档。PR1 阶段恒为 manual_snapshot,无混源。
  const allSynced =
    Object.values(facts.pullRequests).length > 0 &&
    Object.values(facts.pullRequests).every((f) => f.source === 'github_sync')
  return {
    components: snapshots,
    validation: validateRegistry(components, facts),
    factsSource: allSynced ? 'github_sync' : 'manual_snapshot',
  }
}
