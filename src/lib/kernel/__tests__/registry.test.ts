/**
 * 注册表与幂等键 —— 封闭词汇表 + 稳定身份。
 */

import { describe, it, expect } from 'vitest'
import { ACTION_REGISTRY, ACTION_KEYS, validateAgainstSchema } from '../registry'
import { computeIdempotencyKey, computeUnknownActionKey } from '../idempotency'
import { KernelError } from '../errors'
import type { ActionDefinition } from '../types'

const DEF = ACTION_REGISTRY.get('seo.build_publish_package') as ActionDefinition

describe('注册表是封闭的', () => {
  it('认得出自己注册过的动作', () => {
    expect(ACTION_REGISTRY.has('seo.build_publish_package')).toBe(true)
    expect(ACTION_REGISTRY.get('seo.build_publish_package')?.version).toBe(1)
  })

  it('🔴 认不出的一律返回 null，绝不返回「大概是这个」', () => {
    // 这几个都是库里真实出现过的自由文本动作类型
    for (const key of [
      'diversify_meta_ad_creatives',
      'diversify_meta_creatives',
      'seo.refresh_blog',
      'publish_geo_directive',
      '',
    ]) {
      expect(ACTION_REGISTRY.has(key)).toBe(false)
      expect(ACTION_REGISTRY.get(key)).toBeNull()
    }
  })

  it('原型链上的属性不算注册过的动作', () => {
    // `key in obj` 会把 toString / constructor 也算进来 —— 那是能被利用的
    expect(ACTION_REGISTRY.has('toString')).toBe(false)
    expect(ACTION_REGISTRY.has('constructor')).toBe(false)
    expect(ACTION_REGISTRY.get('__proto__')).toBeNull()
  })

  it('keys() 给得出完整清单（将来要反向注入 agent prompt 收口生成端）', () => {
    expect(ACTION_KEYS).toContain('seo.build_publish_package')
    expect(ACTION_KEYS.length).toBe(Object.keys({ 'seo.build_publish_package': 1 }).length)
  })
})

describe('输入契约校验', () => {
  it('缺必填 → 说清缺哪个', () => {
    const r = validateAgainstSchema(DEF.inputSchema, { blog_post_id: 'x' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('content_hash')
  })

  it('类型不对 → 说清应该是什么', () => {
    const r = validateAgainstSchema(DEF.inputSchema, { blog_post_id: 1, content_hash: 'h' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('string')
  })

  it('多了没定义的字段 → 拒绝（防止悄悄夹带指令）', () => {
    const r = validateAgainstSchema(DEF.inputSchema, {
      blog_post_id: 'x',
      content_hash: 'h',
      publish: true,
    })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('publish')
  })

  it('不是对象 → 拒绝', () => {
    expect(validateAgainstSchema(DEF.inputSchema, 'not an object').ok).toBe(false)
    expect(validateAgainstSchema(DEF.inputSchema, ['a']).ok).toBe(false)
    expect(validateAgainstSchema(DEF.inputSchema, null).ok).toBe(false)
  })
})

describe('幂等键', () => {
  it('同样的输入永远算出同一把键（字段顺序不影响）', () => {
    const a = computeIdempotencyKey(DEF, 'client-1', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'client-1', { content_hash: 'h1', blog_post_id: 'p1' })
    expect(a).toBe(b)
  })

  it('客户不同 → 键不同（scope=client 的含义）', () => {
    const a = computeIdempotencyKey(DEF, 'client-1', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'client-2', { blog_post_id: 'p1', content_hash: 'h1' })
    expect(a).not.toBe(b)
  })

  it('任一键字段变了 → 键就变（那是另一件事，不是重复执行）', () => {
    const base = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1' })
    expect(computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p2', content_hash: 'h1' })).not.toBe(base)
    expect(computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h2' })).not.toBe(base)
  })

  it('不参与键的字段变了 → 键不变', () => {
    const a = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1', note: '随手写的' })
    expect(a).toBe(b)
  })

  it('🔴 键字段是空的 → 抛错，不拿 undefined 参与计算', () => {
    // 悄悄用 undefined 算的话，两条其实不同的提交会算出同一把键，
    // 于是第二件事会被误判成「已经做过了」而永远不做。
    for (const bad of [undefined, null, '']) {
      expect(() =>
        computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: bad }),
      ).toThrow(KernelError)
    }
  })

  it('未知动作也有稳定身份（否则每天新增一条一样的拒绝记录）', () => {
    const a = computeUnknownActionKey('ads.whatever', 'c', { x: 1 })
    const b = computeUnknownActionKey('ads.whatever', 'c', { x: 1 })
    const c = computeUnknownActionKey('ads.whatever', 'c', { x: 2 })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('unknown:')).toBe(true)
  })
})
