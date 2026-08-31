/**
 * CTS 2027 China Panorama（27 天团）报障：生成失败 "Unexpected token '<'"，
 * 排查发现是 AI 单次输出被 max_tokens 截断——Anthropic 对被截断的 tool_use
 * 仍会返回"已经写完的那部分"当合法结果，实测只截出前 2 天。
 *
 * 这份文件最终要发给终端客户，宁可报错重来，也不能把写了一半的行程当成
 * 完整行程悄悄存下去。见 extract.ts 里 stop_reason === 'max_tokens' 的硬闸。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', async actual => ({
  ...(await actual<typeof import('@/lib/anthropic/client')>()),
  getAnthropicClientDirect: () => ({ messages: { create: mockCreate } }),
}))

import { extractItinerary } from '../extract'
import { createBlankItinerary } from '../types'

const current = () => createBlankItinerary('T-1')

function toolUseResponse(input: unknown, stop_reason: string) {
  return {
    content: [{ type: 'tool_use', name: 'submit_itinerary', id: 'x', input }],
    stop_reason,
  }
}

describe('extractItinerary — 长行程截断防护', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('stop_reason=max_tokens 时报错，不把截断的半截行程当成功结果返回', async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse(
        { patch: { days: [{ day: 1 }, { day: 2 }] }, review: [], reply: '部分完成' },
        'max_tokens'
      )
    )

    await expect(
      extractItinerary({ message: '27 天中国全景团行程...', current: current() })
    ).rejects.toThrow(/截断|过长/)
  })

  it('正常结束（tool_use）时照常返回解析结果', async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse(
        { patch: { days: [{ day: 1 }, { day: 2 }] }, review: [], reply: '已完成' },
        'tool_use'
      )
    )

    const result = await extractItinerary({ message: '两天行程', current: current() })
    expect(result.patch.days).toHaveLength(2)
    expect(result.reply).toBe('已完成')
  })

  it('单次输出上限调到 16000——8192 在实测中连 20 天团都常跑到临界值', async () => {
    mockCreate.mockResolvedValue(toolUseResponse({ patch: {}, review: [], reply: 'ok' }, 'tool_use'))
    await extractItinerary({ message: '任意行程文字', current: current() })

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 16000 }))
  })
})
