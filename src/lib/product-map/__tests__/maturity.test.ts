/**
 * 成熟度推导的承重墙测试 —— 每一条对应 WP 的一句铁律,
 * 变异探针（scripts/product-map-mutation-check.sh）逐个拆闸验证这些用例会响。
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_EXTERNAL_FACTS } from '../external-facts'
import { deriveMaturity, evidenceCeiling } from '../maturity'
import type { ContractEvidence, IntegrationEvidence, LearningEvidence, ProductionEvidence } from '../types'
import { makeComponent, makeFacts, mergedPr, openDraftPr } from './_fixtures'

const CONTRACT: ContractEvidence = { kind: 'frozen_contract', ref: 'docs/x.md', verification: 'manual_claim' }
const INTEGRATION: IntegrationEvidence = { kind: 'importer', ref: 'src/a.ts', verification: 'manual_claim' }
const PRODUCTION: ProductionEvidence = { kind: 'production_run', ref: 'batch x', observedAt: '2026-08-12', verification: 'manual_claim' }
const learning = (day: string): LearningEvidence => ({ kind: 'recurring_outcome', ref: `outcome ${day}`, observedAt: day, verification: 'manual_claim' })

describe('merged PR 最多自动证明 M2', () => {
  it('契约 + merged implements PR → 上限恰好 M2,一步不多', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M2_IMPLEMENTED')
  })

  it('open draft PR 不算实现 —— Issue/PR 挂着不等于交付', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 962, role: 'implements' }],
    })
    expect(evidenceCeiling(c, makeFacts([openDraftPr(962)])).ceiling).toBe('M1_CONTRACT_FROZEN')
  })

  it('事实里查无此 PR → 不算 merged（不默认乐观）', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
    })
    expect(evidenceCeiling(c, EMPTY_EXTERNAL_FACTS).ceiling).toBe('M1_CONTRACT_FROZEN')
  })

  it('extends PR merged 不构成实现证据', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'extends' }],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M1_CONTRACT_FROZEN')
  })

  it('同一组件,事实从 open 变 merged,上限跟着动 —— 事实注入而非手抄', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
    })
    expect(evidenceCeiling(c, makeFacts([openDraftPr(100)])).ceiling).toBe('M1_CONTRACT_FROZEN')
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M2_IMPLEMENTED')
  })
})

describe('梯子严格累积:断在第一个缺口', () => {
  it('有生产证据但缺 integration → 停在 M2,不许跳级', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
      productionEvidence: [PRODUCTION],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M2_IMPLEMENTED')
  })

  it('me2 原生件缺冻结契约 → 停在 M0,哪怕 PR 已 merged', () => {
    const c = makeComponent({
      linkedPullRequests: [{ number: 100, role: 'implements' }],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M0_REGISTERED')
  })

  it('全链证据齐 → M5', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
      integrationEvidence: [INTEGRATION],
      productionEvidence: [PRODUCTION],
      learningEvidence: [learning('2026-08-10'), learning('2026-08-14')],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M5_OPERATING_AND_LEARNING')
  })
})

describe('M4/M5 的硬门', () => {
  it('缺生产证据 → 到不了 M4', () => {
    const c = makeComponent({
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
      integrationEvidence: [INTEGRATION],
    })
    expect(evidenceCeiling(c, makeFacts([mergedPr(100)])).ceiling).toBe('M3_INTEGRATED')
  })

  it('M5 要 ≥2 条不同日的 recurring_outcome;同一天两条不算', () => {
    const base = {
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' as const }],
      integrationEvidence: [INTEGRATION],
      productionEvidence: [PRODUCTION],
    }
    const sameDay = makeComponent({ ...base, learningEvidence: [learning('2026-08-14'), learning('2026-08-14')] })
    expect(evidenceCeiling(sameDay, makeFacts([mergedPr(100)])).ceiling).toBe('M4_PRODUCTION_VALIDATED')
    const oneOnly = makeComponent({ ...base, learningEvidence: [learning('2026-08-14')] })
    expect(evidenceCeiling(oneOnly, makeFacts([mergedPr(100)])).ceiling).toBe('M4_PRODUCTION_VALIDATED')
  })
})

describe('legacy 轴', () => {
  it('legacy 件走磁盘通路:ownedPaths + integration → M3', () => {
    const c = makeComponent({
      origin: 'legacy',
      operationalStatus: 'operating_legacy',
      ownedPaths: ['src/lib/x/'],
      integrationEvidence: [INTEGRATION],
    })
    expect(evidenceCeiling(c, EMPTY_EXTERNAL_FACTS).ceiling).toBe('M3_INTEGRATED')
  })

  it('legacy 件永远到不了 M4 —— 生产人生记在 operationalStatus,不许夸大成 ME2 M4', () => {
    const c = makeComponent({
      origin: 'legacy',
      operationalStatus: 'operating_legacy',
      ownedPaths: ['src/lib/x/'],
      integrationEvidence: [INTEGRATION],
      productionEvidence: [PRODUCTION],
    })
    expect(evidenceCeiling(c, EMPTY_EXTERNAL_FACTS).ceiling).toBe('M3_INTEGRATED')
  })

  it('legacy 件没有 ownedPaths → 连 M1 都没有', () => {
    const c = makeComponent({ origin: 'legacy', operationalStatus: 'operating_legacy' })
    expect(evidenceCeiling(c, EMPTY_EXTERNAL_FACTS).ceiling).toBe('M0_REGISTERED')
  })
})

describe('effectiveMaturity = min(declared, ceiling)', () => {
  it('声明高于上限被压下来,并给出卡点原因', () => {
    const c = makeComponent({ declaredMaturity: 'M4_PRODUCTION_VALIDATED', contractEvidence: [CONTRACT], productionEvidence: [PRODUCTION] })
    const d = deriveMaturity(c, EMPTY_EXTERNAL_FACTS)
    expect(d.evidenceCeiling).toBe('M1_CONTRACT_FROZEN')
    expect(d.effectiveMaturity).toBe('M1_CONTRACT_FROZEN')
    expect(d.ceilingReason).toContain('M1')
  })

  it('保守声明生效:上限 M3 而声明 M2 → effective M2', () => {
    const c = makeComponent({
      declaredMaturity: 'M2_IMPLEMENTED',
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
      integrationEvidence: [INTEGRATION],
    })
    expect(deriveMaturity(c, makeFacts([mergedPr(100)])).effectiveMaturity).toBe('M2_IMPLEMENTED')
  })

  it('M4 仅靠 manual_claim 支撑时打未核验标记', () => {
    const c = makeComponent({
      declaredMaturity: 'M4_PRODUCTION_VALIDATED',
      contractEvidence: [CONTRACT],
      linkedPullRequests: [{ number: 100, role: 'implements' }],
      integrationEvidence: [INTEGRATION],
      productionEvidence: [PRODUCTION],
    })
    expect(deriveMaturity(c, makeFacts([mergedPr(100)])).unverifiedCriticalEvidence).toBe(true)
  })
})
