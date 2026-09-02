/**
 * locationCodeFor 是「客户在哪个国家」到 DataForSEO location_code 的唯一映射，
 * 但它此前没有任何测试 —— 而 2026-08-26 发现张骞的预取把 2036(AU) 写死，
 * 所有新西兰客户拿到的都是澳洲搜索数据。修复改成调用这个函数，
 * 所以它现在是承重件，必须锁住。
 */
import { describe, it, expect } from 'vitest'
import { locationCodeFor } from '../client'

describe('locationCodeFor', () => {
  it('nz → 2554（不是澳洲的 2036）', () => {
    expect(locationCodeFor('nz')).toBe(2554)
  })

  it('au → 2036', () => {
    expect(locationCodeFor('au')).toBe(2036)
  })

  // 客户档案里 semrush_db 可能为空（新建客户还没填）。
  // 兜底必须是确定的，不能变成 undefined 传进 API。
  it('null / undefined / 未知值都兜底到 au，不返回 undefined', () => {
    expect(locationCodeFor(null)).toBe(2036)
    expect(locationCodeFor(undefined)).toBe(2036)
    expect(locationCodeFor('xx')).toBe(2036)
  })
})
