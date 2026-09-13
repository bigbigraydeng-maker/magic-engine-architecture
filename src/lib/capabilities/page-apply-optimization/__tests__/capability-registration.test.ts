/**
 * PM Change A：createCapabilities 必须把 page.apply_optimization_request 注册进去。
 * 没有这一步，Kernel authorize 通过后一执行就 dead-letter。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createCapabilities } from '@/lib/capabilities'

const KEY = 'page.apply_optimization_request'

describe(`createCapabilities · ${KEY} 已注册`, () => {
  const fakeSb = {} as SupabaseClient
  const caps = createCapabilities(fakeSb)

  it('key 出现在装配表里', () => {
    expect(Object.keys(caps)).toContain(KEY)
  })

  it('impl 的 actionKey 匹配', () => {
    expect(caps[KEY].actionKey).toBe(KEY)
  })

  it('四个 step handler 都存在', () => {
    expect(Object.keys(caps[KEY].steps).sort()).toEqual(['commit', 'open_pr', 'prepare', 'record'])
  })
})
