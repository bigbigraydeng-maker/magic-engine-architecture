/**
 * 运行配置判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 **这个文件是变异验证逼出来的。** 这些判据原本写在脚本里，拆掉之后测试套件 0 条红
 *    —— 也就是整个维度零覆盖。搬进 lib 才测得到。
 */

import { describe, expect, it } from 'vitest'
import { buildOwnedDomainPolicy, GeoConfigError, optionalNumber, requireNumber, requireString } from '../config'

describe('自有域名「已核实」的来源（R10 / GEO 契约 M8）', () => {
  it('🔴 没有独立背书 ⇒ verified 必须为 false，哪怕清单填得满满的', () => {
    const policy = buildOwnedDomainPolicy({
      domainsCsv: 'example.com, alias.example.co.nz',
      verifiedBy: undefined,
    })
    expect(policy.verified).toBe(false)
    // 清单照样带着（给人看），但每条引用会被记成「未知」而不是 false。
    expect(policy.verifiedDomains).toEqual(['example.com', 'alias.example.co.nz'])
  })

  it('空字符串背书也不算背书', () => {
    expect(buildOwnedDomainPolicy({ domainsCsv: 'a.com', verifiedBy: '   ' }).verified).toBe(false)
  })

  it('有独立背书 + 非空清单 ⇒ verified 为 true', () => {
    const policy = buildOwnedDomainPolicy({ domainsCsv: 'a.com', verifiedBy: 'pm@example.com 2026-08-12' })
    expect(policy.verified).toBe(true)
  })

  it('背书了一份空清单 ⇒ 拒（核实一份空清单没有意义）', () => {
    expect(() => buildOwnedDomainPolicy({ domainsCsv: '', verifiedBy: 'pm' })).toThrow(GeoConfigError)
  })

  it('清单去空项、去空白', () => {
    const policy = buildOwnedDomainPolicy({ domainsCsv: ' a.com , , b.com ,', verifiedBy: 'pm' })
    expect(policy.verifiedDomains).toEqual(['a.com', 'b.com'])
  })
})

describe('数值环境变量必须验有限（Number("60s") 是 NaN，?? 拦不住）', () => {
  it('requireNumber 拒 NaN', () => {
    expect(() => requireNumber('GEO_TIMEOUT_MS', '60s')).toThrow(/不是一个有限数字/)
  })

  it('requireNumber 拒 Infinity', () => {
    expect(() => requireNumber('X', 'Infinity')).toThrow(/不是一个有限数字/)
  })

  it('🔴 价格填 0 必须被拒 —— 否则每次调用都算 $0，预算闸从此形同虚设', () => {
    expect(() => requireNumber('GEO_PRICE_INPUT_PER_M', '0', { positive: true })).toThrow(/必须大于 0/)
  })

  it('负数同样被拒', () => {
    expect(() => requireNumber('GEO_BUDGET_USD', '-1', { positive: true })).toThrow(/必须大于 0/)
  })

  it('optionalNumber 没填就用兜底', () => {
    expect(optionalNumber('GEO_TIMEOUT_MS', undefined, 60_000)).toBe(60_000)
    expect(optionalNumber('GEO_TIMEOUT_MS', '  ', 60_000)).toBe(60_000)
  })

  it('🔴 optionalNumber 填了就必须是有限正数 —— setTimeout(fn, NaN) 会被当成 1ms 立刻中止', () => {
    expect(() => optionalNumber('GEO_TIMEOUT_MS', '60s', 60_000)).toThrow(/必须是一个大于 0 的有限数字/)
    expect(() => optionalNumber('GEO_TIMEOUT_MS', '0', 60_000)).toThrow(/必须是一个大于 0 的有限数字/)
  })
})

describe('必填项', () => {
  it('缺值 / 全空白都算没填', () => {
    expect(() => requireString('GEO_CLIENT_ID', undefined)).toThrow(/缺环境变量/)
    expect(() => requireString('GEO_CLIENT_ID', '   ')).toThrow(/缺环境变量/)
  })

  it('两端空白被裁掉', () => {
    expect(requireString('X', '  v1  ')).toBe('v1')
  })
})
