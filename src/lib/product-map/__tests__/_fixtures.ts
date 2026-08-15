/** 测试假件 —— 造最小合法组件,单测按需覆写。 */

import type { ExternalFacts, PullRequestFact } from '../external-facts'
import type { ProductMapComponent } from '../types'

export function makeComponent(overrides: Partial<ProductMapComponent> = {}): ProductMapComponent {
  return {
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
