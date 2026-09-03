import { describe, it, expect } from 'vitest'
import { verifyPlaceProvenance, classifyRenderMode } from './shot-guards'

// 测试样本 = 2026-09-04 CTS 圣诞 reel 真出过的错。这两道闸的存在意义就是当时拦住它们。

describe('verifyPlaceProvenance', () => {
  it('🔴 拦住"搜索词命中但内容不符"——那座冒充西安的临水塔', () => {
    // 用 "Xian Bell Tower" 搜到，但摄影师描述里没有西安
    const r = verifyPlaceProvenance('a tall pagoda illuminated at night', ['xian', "xi'an", 'shaanxi'])
    expect(r.ok).toBe(false)
    expect(r.matchedKeyword).toBeNull()
  })

  it('🔴 拦住爱丁堡圣诞市集冒充中国', () => {
    const r = verifyPlaceProvenance('christmas in edinburgh', ['china', 'shanghai', 'beijing'])
    expect(r.ok).toBe(false)
  })

  it('放行来源确实指名地点的图（真西安街景）', () => {
    const r = verifyPlaceProvenance('busy city street with xi\'an bell tower in distance', ['xian', "xi'an"])
    expect(r.ok).toBe(true)
    // 描述里是带撇号的 "xi'an"，不含子串 "xian"，所以命中的是第二个关键词
    expect(r.matchedKeyword).toBe("xi'an")
  })

  it('放行兵马俑（来源明确写了 terracotta）', () => {
    const r = verifyPlaceProvenance(
      'terracotta warriors army of emperor qin shi huang, the first emperor of china',
      ['terracotta', 'xian'],
    )
    expect(r.ok).toBe(true)
    expect(r.matchedKeyword).toBe('terracotta')
  })

  it('来源无任何文字 → 判不合格（宁可不打地名）', () => {
    const r = verifyPlaceProvenance('   ', ['shanghai'])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('无任何文字')
  })

  it('大小写 / 关键词首尾空格都不影响匹配', () => {
    expect(verifyPlaceProvenance('Night of SHANGHAI from the Bund', ['  shanghai  ']).ok).toBe(true)
  })
})

describe('classifyRenderMode', () => {
  it('🔴 兵马俑（密集人脸）→ 真实像素，不送 i2v', () => {
    const r = classifyRenderMode('rows of terracotta warriors, each with a unique face')
    expect(r.mode).toBe('real_pixel')
    expect(r.riskSignals).toEqual(expect.arrayContaining(['warriors']))
  })

  it('🔴 西安街头（招牌+真人）→ 真实像素', () => {
    const r = classifyRenderMode('busy night street food market with shopfront signs and pedestrians')
    expect(r.mode).toBe('real_pixel')
  })

  it('🔴 重庆楼体中文字 → 真实像素', () => {
    const r = classifyRenderMode('city skyline tower with chinese characters 重庆你好 lit on the building')
    expect(r.mode).toBe('real_pixel')
  })

  it('长城空镜（无文字/人脸）→ 可 i2v', () => {
    const r = classifyRenderMode('misty great wall of china running over a snow-covered ridge')
    expect(r.mode).toBe('i2v')
    expect(r.riskSignals).toEqual([])
  })

  it('水乡运河（有船无人脸无字）→ 可 i2v', () => {
    const r = classifyRenderMode('traditional chinese water town canal with wooden boats and lanterns')
    expect(r.mode).toBe('i2v')
  })

  it('夜景天际线 → 可 i2v', () => {
    const r = classifyRenderMode('illuminated riverfront skyline at night, lights on the water')
    expect(r.mode).toBe('i2v')
  })

  it('不被 design/shopping 之类假朋友误伤（词边界匹配）', () => {
    // "designed" 含 "sign"，"shopping" 含 "shop" —— 不该触发
    const r = classifyRenderMode('a beautifully designed modern building, shopping district skyline')
    expect(r.riskSignals).not.toEqual(expect.arrayContaining(['sign']))
    expect(r.mode).toBe('i2v')
  })
})
