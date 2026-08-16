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

/** 人工快照的已合并 PR —— source='manual_snapshot'，不算机器核验（codeInMain 判 unknown）。 */
export function mergedPr(number: number): PullRequestFact {
  return { number, state: 'merged', isDraft: false, baseRef: 'main', observedAt: '2026-08-15', source: 'manual_snapshot' }
}

/** GitHub 同步来的、合入 main 的已合并 PR —— 机器核验 + baseRef=main（codeInMain 可判 yes）。 */
export function mergedPrSync(number: number): PullRequestFact {
  return { number, state: 'merged', isDraft: false, baseRef: 'main', observedAt: '2026-08-15', source: 'github_sync' }
}

/**
 * GitHub 同步来的、合入**非 main 分支**的已合并 PR —— state=merged 但 baseRef≠main，
 * 绝不能被判成「代码已进入 main」（codeInMain 判 unknown，不是 yes）。
 */
export function mergedPrSyncIntoBranch(number: number, baseRef: string): PullRequestFact {
  return { number, state: 'merged', isDraft: false, baseRef, observedAt: '2026-08-15', source: 'github_sync' }
}

export function openDraftPr(number: number): PullRequestFact {
  return { number, state: 'open', isDraft: true, baseRef: 'main', observedAt: '2026-08-15', source: 'github_sync' }
}
