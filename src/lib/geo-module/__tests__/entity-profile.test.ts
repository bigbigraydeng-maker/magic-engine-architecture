/**
 * GEO Module de-hardcode regression — Magic Engine second scenario + fail-closed contract.
 *
 * 目的：证明 shared runtime 已经真正 de-hardcode —— 同一份 `runGeoModule` / `interpretObservation`
 * 用不同 `entityProfile` 能针对第二个真实场景（Magic Engine）跑通，并且缺失 profile 时 fail-closed。
 *
 * 🔴 M1 shared reasoning 门保持 `geo.length > 0 && domain.length > 0` 不变（Plan v2 §4）：
 *    Magic Engine 靠 profile 提供的 `disambiguationAnchors: ['digital marketing', 'seo']`
 *    + `geoAnchorsMultiword: ['australia', 'new zealand']` + `geoAnchorsShortWordBoundary: ['au','nz']`
 *    真实过 disambiguation；缺 domain anchor 时 honest defer 到 `disambiguation_insufficient`。
 */

import { describe, expect, it } from 'vitest'
import { interpretObservation, GeoEntityProfileError } from '../m1'
import { buildPrescription } from '../prescription'
import { buildQualifiedMentionVerification, GeoBaselineRefError } from '../verification'
import type { GeoEntityProfile } from '../types'
import type { GrowthFinding } from '@/lib/growth'
import { makeObservation, makeEvidence, ROMAN_BATCH_ID } from './fixtures'

/**
 * Magic Engine entity profile —— 每一项均来自 #1049 Entity Definition v1 approved fact
 * （product type / canonical description / primary market）。
 * disambiguationAnchors 只收 `digital marketing` / `seo` 两条强锚点（Plan v2 §2 冻结）。
 */
const ME_ENTITY_PROFILE: GeoEntityProfile = {
  canonicalDisplayName: 'Magic Engine',
  disambiguationAnchors: ['digital marketing', 'seo'],
  geoAnchorsMultiword: ['australia', 'new zealand'],
  geoAnchorsShortWordBoundary: ['au', 'nz'],
}

const ME_QUESTION = { known: true, value: 'What is Magic Engine' } as const

describe('GeoEntityProfile — Magic Engine positive path', () => {
  it('body 命中实体 + AU/NZ geo anchor + digital marketing 强锚点 → disambiguation qualified + qualified mention', () => {
    const answer =
      'Magic Engine is an AI-powered digital marketing platform for Australia and New Zealand small businesses.'
    const observation = makeObservation({ query_key: 'q-what-is-me' })
    const evidence = makeEvidence({ raw_response: answer })
    const r = interpretObservation({
      observation,
      evidence,
      entityProfile: ME_ENTITY_PROFILE,
      brandAliases: [],
      questionText: ME_QUESTION,
    })
    expect(r.disposition).toBe('interpreted')
    expect(r.entityMatch.kind).toBe('body_match')
    expect(r.disambiguation.qualified).toBe(true)
    if (r.disambiguation.qualified) {
      // 期望同时命中至少一个 geo 锚点和一个 domain 锚点
      expect(r.disambiguation.anchors).toEqual(
        expect.arrayContaining(['australia', 'digital marketing']),
      )
    }
    expect(r.qualifiedMention.qualified).toBe(true)
  })

  it('body 命中实体 + AU/NZ geo anchor + seo 强锚点 → disambiguation qualified', () => {
    const answer = 'Magic Engine helps NZ teams improve SEO across search engines.'
    const observation = makeObservation({ query_key: 'q-me-seo' })
    const evidence = makeEvidence({ raw_response: answer })
    const r = interpretObservation({
      observation,
      evidence,
      entityProfile: ME_ENTITY_PROFILE,
      brandAliases: [],
      questionText: ME_QUESTION,
    })
    expect(r.disambiguation.qualified).toBe(true)
    if (r.disambiguation.qualified) {
      expect(r.disambiguation.anchors).toEqual(expect.arrayContaining(['nz', 'seo']))
    }
  })
})

describe('GeoEntityProfile — Magic Engine negative path', () => {
  it('body 命中实体 + AU/NZ geo anchor 但缺强 domain/disambiguation anchor → disambiguation_insufficient', () => {
    // 实体命中 + 地理锚点命中，但没有出现 disambiguationAnchors 里的任何一个（'digital marketing' / 'seo'）。
    const answer = 'Magic Engine is a company based in Australia offering various tools.'
    const observation = makeObservation({ query_key: 'q-me-generic' })
    const evidence = makeEvidence({ raw_response: answer })
    const r = interpretObservation({
      observation,
      evidence,
      entityProfile: ME_ENTITY_PROFILE,
      brandAliases: [],
      questionText: ME_QUESTION,
    })
    expect(r.entityMatch.kind).toBe('body_match')
    expect(r.disambiguation.qualified).toBe(false)
    if (!r.disambiguation.qualified) {
      expect(r.disambiguation.reason).toBe('disambiguation_insufficient')
    }
    // qualifiedMention 也应因 disambiguation 未过而落 disambiguation_insufficient
    expect(r.qualifiedMention.qualified).toBe(false)
  })
})

describe('GeoEntityProfile — fail-closed contract', () => {
  const base = {
    observation: makeObservation(),
    evidence: makeEvidence({ raw_response: 'Magic Engine is a digital marketing platform in Australia.' }),
    brandAliases: [] as readonly string[],
    questionText: ME_QUESTION,
  } as const

  it('missing entityProfile 直接抛 GeoEntityProfileError', () => {
    // @ts-expect-error 故意漏传 —— 验证 runtime 校验器（不依赖 TypeScript）
    expect(() => interpretObservation({ ...base })).toThrow(GeoEntityProfileError)
  })

  it('entityProfile 缺字段 → 抛错', () => {
    const partial = {
      canonicalDisplayName: 'Magic Engine',
      // 故意漏 disambiguationAnchors / geoAnchorsMultiword / geoAnchorsShortWordBoundary
    } as unknown as GeoEntityProfile
    expect(() => interpretObservation({ ...base, entityProfile: partial })).toThrow(GeoEntityProfileError)
  })

  it('entityProfile.canonicalDisplayName 空串 → 抛错', () => {
    const bad: GeoEntityProfile = {
      canonicalDisplayName: '   ',
      disambiguationAnchors: [],
      geoAnchorsMultiword: [],
      geoAnchorsShortWordBoundary: [],
    }
    expect(() => interpretObservation({ ...base, entityProfile: bad })).toThrow(GeoEntityProfileError)
  })

  it('entityProfile.disambiguationAnchors 非数组 → 抛错', () => {
    const bad = {
      canonicalDisplayName: 'Magic Engine',
      disambiguationAnchors: 'digital marketing' as unknown as readonly string[],
      geoAnchorsMultiword: [],
      geoAnchorsShortWordBoundary: [],
    } as GeoEntityProfile
    expect(() => interpretObservation({ ...base, entityProfile: bad })).toThrow(GeoEntityProfileError)
  })

  // ── 空字符串 anchor fail-closed 闸（Build Control Review 补口）──
  // 背景：JS 里 `"anything".includes("") === true`，`[''] anchor` 会静默污染
  // 消歧的 `geo && domain` 门，让任何文本都通过。**必须**堵在校验器。

  it('disambiguationAnchors: [""] → fail closed（避免 includes("") 污染消歧门）', () => {
    const bad: GeoEntityProfile = {
      canonicalDisplayName: 'Magic Engine',
      disambiguationAnchors: [''],
      geoAnchorsMultiword: [],
      geoAnchorsShortWordBoundary: [],
    }
    expect(() => interpretObservation({ ...base, entityProfile: bad })).toThrow(GeoEntityProfileError)
  })

  it('geoAnchorsMultiword: [" "] → fail closed（纯空白同样禁止）', () => {
    const bad: GeoEntityProfile = {
      canonicalDisplayName: 'Magic Engine',
      disambiguationAnchors: ['seo'],
      geoAnchorsMultiword: [' '],
      geoAnchorsShortWordBoundary: [],
    }
    expect(() => interpretObservation({ ...base, entityProfile: bad })).toThrow(GeoEntityProfileError)
  })

  it('geoAnchorsShortWordBoundary: [""] → fail closed', () => {
    const bad: GeoEntityProfile = {
      canonicalDisplayName: 'Magic Engine',
      disambiguationAnchors: ['seo'],
      geoAnchorsMultiword: [],
      geoAnchorsShortWordBoundary: [''],
    }
    expect(() => interpretObservation({ ...base, entityProfile: bad })).toThrow(GeoEntityProfileError)
  })
})

// ── 第二轮：Prescription / Verification Roman semantic residue cleanup ──
// Magic Engine Customer Zero 真实运行生产了：`让 AI 答案真正把 Magic Engine 作为人 / 选项提及`
// 和 `#883 基线批次 <Magic Engine batch id>` —— 这两段本轮 patch 后不应再出现。

const FAKE_FINDING: GrowthFinding = {
  pillar: 'ai_visibility',
  severity: 'medium',
  statement: 'stub finding for prescription text regression',
  evidence: [
    {
      source: { kind: 'test', sourceId: 'fixture-1' },
      observedAt: '2026-08-18T00:00:00.000Z',
      rawLocator: { known: false, reason: 'not_recorded_by_source' },
      interpretation: { known: false, reason: 'not_recorded_by_source' },
      confidence: { known: false, reason: 'not_recorded_by_source' },
    },
  ],
}

describe('Prescription text — no "真人 Roman" semantics for brand entity', () => {
  it('Roman prescription 保持语义自然（含 Roman 名字，不含 "作为人"）', () => {
    const p = buildPrescription(FAKE_FINDING, 'Roman Hu')
    const notDoingText = p.notDoing.map((x) => x.statement).join(' ')
    // 中性 notDoing 文本不涉及 "姓氏" / "雇主"
    expect(notDoingText).not.toContain('姓氏')
    expect(notDoingText).not.toContain('雇主')
    // Roman 名字必须自然出现在 orderingRationale
    expect(p.orderingRationale).toContain('Roman Hu')
    // Roman 版本不能再自诩「作为人 / 选项」——已改中性表达
    expect(p.orderingRationale).not.toContain('作为人 / 选项')
    // 应保留「作为相关选项明确提及」新中性表达
    expect(p.orderingRationale).toContain('作为相关选项明确提及')
  })

  it('Magic Engine prescription 不含 "作为人" / "姓氏" / "雇主" 等真人语义', () => {
    const p = buildPrescription(FAKE_FINDING, 'Magic Engine')
    const notDoingText = p.notDoing.map((x) => x.statement).join(' ')
    expect(notDoingText).not.toContain('作为人')
    expect(notDoingText).not.toContain('姓氏')
    expect(notDoingText).not.toContain('雇主')
    expect(notDoingText).not.toContain('#883')
    expect(p.orderingRationale).not.toContain('作为人')
    expect(p.orderingRationale).toContain('Magic Engine')
    expect(p.orderingRationale).toContain('作为相关选项明确提及')
  })

  it('notDoing 保留「禁止凭空建立身份关联」的原语义（中性表达）', () => {
    const p = buildPrescription(FAKE_FINDING, 'Magic Engine')
    const notDoingText = p.notDoing.map((x) => x.statement).join(' ')
    expect(notDoingText).toContain('别名')
    expect(notDoingText).toContain('身份关联')
    expect(notDoingText).toContain('域名归属')
    expect(notDoingText).toContain('组织关系')
  })

  it('notDoing 「不回写基线」不再带 #883 issue 号', () => {
    const p = buildPrescription(FAKE_FINDING, 'Magic Engine')
    const notDoingText = p.notDoing.map((x) => x.statement).join(' ')
    expect(notDoingText).not.toContain('#883')
    expect(notDoingText).toContain('基线观测')
  })
})

describe('Verification — no Roman hidden default / no #883 in baseline text', () => {
  it('缺 baselineBatchId → fail closed (GeoBaselineRefError)', () => {
    // @ts-expect-error 故意漏传 —— runtime 校验器不能默默回 Roman
    expect(() => buildQualifiedMentionVerification({})).toThrow(GeoBaselineRefError)
  })

  it('baselineBatchId 空串 → fail closed', () => {
    expect(() => buildQualifiedMentionVerification({ baselineBatchId: '' })).toThrow(GeoBaselineRefError)
  })

  it('Magic Engine baseline 显式传入 → baseline 文本不含 Roman / #883', () => {
    const v = buildQualifiedMentionVerification({
      baselineBatchId: 'a2f09f81-ab65-4a25-b323-567fd70f8dff',
    })
    expect(v.baseline).not.toContain('Roman')
    expect(v.baseline).not.toContain('#883')
    // 应含中性表达 + 传入的 batch id
    expect(v.baseline).toContain('基线批次 a2f09f81-ab65-4a25-b323-567fd70f8dff')
    expect(v.baseline).toContain('geo-module/m1/v1')
  })

  it('Roman baseline 显式传入 → baseline 文本仍自然（含 batch id，不含 #883）', () => {
    const v = buildQualifiedMentionVerification({ baselineBatchId: ROMAN_BATCH_ID })
    expect(v.baseline).toContain(ROMAN_BATCH_ID)
    expect(v.baseline).not.toContain('#883')
  })
})
