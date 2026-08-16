/**
 * 四问运营快照测试 —— yes / no / unknown 三态，含 Codex 复审收紧：
 *
 * - B3：status==='yes' 必须由**机器核验**证据支撑 —— evidence.verification ∈
 *   {repo_verified, sync_verified}，或 PR fact.source==='github_sync'，且带 observedAt。
 *   人工手填的 manual_claim / manual_snapshot 即便带日期也只判 unknown（不装懂）。
 * - Codex：找"任意合格证据"而非固定取第一条 —— 数组里第一条可能是无日期旧声明，
 *   后面才有合格的那条。
 * - B4：evidenceSource 是身份指针（#PR / kind:ref / blocker:id / operationalStatus:值）。
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_EXTERNAL_FACTS } from '../external-facts'
import { deriveOperationalSnapshot } from '../operational-snapshot'
import { makeComponent, makeFacts, mergedPr, mergedPrSync, mergedPrSyncIntoBranch, openDraftPr } from './_fixtures'

const repoEv = (over: Record<string, unknown> = {}) => ({ kind: 'importer', ref: 'src/a.ts', observedAt: '2026-08-14', verification: 'repo_verified', ...over })

describe('code in main?', () => {
  it('正向 main：机器同步、合入 main 的 merged PR → yes，evidenceSource 带 PR 号 + checkedAt', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPrSync(100)]))
    expect(s.codeInMain.status).toBe('yes')
    expect(s.codeInMain.evidenceSource).toContain('#100')
    expect(s.codeInMain.checkedAt).toBe('2026-08-15')
  })

  it('负向非 main：机器同步但合入 staging 的 merged PR → 不判 yes（unknown，不得误报 main）', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPrSyncIntoBranch(100, 'staging')]))
    expect(s.codeInMain.status).not.toBe('yes')
    expect(s.codeInMain.status).toBe('unknown')
    expect(s.codeInMain.checkedAt).toBeNull()
    // 证据身份必须点名它进的是非 main 分支，而不是冒充「合并=进 main」
    expect(s.codeInMain.evidenceSource).toContain('staging')
  })

  it('负向非 main：合入功能分支的 merged PR 也不判 yes', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPrSyncIntoBranch(100, 'feat/x')]))
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('缺证据 unknown：合入非 main + 另一条查无此号 → unknown（既不 yes 也不确定的 no）', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }, { number: 200, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPrSyncIntoBranch(100, 'staging')]))
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('B3：仅人工快照(manual_snapshot)的 merged PR → unknown，不判 yes', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPr(100)]))
    expect(s.codeInMain.status).toBe('unknown')
    expect(s.codeInMain.checkedAt).toBeNull()
  })

  it('open draft PR → no（明确负向，带机器事实日期）', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 962, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([openDraftPr(962)]))
    expect(s.codeInMain.status).toBe('no')
    expect(s.codeInMain.checkedAt).toBe('2026-08-15')
  })

  it('未登记 implements PR → unknown', () => {
    const s = deriveOperationalSnapshot(makeComponent({ linkedPullRequests: [] }), EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('登记了 PR 但 ExternalFacts 查无此号 → unknown', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).codeInMain.status).toBe('unknown')
  })

  it('legacy → unknown（ownedPaths 存在≠带日期证明在 main）', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, ownedPaths: ['src/lib/x/'] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('Codex：github_sync 但 observedAt 是脏值 → 不判 yes（日期必须真实日历日）', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const facts = makeFacts([{ number: 100, state: 'merged', isDraft: false, baseRef: 'main', observedAt: 'foo', source: 'github_sync' }])
    expect(deriveOperationalSnapshot(c, facts).codeInMain.status).not.toBe('yes')
  })

  it('Codex：一条人工 merged + 另一条 open → unknown，不判确定的 no', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }, { number: 200, role: 'implements' }] })
    const facts = makeFacts([mergedPr(100), openDraftPr(200)])
    // 存在合并声明(人工)，无法确定代码不在 main → unknown，而不是被 open 的那条压成 no
    expect(deriveOperationalSnapshot(c, facts).codeInMain.status).toBe('unknown')
  })
})

describe('production prerequisites actually exist?', () => {
  it('provisioning blocker → no，evidenceSource=blocker:id', () => {
    const c = makeComponent({ currentBlockers: [{ id: 'tables-missing', kind: 'provisioning', summary: '四张表未在生产建立' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('no')
    expect(s.productionPrerequisitesExist.evidenceSource).toBe('blocker:tables-missing')
  })

  it('机器核验的 production_data → yes', () => {
    const c = makeComponent({ productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', observedAt: '2026-08-12', verification: 'repo_verified' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('yes')
    expect(s.productionPrerequisitesExist.checkedAt).toBe('2026-08-12')
    expect(s.productionPrerequisitesExist.evidenceSource).toBe('production_data:geo_batches=3')
  })

  it('B3：manual_claim 的 production_data（即便带日期）→ unknown', () => {
    const c = makeComponent({ productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', observedAt: '2026-08-12', verification: 'manual_claim' }] })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).productionPrerequisitesExist.status).toBe('unknown')
  })

  it('Codex：repo_verified 但 observedAt 是脏值 → unknown（日期必须真实日历日）', () => {
    const c = makeComponent({ productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', observedAt: 'foo', verification: 'repo_verified' }] })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).productionPrerequisitesExist.status).toBe('unknown')
  })

  it('都没登记 → unknown', () => {
    expect(deriveOperationalSnapshot(makeComponent(), EMPTY_EXTERNAL_FACTS).productionPrerequisitesExist.status).toBe('unknown')
  })
})

describe('real caller wired?', () => {
  it('机器核验的 integrationEvidence → yes，evidenceSource=kind:ref', () => {
    const c = makeComponent({ integrationEvidence: [repoEv()] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('yes')
    expect(s.realCallerWired.evidenceSource).toBe('importer:src/a.ts')
    expect(s.realCallerWired.checkedAt).toBe('2026-08-14')
  })

  it('Codex：第一条无日期、第二条合格 → yes（找任意合格证据，不固定取第一条）', () => {
    const c = makeComponent({
      integrationEvidence: [
        { kind: 'importer', ref: 'old.ts', verification: 'manual_claim' },
        repoEv({ ref: 'src/real.ts' }),
      ],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('yes')
    expect(s.realCallerWired.evidenceSource).toBe('importer:src/real.ts')
  })

  it('B3：只有 manual_claim 声明 → unknown', () => {
    const c = makeComponent({ integrationEvidence: [{ kind: 'importer', ref: 'src/a.ts', observedAt: '2026-08-14', verification: 'manual_claim' }] })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).realCallerWired.status).toBe('unknown')
  })

  it('无合格证据 + 明确"零 importer" blocker → no', () => {
    const c = makeComponent({ currentBlockers: [{ id: 'zero-importers', kind: 'code', summary: '零 importer，等 WP05 成为第一个消费者' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('no')
    expect(s.realCallerWired.evidenceSource).toBe('blocker:zero-importers')
  })

  it('无证据也无负向 blocker → unknown', () => {
    expect(deriveOperationalSnapshot(makeComponent(), EMPTY_EXTERNAL_FACTS).realCallerWired.status).toBe('unknown')
  })
})

describe('production run observed?', () => {
  it('机器核验的 production_run → yes', () => {
    const c = makeComponent({ productionEvidence: [{ kind: 'production_run', ref: 'batch-x', observedAt: '2026-08-12', verification: 'sync_verified' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('yes')
    expect(s.productionRunObserved.evidenceSource).toBe('production_run:batch-x')
  })

  it('B3：manual_claim 的 production_run → unknown', () => {
    const c = makeComponent({ productionEvidence: [{ kind: 'production_run', ref: 'batch-x', observedAt: '2026-08-12', verification: 'manual_claim' }] })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).productionRunObserved.status).toBe('unknown')
  })

  it('me2_native + not_operating → no', () => {
    const s = deriveOperationalSnapshot(makeComponent({ operationalStatus: 'not_operating' }), EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('no')
    expect(s.productionRunObserved.evidenceSource).toBe('operationalStatus:not_operating')
  })

  it('legacy operating_legacy + legacyOperationalNote → unknown（静态声明不能升 yes）', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, operationalStatus: 'operating_legacy', legacyOperationalNote: 'xxx cron 每日在生产使用' })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).productionRunObserved.status).toBe('unknown')
  })

  it('legacy + not_operating → no', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, operationalStatus: 'not_operating' })
    expect(deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS).productionRunObserved.status).toBe('no')
  })
})
