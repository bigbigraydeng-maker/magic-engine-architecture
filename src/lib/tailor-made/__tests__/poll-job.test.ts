/**
 * 轮询任务状态。这个文件存在的唯一理由，是钉死一句报错永远不许再出现在顾问面前：
 *
 *     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * 甲方为这句话报障过三次。前两次修的是服务端（AI 输出被截断、CF 代理 100 秒
 * 掐断连接），第三次才发现：轮询本身就是最后一个会原样吐出这句话的地方——
 * 27 天的团要轮询几十次，其中任何一次撞上网关错误页，裸 res.json() 就抛
 * SyntaxError，错误文本被直接显示给顾问。而此时后台任务还在正常跑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pollTailorMadeJob, POLL_MAX_CONSECUTIVE_FAILURES } from '../poll-job'

const noSleep = async () => {}
const alive = () => false // isCancelled() === false，即页面还在

/** 网关/错误页返回的 HTML —— res.json() 撞上它就是那句要命的报错 */
function htmlErrorPage(status = 502) {
  return {
    status,
    ok: false,
    json: async () => {
      throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)
    },
  } as unknown as Response
}

function jsonResponse(body: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response
}

function mockFetchSequence(responses: Array<Response | Error>) {
  const fn = vi.fn()
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r)
    else fn.mockResolvedValueOnce(r)
  }
  // 用完之后一直返回最后一个，避免测试因为次数没算准而误红
  const last = responses[responses.length - 1]
  if (last instanceof Error) fn.mockRejectedValue(last)
  else fn.mockResolvedValue(last)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('pollTailorMadeJob —— 绝不把 "Unexpected token \'<\'" 甩给顾问', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('中途一次网关 HTML 错误页：继续轮询，最终拿到结果', async () => {
    mockFetchSequence([
      jsonResponse({ status: 'running' }),
      htmlErrorPage(502), // ← 就是这一下，以前会直接炸给顾问看
      jsonResponse({ status: 'running' }),
      jsonResponse({ status: 'completed', result: { payload: { days: [1, 2, 3] } } }),
    ])

    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)

    expect(out.result).toEqual({ payload: { days: [1, 2, 3] } })
    expect(out.error).toBeUndefined()
  })

  it('中途一次网络中断（fetch reject）：同样不中断轮询', async () => {
    mockFetchSequence([
      new TypeError('Failed to fetch'),
      jsonResponse({ status: 'completed', result: { ok: true } }),
    ])

    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)
    expect(out.result).toEqual({ ok: true })
  })

  it('连续失败到上限才放弃，且给的是人话、不是 JS 报错原文', async () => {
    mockFetchSequence(Array.from({ length: 20 }, () => htmlErrorPage(502)))

    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)

    expect(out.result).toBeUndefined()
    // 最关键的一条：无论如何都不能把这句原文传出去
    expect(out.error).not.toContain('Unexpected token')
    expect(out.error).not.toContain('DOCTYPE')
    // 而且要告诉顾问「内容多半还在」，别让他重新生成白花一次钱
    expect(out.error).toContain('刷新')
  })

  it('放弃前确实重试满了次数，不是撞一次就退', async () => {
    const fetchMock = mockFetchSequence(Array.from({ length: 20 }, () => htmlErrorPage(502)))
    await pollTailorMadeJob('c1', 'j1', alive, noSleep)
    expect(fetchMock).toHaveBeenCalledTimes(POLL_MAX_CONSECUTIVE_FAILURES)
  })

  it('失败计数会被一次成功清零——长任务里零星抖动不该累积成放弃', async () => {
    // 4 次失败 → 1 次成功（清零）→ 4 次失败 → 成功拿到结果。
    // 如果计数不清零，第 5 次失败就会放弃，这个用例会红。
    mockFetchSequence([
      ...Array.from({ length: 4 }, () => htmlErrorPage(502)),
      jsonResponse({ status: 'running' }),
      ...Array.from({ length: 4 }, () => htmlErrorPage(502)),
      jsonResponse({ status: 'completed', result: { ok: 'survived' } }),
    ])

    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)
    expect(out.result).toEqual({ ok: 'survived' })
  })

  it('4xx 是确定性错误，直接收尾不浪费重试', async () => {
    const fetchMock = mockFetchSequence([jsonResponse({ error: '任务不存在' }, 404)])

    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)

    expect(out.error).toBe('任务不存在')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('4xx 但响应体也是 HTML 时，仍然给人话而不是解析报错', async () => {
    mockFetchSequence([htmlErrorPage(403)])
    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)
    expect(out.error).not.toContain('Unexpected token')
    expect(out.error).toContain('403')
  })

  it('任务本身失败时，如实把服务端的失败原因带出来', async () => {
    mockFetchSequence([jsonResponse({ status: 'failed', error: '行程内容过长，AI 一次没能写完就被截断了' })])
    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep)
    expect(out.error).toContain('截断')
  })

  it('页面卸载后立刻停手，不再打请求也不返回结果', async () => {
    const fetchMock = mockFetchSequence([jsonResponse({ status: 'running' })])
    const out = await pollTailorMadeJob('c1', 'j1', () => true, noSleep)
    expect(out.cancelled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('超过总时长上限会收尾，不会无限轮询下去', async () => {
    mockFetchSequence([jsonResponse({ status: 'running' })])
    let t = 0
    const now = () => (t += 60 * 60 * 1000) // 每次调用都跳一小时
    const out = await pollTailorMadeJob('c1', 'j1', alive, noSleep, now)
    expect(out.error).toContain('等待太久')
  })
})
