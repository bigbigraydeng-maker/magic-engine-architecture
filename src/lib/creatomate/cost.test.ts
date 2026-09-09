import { describe, it, expect } from 'vitest'
import { creditsForVideo, creditsForImage, creditsToUsd, USD_PER_CREDIT } from './cost'

// 魏征复审实测抓出：v1 spec 直接抄了官方文档自己没取整的示例数字(37.3)。
// 这里锁死取整行为，防止回归。
describe('creditsForVideo', () => {
  it('1080x1920 @30fps 30秒 → 19（官方公式 18.6624 向上取整）', () => {
    expect(creditsForVideo(1080, 1920, 30, 30)).toBe(19)
  })

  it('1080x1920 @30fps 60秒 → 38（37.3248 向上取整，不是官方文档自己写的 37.3）', () => {
    expect(creditsForVideo(1080, 1920, 30, 60)).toBe(38)
  })

  it('整除时不多算一个 credit', () => {
    // 100,000,000 ÷ 100,000,000 = 1，恰好整除
    expect(creditsForVideo(10000, 10000, 1, 1)).toBe(1)
  })
})

describe('creditsForImage', () => {
  it('固定 1 credit', () => {
    expect(creditsForImage()).toBe(1)
  })
})

describe('creditsToUsd', () => {
  it('$54/月 ÷ 2000 credits/月 = $0.027/credit', () => {
    expect(USD_PER_CREDIT).toBeCloseTo(0.027, 5)
  })

  it('19 credits ≈ $0.513', () => {
    expect(creditsToUsd(19)).toBeCloseTo(0.513, 3)
  })
})
