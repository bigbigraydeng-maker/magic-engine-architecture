/**
 * 画册默认内容由行程单长出来 —— 顾问打开就是一份能看的稿子，活是「改」不是「写」。
 *
 * 这里的用例大多来自库里真实的报价单：编出来的行程太规整，
 * 遮住的恰恰是真实数据里那些会出事的写法。
 */

import { describe, it, expect } from 'vitest'
import { createBrochureFromItinerary } from '../brochure-seed'
import { HERO_PREFIX } from '../brochure-types'
import { createBlankItinerary, type TailorMadeDay, type TailorMadeItinerary } from '../types'

function build(route: string[], days: Partial<TailorMadeDay>[]): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0024')
  it.trip.title = 'China Signature — China Panorama'
  it.trip.route = route
  it.trip.summary = 'The ultimate 27-day China experience.'
  it.days = days.map((d, i) => ({
    day: d.day ?? i + 1,
    date: '', weekday: '',
    route: d.route ?? '',
    body: d.body ?? '',
    travel: d.travel ?? '',
    accommodation: d.accommodation ?? '',
    meals: '',
  }))
  return it
}

describe('createBrochureFromItinerary', () => {
  /**
   * CTS-2026-0024 真实数据：第 1 天写的是 "Auckland → Shanghai"，
   * 而上海是这条 12 城路线的**最后**一站。
   *
   * 「提到哪个城市就归哪个」会把这天归给上海，上海那页于是标成「第 01–27 天」——
   * 一份发给付费客户的文件上，这种错读起来还挺合理，最难被发现。
   */
  it('转机途经的城市不算到站', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing', "Xi'an", 'Shanghai'], [
        { day: 1, route: 'Auckland → Shanghai', body: 'Depart Auckland.' },
        { day: 2, route: 'Shanghai → Beijing', body: 'Fly on to Beijing.' },
        { day: 3, route: 'Beijing', body: 'The Great Wall at Mutianyu, a long day on the wall.' },
        { day: 4, route: "Beijing → Xi'an", body: 'High-speed train south.' },
        { day: 5, route: "Xi'an", body: 'The Terracotta Warriors.' },
        { day: 6, route: "Xi'an → Shanghai", body: 'Fly to Shanghai.' },
        { day: 7, route: 'Shanghai', body: 'The Bund and Yu Garden.' },
      ])
    )

    const [beijing, xian, shanghai] = brochure.cities
    expect(beijing.days).toBe('DAYS 02 – 03')
    expect(xian.days).toBe('DAYS 04 – 05')
    // 关键：上海是第 06–07 天，不是第 01–07 天
    expect(shanghai.days).toBe('DAYS 06 – 07')
  })

  it('每个城市正文最长的那天升为整版大图页，其余成卡片', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [
        { day: 1, route: 'Beijing', body: 'Short.' },
        { day: 2, route: 'Beijing', body: 'A much longer description of the Great Wall at Mutianyu.' },
        { day: 3, route: 'Beijing', body: 'Middle length one about the Forbidden City.' },
      ])
    )

    const beijing = brochure.cities[0]
    expect(beijing.hero.body).toContain('Mutianyu')
    expect(beijing.blocks).toHaveLength(2)
    expect(beijing.blocks.map((b) => b.body)).not.toContain(beijing.hero.body)
  })

  it('正文为空的天不生成空卡片', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [
        { day: 1, route: 'Beijing', body: 'Something to say.' },
        { day: 2, route: 'Beijing', body: '' },
        { day: 3, route: 'Beijing', body: '   ' },
      ])
    )
    expect(brochure.cities[0].blocks).toHaveLength(0)
  })

  it('大图按城市自动选，存的是名字不是几百 KB 的图', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing', 'Chongqing'], [
        { day: 1, route: 'Beijing', body: 'x' },
        { day: 2, route: 'Chongqing', body: 'y' },
      ])
    )
    expect(brochure.cities[0].hero.image).toBe(`${HERO_PREFIX}beijing`)
    expect(brochure.cities[1].hero.image).toBe(`${HERO_PREFIX}chongqing`)
    expect(brochure.cover.image.startsWith(HERO_PREFIX)).toBe(true)
    // 整份画册应该还是很小的一段 JSON
    expect(JSON.stringify(brochure).length).toBeLessThan(20_000)
  })

  it('照抄行程单原文，不替顾问编造介绍', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [{ day: 1, route: 'Beijing', body: 'Visit Tian\'anmen Square.' }])
    )
    expect(brochure.overview.intro).toBe('The ultimate 27-day China experience.')
    expect(brochure.cities[0].hero.body).toBe("Visit Tian'anmen Square.")
    // 行程单没写的一律留空，不能出现系统脑补的句子
    expect(brochure.overview.note.title).toBe('')
    expect(brochure.overview.note.body).toBe('')
  })

  it('行程单一天都还没填时不炸，给出空城市页', () => {
    const brochure = createBrochureFromItinerary(build(['Beijing', "Xi'an"], []))
    expect(brochure.cities).toHaveLength(2)
    expect(brochure.cities[0].blocks).toEqual([])
    expect(brochure.cities[0].days).toBe('')
  })
})
