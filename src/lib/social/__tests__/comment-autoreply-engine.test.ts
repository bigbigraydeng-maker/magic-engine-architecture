/**
 * 这个帖子是不是我们自己主页的。
 *
 * 广告账户里会混进别人主页的素材（老广告 / 合作方主页）。用本主页的 token 去读
 * 它们，Meta 一律回 #10 —— 那不是我们缺权限，把它算进「缺权限」会把 FDE 支去
 * Meta 后台白找一圈。
 */

import { describe, it, expect } from 'vitest'
import { belongsToPage } from '../comment-autoreply-engine'

const CTS_PAGE = '1616575215312482'

describe('belongsToPage', () => {
  it('本主页的帖子（`<主页id>_<帖子id>`）算自己的', () => {
    expect(belongsToPage(`${CTS_PAGE}_1672828167982705`, CTS_PAGE)).toBe(true)
  })

  it('🔴 别人主页的素材不算 —— 它读不了不是权限问题', () => {
    expect(belongsToPage('999999999_1672828167982705', CTS_PAGE)).toBe(false)
  })

  it('Reels / 视频是裸 id，只可能来自本主页的接口，算自己的', () => {
    expect(belongsToPage('1234567890', CTS_PAGE)).toBe(true)
  })

  it('前缀只是「开头像」不算 —— 必须整段主页 ID 加下划线', () => {
    expect(belongsToPage(`${CTS_PAGE}00_123`, CTS_PAGE)).toBe(false)
  })
})
