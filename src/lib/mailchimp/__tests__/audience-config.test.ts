/**
 * audience id 的容错读法。
 *
 * 这个文件存在的理由是一次真实的静默事故：`clients.mailchimp_audience_id` 的
 * migration (20260826010000) 提交了但从没 apply 到生产，直接 select 它整条
 * PostgREST 查询回 42703，上游把它当成「读配置失败」静默跳过 —— Meta 表单的人
 * 一个都没进 Mailchimp audience，一个月没人看得见。
 *
 * 所以这里钉的每一条都是「空有三种来路」的分辨题：**这一列还没建** /
 * **查得到、就是没配** / **真的查不到**，三者必须导向三种不同的行为。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { audienceFromLeadsConfig, isUndefinedColumn, readAudienceId } from '../audience-config'

const CLIENT = 'client-cts'

const UNDEFINED_COLUMN = {
  code: '42703',
  message: 'column clients.mailchimp_audience_id does not exist',
}

/** 记下每一次 select 点了哪些列，按顺序返回预置结果。 */
function mockSelects(results: Array<{ data: unknown; error: unknown }>): string[] {
  const seen: string[] = []
  let i = 0
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: (cols: string) => {
      seen.push(cols)
      const res = results[i++] ?? { data: null, error: { message: 'unexpected extra query' } }
      return { eq: () => ({ maybeSingle: () => Promise.resolve(res) }) }
    },
  }))
  return seen
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isUndefinedColumn', () => {
  it('42703 和 "does not exist" 都认', () => {
    expect(isUndefinedColumn(UNDEFINED_COLUMN)).toBe(true)
    expect(isUndefinedColumn({ message: 'column foo does not exist' })).toBe(true)
  })

  it('别的错一律不认 —— 权限 / 抖动 / schema cache 不许被当成「列还没建」', () => {
    expect(isUndefinedColumn({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isUndefinedColumn({ message: 'connection reset by peer' })).toBe(false)
    expect(isUndefinedColumn(null)).toBe(false)
  })
})

describe('audienceFromLeadsConfig', () => {
  it('读到字符串就 trim', () => {
    expect(audienceFromLeadsConfig({ mailchimp_audience_id: '  dda97b7e61 ' })).toBe('dda97b7e61')
  })

  it('null / 缺字段 / 非字符串 一律空串', () => {
    expect(audienceFromLeadsConfig(null)).toBe('')
    expect(audienceFromLeadsConfig({})).toBe('')
    expect(audienceFromLeadsConfig({ mailchimp_audience_id: 123 })).toBe('')
  })
})

describe('readAudienceId', () => {
  it('专列存在且有值 → 用专列，只查一次', async () => {
    const seen = mockSelects([{ data: { mailchimp_audience_id: 'from-column' }, error: null }])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({ ok: true, audienceId: 'from-column' })
    expect(seen).toHaveLength(1)
  })

  it('专列存在但为空 → 空串关闭出口，**不许**掉回 leads_config 的旧值', async () => {
    // migration 注释把这一列的语义写死成「NULL disables the outlet」。空值还
    // 掉回旧 JSON，运营就关不掉出口，会给本该停掉的人继续发订阅。
    // 假件**故意**把 leads_config 的旧值一并递回来（真库上两处可以同时有值，
    // 而且第一条查询将来若被人加宽就真会带回它）。代码必须视而不见 ——
    // 只靠「没 select 它」来保证正确是脆的，行为本身也得钉住。
    const seen = mockSelects([
      {
        data: { mailchimp_audience_id: null, leads_config: { mailchimp_audience_id: 'stale-old' } },
        error: null,
      },
      { data: { leads_config: { mailchimp_audience_id: 'stale-old' } }, error: null },
    ])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({ ok: true, audienceId: '' })
    // 连查都不该再查第二次 —— 专列在，它就是唯一权威
    expect(seen).toHaveLength(1)
    // 而且第一条查询压根不该点 leads_config：专列在的时候它毫无话语权
    expect(seen[0]).not.toContain('leads_config')
  })

  it('专列没 apply（42703）→ 降级只查 leads_config，拿到值继续干活', async () => {
    const seen = mockSelects([
      { data: null, error: UNDEFINED_COLUMN },
      { data: { leads_config: { mailchimp_audience_id: 'dda97b7e61' } }, error: null },
    ])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({ ok: true, audienceId: 'dda97b7e61' })
    expect(seen).toHaveLength(2)
    // 第一次点了专列（所以才 42703），第二次绝不能再点，否则又是同一个错
    expect(seen[0]).toContain('mailchimp_audience_id')
    expect(seen[1]).not.toContain('mailchimp_audience_id')
  })

  it('真实读失败（非 42703）→ ok:false，且**不再降级重试**（不许把故障当成「列没建」）', async () => {
    const seen = mockSelects([
      { data: null, error: { code: '42501', message: 'permission denied for table clients' } },
    ])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({
      ok: false,
      message: 'permission denied for table clients',
    })
    expect(seen).toHaveLength(1)
  })

  it('降级之后第二次也失败 → ok:false，不许吞成「没配」', async () => {
    mockSelects([
      { data: null, error: UNDEFINED_COLUMN },
      { data: null, error: { message: 'connection reset' } },
    ])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({ ok: false, message: 'connection reset' })
  })

  it('客户行不存在 → ok:true + 空串（「查得到就是没配」，跟「查不到」是两件事）', async () => {
    mockSelects([{ data: null, error: UNDEFINED_COLUMN }, { data: null, error: null }])

    await expect(readAudienceId(CLIENT)).resolves.toEqual({ ok: true, audienceId: '' })
  })
})
