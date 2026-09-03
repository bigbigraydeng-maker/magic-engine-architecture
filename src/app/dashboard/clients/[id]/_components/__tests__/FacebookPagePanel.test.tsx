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
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
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

/**
 * 魏征复审（2026-09-03）打出来的盲区：上面那批只断言「渲染成什么样」，
 * 交互一条没测。他做的变异证明了这有多空 —— 把 `value={draft}` 换成
 * `value={page_id}`（下拉框彻底失效、选了不生效）5 个测试全绿；把保存键的
 * dirty 闸门整个拿掉，也是 5 个全绿。而 commit message 通篇在讲「保存键灰着
 * 人想改都改不了」「动一下下拉框就静默改绑」—— 那两句话当时没有任何测试盯着。
 */
describe('FacebookPagePanel — 交互（不是只看渲染）', () => {
  it('下拉框选了就得生效 —— 锁住 value 必须绑 draft', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement

    fireEvent.change(select, { target: { value: OTHER_PAGES[1].id } })

    // value 若绑在 page_id 上，这里会顽固地停在原绑定 —— 用户选了个寂寞。
    expect(select.value).toBe(OTHER_PAGES[1].id)
  })

  it('没改动时保存键必须是灰的 —— 锁住 dirty 闸门', async () => {
    mockGet({
      page_id: OTHER_PAGES[0].id,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: true,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    await screen.findByRole('combobox')

    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: OTHER_PAGES[1].id } })
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
  })

  /**
   * 魏征「必改 1」：第一版修复只盖住了一半。
   *
   * 新 <option> 当时挂在 page_id（已保存值）上，而 <select value={draft}> 绑的是
   * draft（待保存值）。手填路径上这两者会分叉：绑定在列表外 → 点「手动填 ID」→
   * 填一个**新的**列表外 ID → 点「回到主页列表」。draft 匹配不到任何 option，
   * 屏幕又回到「— 不接私信 —」，而这次 dirty=true、保存键是**亮的** ——
   * 按下去真的会把这个值存进去。比原 bug 更危险：原 bug 至少存不进去。
   */
  it('手填一个列表外的新 ID 再切回列表模式，不许又变回「不接私信」', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: null,
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    render(<FacebookPagePanel clientId={CLIENT_ID} />)
    await screen.findByRole('combobox')

    fireEvent.click(screen.getByRole('button', { name: /手动填 ID/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '999999999999' } })
    fireEvent.click(screen.getByRole('button', { name: /回到主页列表/ }))

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('999999999999')
    // 而且要讲明这是「还没保存的」，不能跟已生效的绑定混为一谈。
    expect(screen.getByRole('option', { selected: true }).textContent).toMatch(/待保存/)
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
      //
      // 魏征复审：原来这里只断言 /商务组合|应用/，太松 —— 把整段换成 no_pages
      // 的文案照样全绿，锁不住「显示的是不是该显示的那条」。改断言本条独有的短语。
      expect(body).toMatch(/没把这个主页交给我们/)
      expect(body).toMatch(/页面访问权限/)
    })
  })

  it('publishing 那条分支要指回视频工厂配置，不能一律指去客户后台', async () => {
    mockGet({
      page_id: BOUND_PAGE,
      publish_target_page_id: '748077268383005',
      pages: OTHER_PAGES,
      pages_error: null,
      reachable: false,
    })

    window.history.replaceState({}, '', `/dashboard/clients/${CLIENT_ID}?meta=page_not_granted`)
    render(<FacebookPagePanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      // 魏征「必改 3」：intent=publishing 时 targetPageId 来自
      // factory_config.publish_target，不是本面板绑的主页，本面板也不给编辑它。
      // 这时候把人指去「客户的 Business 设置」是指错门。
      //
      // ⚠ 断言必须挑这条错误提示**独有**的话。第一版写的是 /视频工厂配置/，
      // 结果没改文案就绿了 —— 面板底部那段常驻说明里本来就有这四个字，
      // 断言抓到的是它，跟错误提示没关系。这正是魏征批评的「断言太松」，
      // 我在同一轮里又犯了一次。
      expect(document.body.textContent ?? '').toMatch(/它认的根本不是这里绑的主页/)
    })
  })
})
