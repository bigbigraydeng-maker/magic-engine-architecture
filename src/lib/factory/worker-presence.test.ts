import { describe, it, expect } from 'vitest'
import { judgeWorkerPresence, QUEUE_STALE_HOURS, type QueueSnapshot } from './worker-presence'

/** 默认：队列里的活都是等人干的新活（没有失败原因）。 */
function snap(over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    queued: 0,
    oldestQueuedHours: null,
    lastHeartbeatHours: null,
    queuedStuckOnFailure: 0,
    stuckSampleReason: null,
    ...over,
  }
}

describe('judgeWorkerPresence —— 队列里有活但没人干', () => {
  it('🔴 队列空 → 不报。工人没开机是常态，没活时报了就是噪音', () => {
    expect(judgeWorkerPresence(snap({ queued: 0, lastHeartbeatHours: 500 })).idle).toBe(true)
  })

  it('有活但刚进队列 → 不报，可能工人正在跑别的单', () => {
    expect(judgeWorkerPresence(snap({ queued: 2, oldestQueuedHours: 1 })).idle).toBe(true)
  })

  it('🔴 有活、等久了、也确实没人动 → 报，并说清等了多久', () => {
    const v = judgeWorkerPresence(
      snap({ queued: 3, oldestQueuedHours: 26, lastHeartbeatHours: 30 }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('worker_offline')
      expect(v.humanReason).toContain('3 个')
      expect(v.humanReason).toContain('26 小时')
      expect(v.humanReason).toContain('30 小时')
    }
  })

  it('🔴 有活等久了，但工人还在动 → 不报。那是产能不够，不是没人干活', () => {
    // 这两件事的处置完全不同：前者是去开机，后者是加并发或减量。
    // 混成一条告警，人会去做错的事。
    expect(
      judgeWorkerPresence(snap({ queued: 5, oldestQueuedHours: 40, lastHeartbeatHours: 0.2 })).idle,
    ).toBe(true)
  })

  it('从来没有工人连上来过 → 说清是「从来没有」，不是「停了」', () => {
    const v = judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: QUEUE_STALE_HOURS + 1 }))
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.humanReason).toContain('从来没有')
  })

  it('刚好卡在门槛上不报 —— 边界宁可漏一次，不要天天嚷', () => {
    expect(
      judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: QUEUE_STALE_HOURS })).idle,
    ).toBe(false)
    expect(
      judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: QUEUE_STALE_HOURS - 0.1 })).idle,
    ).toBe(true)
  })
})

/**
 * 🔴 误诊防线（2026-09-08 生产实测）。
 *
 * Oztop 一条 8-03 的工单因 `Insufficient credit balance` 卡了 36 天：余额不足时
 * worker 把工单**退回 queued** 而不是标 failed，于是它永远躺在队列里，每轮被领走、
 * 每轮失败、又退回来。恰好赶上工人离线，就被判成「工人没开机」，待办让 PM 去开机
 * 跑 CLI —— 他就算开机跑了也没用，病因根本不是工人不在。
 */
describe('judgeWorkerPresence —— 🔴 区分「没人干活」和「每轮都失败」', () => {
  it('🔴 排队的全是带失败原因的工单 → 报 stuck_on_failure，不报「没人干活」', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 1,
        oldestQueuedHours: 36 * 24,
        lastHeartbeatHours: 8 * 24,
        queuedStuckOnFailure: 1,
        stuckSampleReason: 'muapi submit: Insufficient credit balance',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('stuck_on_failure')
      expect(v.humanReason).toContain('反复失败')
      expect(v.sampleReason).toContain('Insufficient credit balance')
      // 绝不能再说「没人干活」那套 —— 那会把人支去开机
      expect(v.humanReason).not.toContain('没有工人')
    }
  })

  it('🔴 工人在线但排队的活每轮都失败 → 照样报（旧逻辑这里会静默判 idle，属于漏报）', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 2,
        oldestQueuedHours: 50,
        lastHeartbeatHours: 0.1, // 工人刚刚还在动
        queuedStuckOnFailure: 2,
        stuckSampleReason: 'complete 422: scene_tag not in whitelist',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.kind).toBe('stuck_on_failure')
  })

  it('🔴 只有一部分是失败工单、还有新活在等 → 仍报「没人干活」（那个更要紧）', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 3,
        oldestQueuedHours: 40,
        lastHeartbeatHours: 30,
        queuedStuckOnFailure: 1,
        stuckSampleReason: 'muapi submit: Insufficient credit balance',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.kind).toBe('worker_offline')
  })

  it('失败工单还没等够久 → 不报（跟新活同一个门槛，不给失败单开小灶）', () => {
    expect(
      judgeWorkerPresence(
        snap({
          queued: 1,
          oldestQueuedHours: QUEUE_STALE_HOURS - 0.1,
          queuedStuckOnFailure: 1,
          stuckSampleReason: 'muapi submit: Insufficient credit balance',
        }),
      ).idle,
    ).toBe(true)
  })

  it('拿不到失败原因原文时不硬编一句 —— sampleReason 缺省就不带这个字段', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 1,
        oldestQueuedHours: 100,
        queuedStuckOnFailure: 1,
        stuckSampleReason: null,
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('stuck_on_failure')
      expect(v.sampleReason).toBeUndefined()
    }
  })
})
