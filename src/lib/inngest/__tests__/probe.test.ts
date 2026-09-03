/**
 * #1346 · Inngest 接收端点的两组保证：
 *   1. 探针受理判据 fail-closed（缺字段一律拒，绝不当默认值继续）
 *   2. 云端注册函数 id 命名空间隔离（一律 cloud- 前缀，防与本机 worker 撞车）
 */
import { describe, it, expect } from 'vitest'
import { probeReceiptFor, CLOUD_PROBE_PING_EVENT } from '../functions/probe'
import { cloudFunctions } from '@/app/api/inngest/route'
import { CLOUD_FN_PREFIX } from '../client'

describe('probeReceiptFor — fail-closed 受理判据', () => {
  it('合法 payload → ok，带回 source_id 与事件时间', () => {
    const r = probeReceiptFor({ source_id: 'probe-abc' }, 1_700_000_000)
    expect(r).toEqual({ ok: true, source_id: 'probe-abc', received_ts: 1_700_000_000, app: 'magic-engine-web' })
  })
  it('缺 source_id → 拒', () => {
    expect(probeReceiptFor({}, 1).ok).toBe(false)
  })
  it('source_id 空串 / 纯空白 → 拒（不当作有效 id）', () => {
    expect(probeReceiptFor({ source_id: '' }, 1).ok).toBe(false)
    expect(probeReceiptFor({ source_id: '   ' }, 1).ok).toBe(false)
  })
  it('source_id 非字符串 → 拒', () => {
    expect(probeReceiptFor({ source_id: 123 }, 1).ok).toBe(false)
  })
  it('data 非对象 → 拒', () => {
    expect(probeReceiptFor(null, 1).ok).toBe(false)
    expect(probeReceiptFor('x', 1).ok).toBe(false)
  })
  it('事件时间缺失 / 非有限数 → 拒（不编一个时间戳）', () => {
    expect(probeReceiptFor({ source_id: 'ok' }, undefined).ok).toBe(false)
    expect(probeReceiptFor({ source_id: 'ok' }, NaN).ok).toBe(false)
  })
})

describe('云端函数命名空间隔离（子牙必改项）', () => {
  it('注册的每个云端函数 id 都以 cloud- 开头', () => {
    expect(cloudFunctions.length).toBeGreaterThan(0)
    for (const fn of cloudFunctions) {
      expect(fn.id()).toMatch(new RegExp(`^${CLOUD_FN_PREFIX}`))
    }
  })
  it('探针事件是专属事件，不是任何真实业务事件', () => {
    // 若哪天有人把探针改成监听 daily_plan.publish_queue.ready，此断言变红。
    expect(CLOUD_PROBE_PING_EVENT).toBe('cloud/probe.ping')
    expect(CLOUD_PROBE_PING_EVENT).not.toContain('publish_queue')
  })
})
