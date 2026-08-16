/** 测试假件 —— 造最小合法组件,单测按需覆写。 */

import type { ExternalFacts, PullRequestFact } from '../external-facts'
import type { ProductMapComponent } from '../types'

/**
 * 默认造一个 me2_native 顶层组件（带 architecturalRole）。
 * 覆写 origin:'legacy' 时，判别式 union 结构上不允许 architecturalRole/adapterOf ——
 * 这里统一清掉，保证产出对象与 union 一致（旧测试仍可传 architecturalRole:undefined，无害）。
 */
export function makeComponent(overrides: Partial<ProductMapComponent> = {}): ProductMapComponent {
  const merged: Record<string, unknown> = {
    id: 'platform.test-component',
    name: '测试组件',
    componentType: 'platform',
    architecturalRole: 'kernel',
    businessLane: 'shared',
    dapeStages: ['execution'],
    businessOutcome: '测试',
    description: '测试',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M0_REGISTERED',
    dependencies: [],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: [],
    contractEvidence: [],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'test',
    ...overrides,
  }
  if (merged.origin === 'legacy') {
    delete merged.architecturalRole
    delete merged.adapterOf
  }
  return merged as unknown as ProductMapComponent
}

export function makeFacts(prs: PullRequestFact[]): ExternalFacts {
  const map: Record<number, PullRequestFact> = {}
  for (const pr of prs) map[pr.number] = pr
  return { pullRequests: map }
}

export function mergedPr(number: number): PullRequestFact {
  return { number, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' }
}

export function openDraftPr(number: number): PullRequestFact {
  return { number, state: 'open', isDraft: true, observedAt: '2026-08-15', source: 'manual_snapshot' }
}
