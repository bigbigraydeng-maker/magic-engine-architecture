/**
 * FacebookPagePanel — 绑定值不在可选列表里时不许谎报「没绑」。
 *
 * 2026-09-03 NewAsian Logistics 实测踩到：主页 1177479655430100 已经存进
 * clients.facebook_page_id，但 ME 当时的令牌只列得出 Oztop / Roman Hu 两个主页。
 * <select value={draft}> 的 value 匹配不到任何 <option>，浏览器回退显示第一项
 * 「— 不接私信 —」。屏幕于是同时出现两句自相矛盾的话：上面红字「绑了主页，但
 * 线索进不来」，下面下拉框「不接私信」。
 *
 * 危害不止是显示错。draft 仍等于 page_id，所以 dirty=false、保存键灰着，人想改
 * 都改不了；而他只要在下拉框里随手动一下，onChange 就会把 draft 换成别的客户的
 * 主页 ID（或空），保存键亮起 —— 一次「确认一下当前设置」的动作，实际是把这个
 * 客户静默改绑到别人的主页或直接解绑。ME 读不到某个主页恰恰是最常见的状态
 * （见 reachable=false 那条红字存在的理由），所以这不是边角情况。
 */
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { FacebookPagePanel } from '../FacebookPagePanel'

const CLIENT_ID = '06ca17c2-5b4e-414a-b749-ea9eadff415c'
const BOUND_PAGE = '1177479655430100'

/** ME 的令牌列得出来的主页 —— 注意都不是当前绑定的那个。 */
const OTHER_PAGES = [
  { id: '748077268383005', name: 'Oztop Building Supplies Pty Ltd' },
  { id: '227633594573276', name: 'Roman Hu Real Estate' },
]

function mockGet(payload: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => payload,
    })) as unknown as typeof fetch,
  )
}

beforeEach(() => {
  // ConnectMeta 会读 window.location 上的 ?meta=，jsdom 默认给的就够用。
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FacebookPagePanel — 绑定值不在列表里', () => {
  it('仍然把当前绑定显示出来，而不是回退成「不接私信」', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement

    // 这是核心断言：下拉框选中的必须是那个已经绑好的主页。
    // 修复前这里是 ''（value 匹配不到 option，浏览器落到第一项「不接私信」）。
    expect(select.value).toBe(BOUND_PAGE)
  })

  it('那一项要讲明「ME 读不到」，不能让人以为一切正常', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    await screen.findByRole('combobox')

    const opt = screen.getByRole('option', { name: /当前绑定/ }) as HTMLOptionElement
    expect(opt.value).toBe(BOUND_PAGE)
    // 「读不到」必须写在这一项上；只靠上面那条红字，滚动后就看不见了。
    expect(opt.textContent).toMatch(/读不到/)
  })

  it('绑定值在列表里时，不额外插入「当前绑定」项', async () => {
    mockGet({
      page_id: OTHER_PAGES[0].id,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: true,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement

    expect(select.value).toBe(OTHER_PAGES[0].id)
    expect(screen.queryByRole('option', { name: /当前绑定/ })).toBeNull()
    // 「不接私信」+ 两个真主页 = 3 项，没有多出来的。
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('没绑主页时保持原样：选中「不接私信」', async () => {
    mockGet({
      page_id: null,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: null,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement

    expect(select.value).toBe('')
    expect(screen.queryByRole('option', { name: /当前绑定/ })).toBeNull()
  })
})

describe('FacebookPagePanel — 授权失败的原因要说全', () => {
  it('page_not_granted 要提「应用没加进客户的商务组合」这条真实原因', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    // callback 把结论放在 URL 上，组件读一次就抹掉。
    window.history.replaceState({}, '', `/dashboard/clients/${CLIENT_ID}?meta=page_not_granted`)

    render(<FacebookPagePanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      const body = document.body.textContent ?? ''
      // 2026-09-03 实测：主页 ID 是对的、账号在 Business Suite 里也看得到该主页，
      // 真因是客户的商务组合里没添加 Magic Engine 这个应用。旧文案只说「换账号 /
      // 查 ID」，把人引向两条死路 —— 我自己就先按它查了一轮才发现方向错了。
      expect(body).toMatch(/商务组合|应用/)
    })
  })
})
