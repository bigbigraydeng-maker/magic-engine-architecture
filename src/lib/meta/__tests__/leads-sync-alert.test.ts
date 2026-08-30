import { describe, it, expect } from 'vitest'
import { summariseFailures } from '../leads-sync-alert'

/**
 * 样本取自 2026-08-30 生产 `cron_run_logs` 的真实报错原文（4 个客户全挂 9 天，
 * 而 `error_message` 一直是 null，日报邮件只显示一个破折号）。
 */
const TOKEN_DEAD =
  'leadgen_forms HTTP 400: {"error":{"message":"Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.","type":"OAuthException","code":190,"error_subcode":460}}'
const NO_PERMISSION =
  'leadgen_forms HTTP 403: {"error":{"message":"(#200) Requires pages_manage_ads permission to manage the object","type":"OAuthException","code":200}}'

const REAL_OUTAGE = [
  { clientName: 'Magic Lab Class', error: TOKEN_DEAD },
  { clientName: 'Roman HU', error: TOKEN_DEAD },
  { clientName: 'NZCPE 2026', error: TOKEN_DEAD },
  { clientName: 'CTS Tours NZ', error: NO_PERMISSION },
]

describe('summariseFailures', () => {
  it('全好时返回 undefined —— 否则每小时都会把健康的一跑标成失败', () => {
    expect(
      summariseFailures([{ clientName: 'CTS Tours NZ' }, { clientName: 'Roman HU' }]),
    ).toBeUndefined()
  })

  it('先报有多少家挂了', () => {
    expect(summariseFailures(REAL_OUTAGE)).toMatch(/^4\/4 个客户取不到线索/)
  })

  it('同一句报错的客户合并成一组 —— 一把令牌失效不该把 200 字符刷满四遍', () => {
    const out = summariseFailures(REAL_OUTAGE)!
    expect(out).toContain('Magic Lab Class/Roman HU/NZCPE 2026')
    // 同一句原因只出现一次
    expect(out.match(/session has been invalidated/g)).toHaveLength(1)
  })

  it('病因不同的客户各自成组 —— 权限不足跟令牌失效修法不同，不能混成一句', () => {
    const out = summariseFailures(REAL_OUTAGE)!
    expect(out).toContain('CTS Tours NZ')
    expect(out).toContain('Requires pages_manage_ads')
  })

  it('日报邮件只截前 200 字符 —— 这 200 字符里必须能看出「是什么错」', () => {
    const head = summariseFailures(REAL_OUTAGE)!.slice(0, 200)
    expect(head).toMatch(/Error validating access token|Requires pages_manage_ads/)
  })

  it('单个客户的原因过长时截断，不让一家挤掉其他家', () => {
    const out = summariseFailures([
      { clientName: 'A', error: 'x'.repeat(500) },
      { clientName: 'B', error: 'short reason' },
    ])!
    expect(out).toContain('short reason')
    expect(out.length).toBeLessThan(400)
  })

  it('部分失败也要报 —— 一家断供就是一条线索管道断了', () => {
    const out = summariseFailures([
      { clientName: 'CTS Tours NZ', error: NO_PERMISSION },
      { clientName: 'Roman HU' },
    ])
    expect(out).toMatch(/^1\/2 个客户取不到线索/)
  })
})
