import { describe, it, expect } from 'vitest'
import type { PageFieldDiff } from '@/lib/page-optimization'
import {
  canonicalDiffHash,
  idempotencyKeyFromInput,
  branchNameForRun,
} from '../hash'

describe('canonicalDiffHash', () => {
  const A: PageFieldDiff = { field: 'meta_description', before: 'x', after: 'y', changed: true }
  const B: PageFieldDiff = { field: 'meta_title', before: 't1', after: 't2', changed: true }

  it('稳定：同一份 diff 两次得同一个 hash', () => {
    expect(canonicalDiffHash([A, B])).toBe(canonicalDiffHash([A, B]))
  })

  it('顺序敏感（因为是 array serialization）', () => {
    expect(canonicalDiffHash([A, B])).not.toBe(canonicalDiffHash([B, A]))
  })

  it('内容一改就变', () => {
    const A2: PageFieldDiff = { ...A, after: 'z' }
    expect(canonicalDiffHash([A])).not.toBe(canonicalDiffHash([A2]))
  })

  it('前 40 位 hex', () => {
    expect(canonicalDiffHash([A])).toMatch(/^[a-f0-9]{40}$/)
  })

  it('多余字段不影响 hash（只对 field/before/after/changed 负责）', () => {
    const withExtra = { ...A, extraStuff: 'ignore-me' } as unknown as PageFieldDiff
    expect(canonicalDiffHash([withExtra])).toBe(canonicalDiffHash([A]))
  })
})

describe('idempotencyKeyFromInput', () => {
  it('三元组的任意一个字段变 → key 变', () => {
    const base = idempotencyKeyFromInput('u1', 'v1', 'h1')
    expect(idempotencyKeyFromInput('u2', 'v1', 'h1')).not.toBe(base)
    expect(idempotencyKeyFromInput('u1', 'v2', 'h1')).not.toBe(base)
    expect(idempotencyKeyFromInput('u1', 'v1', 'h2')).not.toBe(base)
  })

  it('长度 = 24 hex', () => {
    expect(idempotencyKeyFromInput('u', 'v', 'h')).toMatch(/^[a-f0-9]{24}$/)
  })
})

describe('branchNameForRun', () => {
  it('me/page-apply/ 前缀', () => {
    expect(branchNameForRun('abc123')).toBe('me/page-apply/abc123')
  })
})
