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
import type { GeoEntityProfile } from '../types'
import { makeObservation, makeEvidence } from './fixtures'

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
})
