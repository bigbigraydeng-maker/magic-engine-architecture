/**
 * ActionCandidate → ActionKey 映射。
 *
 * 这一层要证明的三件事：
 *   ① 映射不上一律**结构化拒绝**，而且分得清三种不同的原因；
 *   ② 任何输入都不会把它打崩（入参是 `unknown`，不能靠调用方守规矩）；
 *   ③ 拼字符串会有的那种误映射，这里造不出来。
 */

import { describe, it, expect } from 'vitest'
import {
  createCandidateMapper,
  mapCandidateIdentity,
  listGovernedActionVocabulary,
  GovernedVocabularyConfigurationError,
  MAPPING_TABLE,
  type CandidateMappingEntry,
} from '../index'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import type { ActionDefinition, ActionKey } from '@/lib/kernel/types'
import type { ActionRegistry } from '@/lib/kernel/registry'

const REAL_KEY = 'seo.build_publish_package' as const

/** 一个只认得 REAL_KEY 的注册表；用来跟「配对指向的动作不存在」区分开。 */
function registryWith(keys: readonly ActionKey[], version = 7): ActionRegistry {
  const has = (k: string): k is ActionKey => (keys as readonly string[]).includes(k)
  return {
    has,
    get: (k: string): ActionDefinition | null =>
      has(k) ? ({ actionKey: k, version, title: `title:${k}`, sideEffect: 'internal_write' } as unknown as ActionDefinition) : null,
    keys: () => keys,
  }
}

const table = (entries: CandidateMappingEntry[]): readonly CandidateMappingEntry[] => entries

describe('映射：形状不成立的输入一律安全拒绝', () => {
  const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: table([]) })

  it('🔴 null / undefined / 数组 / 原始值 都不许把它打崩', () => {
    for (const bad of [null, undefined, [], ['geo'], 'geo', 42, true, Symbol('x')]) {
      const result = mapper.map(bad)
      expect(result.outcome, `${String(bad)} 应该被拒绝`).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })

  it('缺字段 / 字段不是字符串 → malformed_identity', () => {
    for (const bad of [
      {},
      { domain: 'geo' },
      { intent: 'optimize' },
      { domain: 'geo', intent: 1 },
      { domain: null, intent: 'optimize' },
      { domain: ['geo'], intent: 'optimize' },
    ]) {
      const result = mapper.map(bad)
      expect(result.outcome).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })

  it('🔴 纯空白不算有内容（否则 " " 会被当成一个合法的域）', () => {
    for (const bad of [
      { domain: '', intent: 'optimize' },
      { domain: '   ', intent: 'optimize' },
      { domain: 'geo', intent: '' },
      { domain: 'geo', intent: '\t\n ' },
    ]) {
      const result = mapper.map(bad)
      expect(result.outcome).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })
})

describe('映射：三种拒绝原因分得开', () => {
  it('身份是好的但没人认领 → unmapped_identity（不是 malformed）', () => {
    const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: table([]) })
    const result = mapper.map({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'unmapped_identity' })
    if (result.outcome === 'rejected') {
      expect(result.reason).toContain('geo')
      expect(result.reason).toContain('optimize_page_answerability')
    }
  })

  it('🔴 配对指向的动作注册表里没有 → registry_drift（是配置问题，不是调用方的错）', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([]), // 注册表空了
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'registry_drift' })
  })

  it('配对得上 → mapped，且版本号从注册表读（不从配对表读）', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY], 9),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result).toEqual({ outcome: 'mapped', actionKey: REAL_KEY, actionVersion: 9 })
  })
})

describe('映射：判别联合是诚实的', () => {
  const mapper = createCandidateMapper({
    registry: registryWith([REAL_KEY]),
    table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
  })

  it('🔴 rejected 分支运行时不许混进 actionKey / actionVersion', () => {
    const result = mapper.map({ domain: 'geo', intent: 'nope' })
    expect(result.outcome).toBe('rejected')
    expect(Object.keys(result).sort()).toEqual(['code', 'outcome', 'reason'])
    expect('actionKey' in result).toBe(false)
    expect('actionVersion' in result).toBe(false)
  })

  it('🔴 mapped 分支运行时不许混进 code / reason，且两个成功字段都必须在', () => {
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result.outcome).toBe('mapped')
    expect(Object.keys(result).sort()).toEqual(['actionKey', 'actionVersion', 'outcome'])
    expect('code' in result).toBe(false)
    expect('reason' in result).toBe(false)
  })
})

describe('映射：不拼字符串，所以造不出分隔符碰撞', () => {
  /**
   * 🔴 早先设计用 `${domain}:${intent}` 当键。那样下面这两个不同的候选
   *    会算出同一个键 `geo:x:y`，于是其中一个会被误映射到另一个的动作上。
   */
  const mapper = createCandidateMapper({
    registry: registryWith([REAL_KEY]),
    table: table([{ domain: 'geo', intent: 'x:y', actionKey: REAL_KEY }]),
  })

  it('🔴 `{domain:"geo:x", intent:"y"}` 不许命中 `{domain:"geo", intent:"x:y"}` 的配对', () => {
    const collided = mapper.map({ domain: 'geo:x', intent: 'y' })
    expect(collided.outcome).toBe('rejected')
    expect(collided).toMatchObject({ code: 'unmapped_identity' })
  })

  it('真正配得上的那一个照常命中', () => {
    const exact = mapper.map({ domain: 'geo', intent: 'x:y' })
    expect(exact).toMatchObject({ outcome: 'mapped', actionKey: REAL_KEY })
  })

  it('大小写 / 首尾空白都不做规范化 —— 不模糊匹配', () => {
    for (const near of [
      { domain: 'GEO', intent: 'x:y' },
      { domain: ' geo', intent: 'x:y' },
      { domain: 'geo', intent: 'X:Y' },
    ]) {
      expect(mapper.map(near).outcome, JSON.stringify(near)).toBe('rejected')
    }
  })
})

describe('受治理的词汇表', () => {
  it('由配对表 ⋈ 注册表派生 —— 不维护第二份清单', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY], 3),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    expect(mapper.listVocabulary()).toEqual([
      {
        domain: 'geo',
        intent: 'optimize',
        actionKey: REAL_KEY,
        title: `title:${REAL_KEY}`,
        sideEffect: 'internal_write',
      },
    ])
  })

  it('🔴 注册表漂移必须当场炸，不许静默跳过返回一份残缺清单', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([]),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    expect(() => mapper.listVocabulary()).toThrow(GovernedVocabularyConfigurationError)
    expect(() => mapper.listVocabulary()).toThrow(/注册表里没有这个动作/)
  })
})

describe('生产实例：当前状态', () => {
  it('🔴 生产配对表是空的 —— 没有真实调用方之前不预注册任何动作', () => {
    expect(MAPPING_TABLE).toEqual([])
  })

  it('生产词汇表因此是空的（而不是报错）', () => {
    expect(listGovernedActionVocabulary()).toEqual([])
  })

  it('生产映射对任何候选都拒绝 —— 现在还没有任何身份被治理认领', () => {
    const result = mapCandidateIdentity({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'unmapped_identity' })
  })

  it('真注册表确实认得那个唯一的内部动作（证明上一条不是因为注册表是空的）', () => {
    expect(ACTION_REGISTRY.get(REAL_KEY)?.actionKey).toBe(REAL_KEY)
  })
})
