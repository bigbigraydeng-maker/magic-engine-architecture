/**
 * 画册是发给终端客户的文件，两类错误代价最高：
 *  1. 客户名/城市与行程单对不上 —— 同一个人收到两份说法不一样的文件；
 *  2. CC 授权图漏了署名 —— 这是许可违约，不是排版瑕疵。
 * 下面的用例盯的就是这两件事，外加注入模板时的转义（顾问填的字段可以是任意文本）。
 */

import { describe, it, expect } from 'vitest'
import {
  buildCreditLine,
  createBlankBrochure,
  isBrochureCard,
  blankBrochureCard,
  blankBrochureNote,
} from '../brochure-types'
import { renderBrochureHtml } from '../brochure-render'
import { injectData } from '../template-html'
import { createBlankItinerary } from '../types'

function itineraryWithRoute(route: string[]) {
  const it = createBlankItinerary('CTS-2026-0010')
  it.trip.route = route
  it.trip.title = 'China Icons Collection'
  it.trip.dateRange = '1 Nov – 15 Nov'
  it.client.name = 'Jazz & Family'
  it.client.travellers = '5 passengers'
  return it
}

describe('createBlankBrochure', () => {
  it('城市顺序完全跟随行程单', () => {
    const brochure = createBlankBrochure(itineraryWithRoute(['Beijing', "Xi'an", 'Chongqing', 'Shanghai']))
    expect(brochure.cities.map((c) => c.name)).toEqual(['Beijing', "Xi'an", 'Chongqing', 'Shanghai'])
    expect(brochure.cover.cities).toEqual(['BEIJING', "XI'AN", 'CHONGQING', 'SHANGHAI'])
  })

  it('丢掉行程单里的空城市，不生成空白城市页', () => {
    const brochure = createBlankBrochure(itineraryWithRoute(['Beijing', '   ', '']))
    expect(brochure.cities).toHaveLength(1)
  })

  it('继承标题和日期，但不替顾问编造任何介绍文字', () => {
    const brochure = createBlankBrochure(itineraryWithRoute(['Beijing']))
    expect(brochure.cover.title).toBe('China Icons Collection')
    expect(brochure.cover.meta.find((m) => m.label === 'DEPARTS')?.value).toBe('1 Nov – 15 Nov')
    // 空白画册不能带任何看起来已经写好的成品文案
    expect(brochure.overview.intro).toBe('')
    expect(brochure.cities[0].hero.body).toBe('')
    expect(brochure.cities[0].blocks).toEqual([])
  })
})

describe('renderBrochureHtml', () => {
  /**
   * CTS-2026-0025（真实报价单）：4 城 15 天，画册最常见的形态。
   */
  it('渲染出每个城市的开篇页，并把封面收件人接上', async () => {
    const brochure = createBlankBrochure(itineraryWithRoute(['Beijing', "Xi'an", 'Chongqing', 'Shanghai']))
    const html = await renderBrochureHtml(brochure, {
      preparedFor: 'Jazz & Family',
      quoteRef: 'CTS-2026-0010',
    })

    for (const city of ['Beijing', "Xi'an", 'Chongqing', 'Shanghai']) {
      expect(html).toContain(city)
    }
    // 注入的是 JSON 数据，HTML 转义由模板在浏览器端做，所以这里看到的是原文
    expect(html).toContain('Jazz & Family')
    expect(html).toContain('CTS-2026-0010')
  })

  /**
   * CTS-2026-0024（真实报价单）：27 天 12 城。页数由内容决定，模板里没有任何
   * 「最多几个城市」的上限 —— 真有人卖这种行程，排不下就是当场翻车。
   */
  it('撑得住 27 天 12 城的行程', async () => {
    const route = ['Beijing', "Xi'an", 'Yichang', 'Chongqing', 'Chengdu', 'Dali',
                   'Kunming', 'Guilin', 'Yangshuo', 'Hangzhou', 'Suzhou', 'Shanghai']
    const brochure = createBlankBrochure(itineraryWithRoute(route))
    expect(brochure.cities).toHaveLength(12)

    const html = await renderBrochureHtml(brochure, { preparedFor: 'A', quoteRef: 'CTS-2026-0024' })
    for (const city of route) expect(html).toContain(city)
  })

  it('缺 logo 也照样出稿，不让顾问点了预览只看到报错', async () => {
    const brochure = createBlankBrochure(itineraryWithRoute(['Beijing']))
    const html = await renderBrochureHtml(brochure, { preparedFor: '', quoteRef: '' })
    expect(html).toContain('__DATA_END__')
  })
})

describe('buildCreditLine', () => {
  it('列出每一位摄影师', () => {
    const line = buildCreditLine([
      { author: 'David290', license: 'CC BY-SA 4.0' },
      { author: 'Nyx Ning', license: 'CC BY-SA 3.0' },
    ])
    expect(line).toContain('David290')
    expect(line).toContain('Nyx Ning')
  })

  it('同一位摄影师供多张图时只署名一次', () => {
    const line = buildCreditLine([
      { author: 'David290', license: 'CC BY-SA 4.0' },
      { author: 'David290', license: 'CC BY-SA 4.0' },
    ])
    expect(line.match(/David290/g)).toHaveLength(1)
  })

  it('没有需要署名的图时不留下半句空话', () => {
    expect(buildCreditLine([])).toBe('')
    expect(buildCreditLine([{ author: '   ', license: 'CC0' }])).toBe('')
  })
})

describe('isBrochureCard', () => {
  it('把景点卡片和说明面板分开 —— 模板靠它决定要不要渲染图片位', () => {
    expect(isBrochureCard(blankBrochureCard())).toBe(true)
    expect(isBrochureCard(blankBrochureNote())).toBe(false)
  })
})

describe('injectData', () => {
  const template = `<script>const D = /*__DATA_START__*/{}/*__DATA_END__*/;</script>`

  it('转义 </script>，否则顾问填的一段文字就能提前关掉脚本标签', () => {
    const html = injectData(template, { body: 'closing </script> tag' })
    expect(html).not.toContain('</script> tag')
    expect(html).toContain('<\\/script>')
  })

  it('转义 U+2028 / U+2029 —— 从 Word 粘贴过来的文本常带这两个字符', () => {
    const html = injectData(template, { body: 'a\u2028b\u2029c' })
    expect(html).toContain('\\u2028')
    expect(html).toContain('\\u2029')
    expect(html).not.toContain(String.fromCharCode(0x2028))
  })

  it('注入后仍是能解析回原值的 JSON', () => {
    const data = { title: 'Xi\'an & "quotes"', n: 3 }
    const html = injectData(template, data)
    const json = html.slice(
      html.indexOf('/*__DATA_START__*/') + '/*__DATA_START__*/'.length,
      html.indexOf('/*__DATA_END__*/')
    )
    expect(JSON.parse(json)).toEqual(data)
  })
})
