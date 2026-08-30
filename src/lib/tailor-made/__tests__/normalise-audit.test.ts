/**
 * CTS-2026-0025 是一份**已经发给客户**的行程单，上面有两处空白：
 *   - 价格旁「Costs to allow for」两行只有名目没有金额
 *   - 第 2 页的「TRAVELLING」整格空白
 *
 * 两处都不是手滑，是字段形状对不上：抽取端写 { label, amount, currency, note }，
 * 模板取 o.value；client.travellers 存 "5"，facts 里的 Travelling 没人填。
 * 而模板对缺字段的反应是渲染成空字符串 —— 不报错、不留痕。
 *
 * 下面第一组用例锁住「翻译得过来」，第二组锁住「翻译不过来时要喊出来」。
 */

import { describe, it, expect } from 'vitest'
import { normaliseItinerary } from '../normalise'
import { auditItinerary, auditSummary } from '../audit'
import { createBlankItinerary, type TailorMadeItinerary } from '../types'

/** 复刻线上那份的关键形状 */
function asShipped(): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0025')
  it.trip.title = '50 & Fabulous: A Family Journey Through China'
  it.client = { name: 'Jazz Masau-Samuelu', travellers: '5' }
  it.pricing.amount = 4988
  it.pricing.basis = 'Land only, per person'
  // 抽取端真实写出来的形状 —— 没有 value
  it.pricing.optional = [
    { label: 'Chongqing to Shanghai domestic airfare (estimate)', amount: 650, currency: 'NZD', note: 'Per person' },
    { label: 'Tips for guides and drivers', amount: 15, currency: 'NZD', note: 'Per person per day' },
  ] as unknown as TailorMadeItinerary['pricing']['optional']
  return it
}

describe('normaliseItinerary', () => {
  it('把 {amount, currency, note} 翻成模板要的 value', () => {
    const out = normaliseItinerary(asShipped())
    expect(out.pricing.optional[0].value).toBe('NZD 650 · Per person')
    expect(out.pricing.optional[1].value).toBe('NZD 15 · Per person per day')
  })

  it('已经有 value 的不动它', () => {
    const it = asShipped()
    it.pricing.optional = [{ label: '接送', value: '含在团费内' }]
    expect(normaliseItinerary(it).pricing.optional[0].value).toBe('含在团费内')
  })

  it('"5" 补成 "5 passengers"，并填进空着的 Travelling 那格', () => {
    const out = normaliseItinerary(asShipped())
    expect(out.client.travellers).toBe('5 passengers')
    expect(out.trip.facts.find((f) => f.label === 'Travelling')?.value).toBe('5 passengers')
  })

  it('顾问自己写了单位就照他的写法，不改成 "2 passengers"', () => {
    const it = asShipped()
    it.client.travellers = '2 adults, twin share'
    expect(normaliseItinerary(it).client.travellers).toBe('2 adults, twin share')
  })

  it('Travelling 已经有值时不覆盖', () => {
    const it = asShipped()
    const fact = it.trip.facts.find((f) => f.label === 'Travelling')!
    fact.value = '5 passengers (2 rooms)'
    expect(normaliseItinerary(it).trip.facts.find((f) => f.label === 'Travelling')?.value)
      .toBe('5 passengers (2 rooms)')
  })

  it('金额缺失时不编一个出来 —— 留空交给体检去报', () => {
    const it = asShipped()
    it.pricing.optional = [{ label: '某项费用' }] as unknown as TailorMadeItinerary['pricing']['optional']
    expect(normaliseItinerary(it).pricing.optional[0].value).toBe('')
  })

  it('不改原对象', () => {
    const it = asShipped()
    normaliseItinerary(it)
    expect(it.client.travellers).toBe('5')
  })
})

describe('auditItinerary', () => {
  it('归一化能补上的不再报警 —— 否则顾问会看到一堆假警报', () => {
    const findings = auditItinerary(asShipped())
    expect(findings.some((f) => f.where.includes('Travelling'))).toBe(false)
    expect(findings.some((f) => f.where.includes('Costs to allow for'))).toBe(false)
  })

  it('只有名目没有金额时报 blocker —— 客户会看到一行空白', () => {
    const it = asShipped()
    it.pricing.optional = [{ label: '某项费用' }] as unknown as TailorMadeItinerary['pricing']['optional']
    const hit = auditItinerary(it).find((f) => f.where.includes('某项费用'))
    expect(hit?.level).toBe('blocker')
  })

  it('空白天报 blocker', () => {
    const it = asShipped()
    it.days = [
      { day: 1, date: '', weekday: '', route: 'Beijing', body: '有内容', accommodation: 'H' },
      { day: 2, date: '', weekday: '', route: 'Beijing', body: '   ', accommodation: 'H' },
    ]
    const hit = auditItinerary(it).find((f) => f.where.startsWith('第 2 天') && f.where.includes('正文'))
    expect(hit?.level).toBe('blocker')
  })

  it('最后一天没写住宿不报 —— 当天离境本来就没有住宿', () => {
    const it = asShipped()
    it.days = [
      { day: 1, date: '', weekday: '', route: 'Beijing', body: 'x', accommodation: 'H' },
      { day: 2, date: '', weekday: '', route: 'Depart', body: 'y', accommodation: '' },
    ]
    expect(auditItinerary(it).some((f) => f.where.startsWith('第 2 天') && f.where.includes('住宿'))).toBe(false)
  })

  it('中间某天漏住宿要报 —— 其余天都有，这天多半是漏了', () => {
    const it = asShipped()
    it.days = [
      { day: 1, date: '', weekday: '', route: 'Beijing', body: 'x', accommodation: 'H' },
      { day: 2, date: '', weekday: '', route: 'Beijing', body: 'y', accommodation: '' },
      { day: 3, date: '', weekday: '', route: 'Depart', body: 'z', accommodation: '' },
    ]
    const hit = auditItinerary(it).find((f) => f.where.startsWith('第 2 天') && f.where.includes('住宿'))
    expect(hit?.level).toBe('warn')
  })

  it('客户名空着是 blocker，客户一眼看得出不对', () => {
    const levels = auditItinerary(createBlankItinerary('CTS-2026-0099'))
    expect(levels.find((f) => f.where.includes('Prepared for'))?.level).toBe('blocker')
  })

  it('新建的空白行程单自带「另行报价」说明，价格不该报警', () => {
    // createBlankItinerary 预填了 amountNote —— 报价还没定不等于漏填
    expect(auditItinerary(createBlankItinerary('CTS-2026-0099')).some((f) => f.where === '价格')).toBe(false)
  })

  it('金额和说明都空才报价格 blocker', () => {
    const it = createBlankItinerary('CTS-2026-0099')
    it.pricing.amountNote = ''
    expect(auditItinerary(it).find((f) => f.where === '价格')?.level).toBe('blocker')
  })

  it('有 amountNote 时不算价格空', () => {
    const it = asShipped()
    it.pricing.amount = null
    it.pricing.amountNote = 'Quotation issued separately'
    expect(auditItinerary(it).some((f) => f.where === '价格')).toBe(false)
  })
})

describe('auditSummary', () => {
  it('没问题时说清楚', () => {
    expect(auditSummary([])).toBe('没有空字段')
  })

  it('把「该补」和「建议补」分开讲 —— 全报成红色等于没有分级', () => {
    const s = auditSummary([
      { level: 'blocker', where: 'a', what: 'x' },
      { level: 'warn', where: 'b', what: 'y' },
    ])
    expect(s).toContain('1 处该补上再发')
    expect(s).toContain('1 处建议')
  })
})
