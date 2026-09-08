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
 * 🔴 误诊防线（2026-09-08 生产实测 + Codex P1 复审两轮）。
 *
 * 第一轮修的是：Oztop 一条 8-03 的工单因 `Insufficient credit balance` 失败后退回
 * 队列，一躺 36 天（`attempt_count=1`，失败后就没再被碰过）。恰好赶上工人离线，被
 * 判成「工人没开机」，待办让 PM 去开机跑 CLI —— 他就算开机跑了也没用。
 *
 * 第二轮把优先级改回来了，因为第一版矫枉过正：带 `reject_reason` 的 queued 工单
 * **不等于「没救了」**。`fail` 路由把可重试失败原样退回 queued 并留下原因，而
 * `max_attempts` 默认是 2，所以队列里带原因的工单通常**只失败过一次、还有一次机会**；
 * 真正没救的进 `dead_letter`，压根不在 queued 里。
 *
 * 于是「有原因就判卡住 + 劝阻开机」会造成死结：网络抖动失败一次后，只要工人恰好
 * 离线，重试就永远不会发生。**开机是离线状态下无条件正确的第一步**，所以它优先；
 * 失败原因作为附加信息一起带上，不丢。
 */
describe('judgeWorkerPresence —— 🔴 「没人干活」优先于「失败后卡住」', () => {
  it('🔴 工人离线 + 排队的全失败过（Oztop 真实场景）→ 报 worker_offline，但把失败原因带上', () => {
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
      // 开机是离线时无条件正确的第一步 —— 绝不能因为「失败过」就劝阻它，
      // 那会让本该有效的重试永远跑不了。
      expect(v.kind).toBe('worker_offline')
      // 但失败原因不能丢：开机后还是过不去时，那就是下一步。
      expect(v.sampleReason).toContain('Insufficient credit balance')
    }
  })

  it('🔴 工人在线 + 排队的全失败过 → 这才是 stuck_on_failure（旧逻辑这里静默判 idle，属于漏报）', () => {
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
    if (!v.idle) {
      expect(v.kind).toBe('stuck_on_failure')
      expect(v.humanReason).toContain('工人在线')
      expect(v.sampleReason).toContain('scene_tag')
    }
  })

  it('🔴 工人在线 + 还有没失败过的新活在等 → 不报（那是产能问题）', () => {
    expect(
      judgeWorkerPresence(
        snap({
          queued: 3,
          oldestQueuedHours: 40,
          lastHeartbeatHours: 0.2,
          queuedStuckOnFailure: 1,
          stuckSampleReason: 'muapi submit: Insufficient credit balance',
        }),
      ).idle,
    ).toBe(true)
  })

  it('工人离线 + 只有一部分失败过 → 报 worker_offline，照样把原因带上', () => {
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

  it('工人离线 + 一个都没失败过 → worker_offline 且不带 sampleReason（没有就不硬编一句）', () => {
    const v = judgeWorkerPresence(
      snap({ queued: 2, oldestQueuedHours: 40, lastHeartbeatHours: 30, queuedStuckOnFailure: 0 }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('worker_offline')
      expect(v.sampleReason).toBeUndefined()
    }
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

  it('工人在线、拿不到失败原因原文 → stuck_on_failure 但不硬编一句', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 1,
        oldestQueuedHours: 100,
        lastHeartbeatHours: 0.1,
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
