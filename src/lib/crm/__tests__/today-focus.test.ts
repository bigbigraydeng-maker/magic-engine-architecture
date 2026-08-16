import { describe, it, expect } from 'vitest'
import {
  buildFocusList,
  recommendedNextStep,
  focusSummary,
  type FocusPayloadInput,
  type FocusPersonInput,
} from '../today-focus'

/** 造一个 today 路由风格的联系人，只填测试关心的字段，其余给安全默认。 */
function person(over: Partial<FocusPersonInput> & { contactId: string }): FocusPersonInput {
  return {
    name: over.name ?? over.contactId,
    reason: over.reason ?? 'why',
    suggestedChannel: over.suggestedChannel ?? 'none',
    phone: over.phone ?? null,
    dueAt: over.dueAt ?? null,
    lastTouchAt: over.lastTouchAt ?? null,
    segment: over.segment ?? 'new_untouched',
    ...over,
  }
}

describe('recommendedNextStep — 渠道映射跟 ReachAction 语义等价（且对坏号/已处理更严），缺证据走 defer', () => {
  it('有号能打 → act，给出号码', () => {
    const s = recommendedNextStep(person({ contactId: 'a', suggestedChannel: 'phone', phone: '021 555' }))
    expect(s.kind).toBe('act')
    expect(s.text).toContain('021 555')
  })

  it('号在库里但打不通 → act，但改渠道并要新号，绝不说「没留电话」', () => {
    const s = recommendedNextStep(
      person({ contactId: 'a', suggestedChannel: 'email', phone: '021 555', phoneUnusable: true }),
    )
    expect(s.kind).toBe('act')
    expect(s.text).toContain('打不通')
    expect(s.text).toContain('新号')
    expect(s.text).not.toContain('没留电话')
  })

  it('phoneUnusable 优先于「有号能打」—— 打不通的号不能被建议去拨', () => {
    // 防御性用例：segments 其实产不出「suggestedChannel:phone + phoneUnusable」这个组合
    // （坏号会被降级掉），但万一那个上游前提被破坏，presenter 也绝不能落到「打电话」分支
    // 去拨一个已知打不通的号。这是刻意比看板 ReachAction 更严的一道守卫。
    const s = recommendedNextStep(
      person({ contactId: 'a', suggestedChannel: 'phone', phone: '021 555', phoneUnusable: true }),
    )
    expect(s.text).not.toContain('打电话：')
    expect(s.text).toContain('打不通')
  })

  it('只能私信 → act', () => {
    expect(recommendedNextStep(person({ contactId: 'a', suggestedChannel: 'messenger' })).text).toContain('Messenger')
  })

  it('只能邮件 → act', () => {
    expect(recommendedNextStep(person({ contactId: 'a', suggestedChannel: 'email' })).text).toContain('发邮件')
  })

  it('没有可用渠道（none）→ defer，明说待补，不猜一个「现在就打」', () => {
    const s = recommendedNextStep(person({ contactId: 'a', suggestedChannel: 'none' }))
    expect(s.kind).toBe('defer')
    expect(s.text).not.toContain('打电话')
  })

  it('想打电话却连号码都没有 → defer（缺证据），不硬给动作', () => {
    const s = recommendedNextStep(person({ contactId: 'a', suggestedChannel: 'phone', phone: null }))
    expect(s.kind).toBe('defer')
  })

  it('今天已处理 → done，复述怎么处理的；没写就给一句通用的', () => {
    expect(
      recommendedNextStep(person({ contactId: 'a', doneToday: true, handledWhy: '今天打过了' })),
    ).toEqual({ kind: 'done', text: '今天打过了' })
    expect(recommendedNextStep(person({ contactId: 'a', doneToday: true })).kind).toBe('done')
  })

  it('已处理优先于渠道 —— 有号也不再建议去打', () => {
    const s = recommendedNextStep(
      person({ contactId: 'a', doneToday: true, handledWhy: '记了不买了', suggestedChannel: 'phone', phone: '021' }),
    )
    expect(s.kind).toBe('done')
    expect(s.text).not.toContain('打电话')
  })
})

describe('buildFocusList — 拍平顺序、层过滤、已处理留原位', () => {
  const payload: FocusPayloadInput = {
    buckets: [
      // 故意把 acted 桶放在数组前面 —— 输出仍必须让 waiting 排到最前。
      { layer: 'acted', people: [person({ contactId: 'act1' }), person({ contactId: 'act2' })] },
      { layer: 'waiting', people: [person({ contactId: 'wait1' }), person({ contactId: 'wait2' })] },
      // queued 是库存，不进「今天该关注谁」。
      { layer: 'queued', people: [person({ contactId: 'q1' })] },
    ],
  }

  it('waiting 排在 acted 前面，桶内顺序原样保留', () => {
    const ids = buildFocusList(payload).map((r) => r.contactId)
    expect(ids).toEqual(['wait1', 'wait2', 'act1', 'act2'])
  })

  it('queued 层的人一个都不进清单', () => {
    expect(buildFocusList(payload).some((r) => r.contactId === 'q1')).toBe(false)
  })

  it('已处理的人留在原位置（不上移不下沉），只是 nextStep 变成 done', () => {
    const p: FocusPayloadInput = {
      buckets: [
        {
          layer: 'waiting',
          people: [
            person({ contactId: 'w1' }),
            person({ contactId: 'w2-done', doneToday: true, handledWhy: '今天回过了' }),
            person({ contactId: 'w3' }),
          ],
        },
      ],
    }
    const rows = buildFocusList(p)
    expect(rows.map((r) => r.contactId)).toEqual(['w1', 'w2-done', 'w3'])
    expect(rows[1].doneToday).toBe(true)
    expect(rows[1].nextStep.kind).toBe('done')
  })

  it('reason 原样成为 whyNow；空 payload 得空清单', () => {
    const rows = buildFocusList({
      buckets: [{ layer: 'waiting', people: [person({ contactId: 'a', reason: '客户来消息了，已经等了 18 小时' })] }] })
    expect(rows[0].whyNow).toBe('客户来消息了，已经等了 18 小时')
    expect(buildFocusList({ buckets: [] })).toEqual([])
  })

  it('上游 200 却没带 buckets → 空清单，不抛错白屏', () => {
    expect(buildFocusList({} as FocusPayloadInput)).toEqual([])
  })

  it('presenter 不凭空造人 —— 输出人数恰好等于 waiting+acted 输入人数', () => {
    expect(buildFocusList(payload)).toHaveLength(4)
  })
})

describe('focusSummary', () => {
  it('数出总数 / 已动过 / 还剩', () => {
    const rows = buildFocusList({
      buckets: [
        {
          layer: 'waiting',
          people: [
            person({ contactId: 'a' }),
            person({ contactId: 'b', doneToday: true, handledWhy: 'x' }),
            person({ contactId: 'c' }),
          ],
        },
      ],
    })
    expect(focusSummary(rows)).toEqual({ total: 3, done: 1, left: 2 })
  })
})
