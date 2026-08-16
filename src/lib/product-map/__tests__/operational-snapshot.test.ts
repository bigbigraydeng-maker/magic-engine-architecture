/**
 * 四问运营快照测试 —— 每问覆盖 yes / no / unknown 三态,
 * 逐条对应 Build Control Room 2026-08-15 复审 Blocker 4 的铁律,外加本轮纠正：
 *
 * - B3：status==='yes' 必须带非 null 的 checkedAt。无带日期的机器证据 → unknown,
 *   不编一个 checkedAt=null 的 yes（静态文档/legacy 声明/无 observedAt 的证据都算无日期）。
 * - B4：evidenceSource 是证据身份指针（#PR / kind:ref / blocker:id / operationalStatus:值）,
 *   不是散文结论。
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_EXTERNAL_FACTS } from '../external-facts'
import { deriveOperationalSnapshot } from '../operational-snapshot'
import { makeComponent, makeFacts, mergedPr, openDraftPr } from './_fixtures'

describe('code in main?', () => {
  it('me2_native + merged implements PR → yes,evidenceSource 带 PR 号 + 带 checkedAt', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPr(100)]))
    expect(s.codeInMain.status).toBe('yes')
    expect(s.codeInMain.evidenceSource).toContain('#100')
    expect(s.codeInMain.checkedAt).toBe('2026-08-15')
  })

  it('me2_native + open draft PR → no（明确负向信号,不是 unknown）,带机器事实日期', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 962, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([openDraftPr(962)]))
    expect(s.codeInMain.status).toBe('no')
    expect(s.codeInMain.checkedAt).toBe('2026-08-15')
  })

  it('未登记 implements PR → unknown,不是 no', () => {
    const c = makeComponent({ linkedPullRequests: [] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('登记了 PR 但 ExternalFacts 查无此号 → unknown,不默认乐观也不默认悲观', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
  })

  it('B3：legacy 无 GitHub 同步事实 → unknown（ownedPaths 存在≠带日期证明在 main）', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, ownedPaths: ['src/lib/x/'] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
    expect(s.codeInMain.checkedAt).toBeNull()
  })
})

describe('production prerequisites actually exist?', () => {
  it('有 provisioning blocker → no,evidenceSource=blocker:id（B4）', () => {
    const c = makeComponent({
      currentBlockers: [{ id: 'tables-missing', kind: 'provisioning', summary: '四张表未在生产建立' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('no')
    expect(s.productionPrerequisitesExist.evidenceSource).toBe('blocker:tables-missing')
  })

  it('有 production_data 证据（带 observedAt）→ yes,带 checkedAt', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', observedAt: '2026-08-12', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('yes')
    expect(s.productionPrerequisitesExist.checkedAt).toBe('2026-08-12')
    expect(s.productionPrerequisitesExist.evidenceSource).toBe('production_data:geo_batches=3')
  })

  it('B3：production_data 证据缺 observedAt → unknown（不编无日期的 yes）', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('unknown')
    expect(s.productionPrerequisitesExist.checkedAt).toBeNull()
  })

  it('两者都没登记 → unknown', () => {
    const c = makeComponent()
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('unknown')
  })
})

describe('real caller wired?', () => {
  it('有 integrationEvidence（带 observedAt）→ yes,evidenceSource=kind:ref（B4）', () => {
    const c = makeComponent({
      integrationEvidence: [{ kind: 'importer', ref: 'src/a.ts', observedAt: '2026-08-14', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('yes')
    expect(s.realCallerWired.evidenceSource).toBe('importer:src/a.ts')
    expect(s.realCallerWired.checkedAt).toBe('2026-08-14')
  })

  it('B3：integrationEvidence 缺 observedAt → unknown（不编无日期的 yes）', () => {
    const c = makeComponent({ integrationEvidence: [{ kind: 'importer', ref: 'src/a.ts', verification: 'manual_claim' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('unknown')
    expect(s.realCallerWired.checkedAt).toBeNull()
  })

  it('无证据 + 明确"零 importer" blocker → no,evidenceSource=blocker:id（B4）', () => {
    const c = makeComponent({
      currentBlockers: [{ id: 'zero-importers', kind: 'code', summary: '零 importer，等 WP05 成为第一个消费者' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('no')
    expect(s.realCallerWired.evidenceSource).toBe('blocker:zero-importers')
  })

  it('无证据也无明确负向 blocker → unknown（不许默认判 no）', () => {
    const c = makeComponent()
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('unknown')
  })
})

describe('production run observed?', () => {
  it('me2_native + production_run 证据（带 observedAt）→ yes', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_run', ref: 'batch-x', observedAt: '2026-08-12', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('yes')
    expect(s.productionRunObserved.evidenceSource).toBe('production_run:batch-x')
    expect(s.productionRunObserved.checkedAt).toBe('2026-08-12')
  })

  it('B3：production_run 证据缺 observedAt → unknown', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_run', ref: 'batch-x', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('unknown')
  })

  it('me2_native + operationalStatus=not_operating → no', () => {
    const c = makeComponent({ operationalStatus: 'not_operating' })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('no')
    expect(s.productionRunObserved.evidenceSource).toBe('operationalStatus:not_operating')
  })

  it('B3：legacy operating_legacy + legacyOperationalNote → unknown（静态声明不能升成 yes）', () => {
    const c = makeComponent({
      origin: 'legacy',
      architecturalRole: undefined,
      operationalStatus: 'operating_legacy',
      legacyOperationalNote: 'xxx cron 每日在生产使用',
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('unknown')
    expect(s.productionRunObserved.checkedAt).toBeNull()
  })

  it('legacy + not_operating → no', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, operationalStatus: 'not_operating' })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('no')
  })
})
