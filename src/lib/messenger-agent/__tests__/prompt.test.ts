/**
 * `buildMessengerAgentSystemPrompt` 的基础组装测试（Issue #1580）。
 *
 * 不在本 issue 的 A 级验证要求清单里（清单只要求 tools.ts 的 ctx 注入测试和
 * 输出契约 schema 测试），但这是新增的纯函数、分支不少（无 brief / 空
 * offerings / 空对话历史），按 coding-style.md「行为变更要配回归测试」顺手补上。
 */

import { describe, it, expect } from 'vitest'
import { buildMessengerAgentSystemPrompt } from '../prompt'
import type { MasterBrief } from '@/types/magic-engine'
import type { OfferingsFile } from '../offerings-loader'

const EMPTY_OFFERINGS: OfferingsFile = {
  active_tours: [],
  retired_tours: [],
  factual_bullets: [],
  reply_forbidden_topics: [],
  last_verified_at: '2026-09-13',
}

describe('buildMessengerAgentSystemPrompt', () => {
  it('没有 brief 时明确提示不要编造品牌信息，而不是留空', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: EMPTY_OFFERINGS,
      conversationHistory: [],
    })
    expect(prompt).toContain('不要编造')
  })

  it('包含 canonical 在售团（code + 价格）', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: {
        ...EMPTY_OFFERINGS,
        active_tours: [
          {
            code: 'golden-china', name: 'Golden China', aliases: [], price_nzd: 4999,
            departure_dates: ['2026-11-16'], nights: 9,
            itinerary_url: 'https://x.test', highlights: [],
          },
        ],
      },
      conversationHistory: [],
    })
    expect(prompt).toContain('golden-china')
    expect(prompt).toContain('4999')
  })

  it('包含已下架团及"仍在线"警示', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: {
        ...EMPTY_OFFERINGS,
        retired_tours: [
          { code: 'old-tour', name: 'Old Tour', aliases: [], retired_reason: 'stopped selling', still_visible_on_website: true },
        ],
      },
      conversationHistory: [],
    })
    expect(prompt).toContain('old-tour')
    expect(prompt).toContain('仍在线')
  })

  it('空对话历史时说明"第一条消息"，而不是留空段落', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: EMPTY_OFFERINGS,
      conversationHistory: [],
    })
    expect(prompt).toContain('第一条消息')
  })

  it('包含对话历史里的正文', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: EMPTY_OFFERINGS,
      conversationHistory: [
        { direction: 'inbound', senderName: 'Alice', body: '请问 Silk Road 团还能订吗', sentAt: '2026-09-13T00:00:00Z' },
      ],
    })
    expect(prompt).toContain('请问 Silk Road 团还能订吗')
  })

  it('硬闸文案里包含输出契约的三个字段名', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      offerings: EMPTY_OFFERINGS,
      conversationHistory: [],
    })
    expect(prompt).toContain('reply_text')
    expect(prompt).toContain('confidence')
    expect(prompt).toContain('offerings')
  })

  it('有 brief 时使用 formatBriefForPrompt 的输出（品牌名会出现）', () => {
    const brief: MasterBrief = {
      id: 'brief-1',
      client_id: 'client-1',
      version: 1,
      status: 'active',
      brand_name: 'CTS Tours NZ',
    }
    const prompt = buildMessengerAgentSystemPrompt({
      brief,
      offerings: EMPTY_OFFERINGS,
      conversationHistory: [],
    })
    expect(prompt).toContain('CTS Tours NZ')
  })
})
