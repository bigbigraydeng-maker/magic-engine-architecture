/**
 * 四问运营快照测试 —— 每问至少覆盖 yes / no / unknown 三态各一个用例,
 * 逐条对应 Build Control Room 2026-08-15 05:43 复审 Blocker 4 的三条铁律。
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_EXTERNAL_FACTS } from '../external-facts'
import { deriveOperationalSnapshot } from '../operational-snapshot'
import { makeComponent, makeFacts, mergedPr, openDraftPr } from './_fixtures'

describe('code in main?', () => {
  it('me2_native + merged implements PR → yes,evidenceSource 带 PR 号', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 100, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([mergedPr(100)]))
    expect(s.codeInMain.status).toBe('yes')
    expect(s.codeInMain.evidenceSource).toContain('#100')
    expect(s.codeInMain.checkedAt).toBe('2026-08-15')
  })

  it('me2_native + open draft PR → no（明确负向信号,不是 unknown）', () => {
    const c = makeComponent({ linkedPullRequests: [{ number: 962, role: 'implements' }] })
    const s = deriveOperationalSnapshot(c, makeFacts([openDraftPr(962)]))
    expect(s.codeInMain.status).toBe('no')
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

  it('legacy + ownedPaths 非空 → yes（磁盘核验通路）', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, ownedPaths: ['src/lib/x/'] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('yes')
  })

  it('legacy 无 ownedPaths → unknown', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, ownedPaths: [] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.codeInMain.status).toBe('unknown')
  })
})

describe('production prerequisites actually exist?', () => {
  it('有 provisioning blocker → no', () => {
    const c = makeComponent({
      currentBlockers: [{ id: 'tables-missing', kind: 'provisioning', summary: '四张表未在生产建立' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('no')
  })

  it('有 production_data 证据 → yes', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_data', ref: 'geo_batches=3', observedAt: '2026-08-12', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('yes')
    expect(s.productionPrerequisitesExist.checkedAt).toBe('2026-08-12')
  })

  it('两者都没登记 → unknown', () => {
    const c = makeComponent()
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionPrerequisitesExist.status).toBe('unknown')
  })
})

describe('real caller wired?', () => {
  it('有 integrationEvidence → yes', () => {
    const c = makeComponent({ integrationEvidence: [{ kind: 'importer', ref: 'src/a.ts', verification: 'manual_claim' }] })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('yes')
  })

  it('无证据 + 明确"零 importer" blocker → no', () => {
    const c = makeComponent({
      currentBlockers: [{ id: 'zero-importers', kind: 'code', summary: '零 importer，等 WP05 成为第一个消费者' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('no')
  })

  it('无证据也无明确负向 blocker → unknown（不许默认判 no）', () => {
    const c = makeComponent()
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.realCallerWired.status).toBe('unknown')
  })
})

describe('production run observed?', () => {
  it('me2_native + production_run 证据 → yes', () => {
    const c = makeComponent({
      productionEvidence: [{ kind: 'production_run', ref: 'batch x', observedAt: '2026-08-12', verification: 'manual_claim' }],
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('yes')
  })

  it('me2_native + operationalStatus=not_operating → no', () => {
    const c = makeComponent({ operationalStatus: 'not_operating' })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('no')
  })

  it('legacy + operating_legacy + legacyOperationalNote → yes（真实运营,但不构成 ME2 M4）', () => {
    const c = makeComponent({
      origin: 'legacy',
      architecturalRole: undefined,
      operationalStatus: 'operating_legacy',
      legacyOperationalNote: 'xxx cron 每日在生产使用',
    })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('yes')
  })

  it('legacy + operating_legacy 但没写 legacyOperationalNote → unknown', () => {
    const c = makeComponent({ origin: 'legacy', architecturalRole: undefined, operationalStatus: 'operating_legacy' })
    const s = deriveOperationalSnapshot(c, EMPTY_EXTERNAL_FACTS)
    expect(s.productionRunObserved.status).toBe('unknown')
  })
})
