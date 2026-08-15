/**
 * 卡片上那个「打电话时顺手记一行」的输入框。
 *
 * 这里钉的都是**只有真按键盘才暴露得出来**的东西 —— 纯函数测不到：
 *   · 打中文时按回车**选字**，绝不能当成提交
 *   · 回车提交、Shift+回车换行、Esc 收起
 *   · 存完那句确认要说出下一步排在哪天（服务端给哪个时区就按哪个说）
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickNote } from '../QuickNote'

const okResponse = (body: Record<string, unknown>) =>
  ({ ok: true, json: async () => ({ created: true, ...body }) }) as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse({ parsed: { callback_at: null } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const setup = () => {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  render(<QuickNote clientId="cts" contactId="c1" onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel, box: screen.getByRole('textbox') }
}

describe('打中文的时候按回车是在选字，不是要提交', () => {
  /**
   * 🔴 CTS 的销售打中文：敲拼音 → 候选框弹出来 → **按回车选字**。
   * 那一下的按键事件同样是 Enter，但浏览器会把 `isComposing` 置成 true。
   *
   * 不挡的话，笔记会在**只打了半句**的时候存下去、输入框当场收起 ——
   * 而且他多半不会重打一遍，那半句就成了这个客人的全部记录。
   */
  it('选字的那一下回车：不提交、不收起', async () => {
    const { onDone, onCancel, box } = setup()
    await userEvent.type(box, '三月两个人去南岛')

    // 模拟输入法候选状态下的回车。
    // `isComposing` 是只读的 getter，改不了 —— 用 defineProperty 盖上去，
    // 跟浏览器在合成期间给出的事件形状一致。
    const enterWhileComposing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(enterWhileComposing, 'isComposing', { value: true })
    box.dispatchEvent(enterWhileComposing)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('选完字之后再按回车：正常提交', async () => {
    const { box } = setup()
    await userEvent.type(box, '三月两个人去南岛{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})

describe('一只手也能用', () => {
  it('回车提交', async () => {
    const { box } = setup()
    await userEvent.type(box, '聊得不错{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.note).toBe('聊得不错')
  })

  it('Shift+回车换行，不提交', async () => {
    const { box } = setup()
    await userEvent.type(box, '第一行{Shift>}{Enter}{/Shift}第二行')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Esc 收起', async () => {
    const { onCancel, box } = setup()
    await userEvent.type(box, '{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('空白内容不提交 —— 别记一条什么都没有的触点', async () => {
    const { box } = setup()
    await userEvent.type(box, '   {Enter}')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('存完那句确认', () => {
  it('读懂了下一步 → 说出哪天，按服务端给的时区', async () => {
    // 悉尼周五 23:00 = UTC 13:00（同一时刻在奥克兰已是周六）
    fetchMock.mockResolvedValue(
      okResponse({
        timeZone: 'Australia/Sydney',
        parsed: { callback_at: '2026-08-21T13:00:00.000Z' },
      }),
    )
    const { onDone, box } = setup()
    await userEvent.type(box, '周五晚上给报价{Enter}')

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toContain('周五')
  })

  /**
   * 他明明说了时间却没排上 —— **必须说**。不说的话他以为排好了，
   * 到那天没人提醒，答应客人的事就砸了。
   */
  it('说了时间却没排上 → 明说没读懂', async () => {
    fetchMock.mockResolvedValue(okResponse({ parsed: { callback_at: null } }))
    const { onDone, box } = setup()
    await userEvent.type(box, '周五给报价{Enter}')

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toContain('没读懂')
  })

  it('同一笔重复提交 → 说出来，别让他以为补的内容也存上了', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ created: false }),
    } as Response)
    const { onDone, box } = setup()
    await userEvent.type(box, '聊过了{Enter}')

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toContain('之前已经记过了')
  })

  it('存失败 → 留在原地显示错误，不假装存上了', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: '数据库炸了' }),
    } as Response)
    const { onDone, box } = setup()
    await userEvent.type(box, '聊过了{Enter}')

    await waitFor(() => expect(screen.getByText(/数据库炸了/)).toBeTruthy())
    expect(onDone).not.toHaveBeenCalled()
  })
})

/**
 * 🔴 **防重键跟着「这段文字」走**（Codex 复审 2026-08-15）。
 *
 * 第一次请求已经把触点插进去了、但后面那步失败 —— 输入框留在原地让人改。
 * 改完再回车如果还用老键，服务端认成重复提交，**改过的那版笔记被整个丢掉**。
 *
 * 更糟的是服务端**先解析新文本、再去重，去重之后照样更新联系人**：
 * 新文本里那句「别再联系」会把这个人的状态改掉，却没有任何一条触点记着它。
 */
describe('防重键：同样的字复用，改过的字换新', () => {
  const refOf = (call: unknown[]) =>
    JSON.parse((call[1] as RequestInit).body as string).clientRef as string

  it('同一段字重试 → 用同一个键（双击不会记两笔）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('网络断了'))
    const { box } = setup()
    await userEvent.type(box, '聊过了{Enter}')
    await waitFor(() => expect(screen.getByText(/网络断了/)).toBeTruthy())

    // 一个字都没改，直接再回车
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(refOf(fetchMock.mock.calls[1])).toBe(refOf(fetchMock.mock.calls[0]))
  })

  it('失败之后改了字 → 换一个新键，这一版才存得进去', async () => {
    fetchMock.mockRejectedValueOnce(new Error('网络断了'))
    const { box } = setup()
    await userEvent.type(box, '聊过了{Enter}')
    await waitFor(() => expect(screen.getByText(/网络断了/)).toBeTruthy())

    await userEvent.type(box, '，客户说别再联系了{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(refOf(fetchMock.mock.calls[1])).not.toBe(refOf(fetchMock.mock.calls[0]))
  })
})
