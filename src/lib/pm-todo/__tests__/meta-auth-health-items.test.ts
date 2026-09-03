/**
 * 「Meta 授权坏了」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * Meta 授权只有人能修（要拿能管理主页的账号去点授权），所以这条必须到人眼前。
 *
 * 这里验的是——该报的报了、不该报的不刷屏、话说到人不用问第二遍，
 * 以及最要紧的一条：**问不到状态也必须报**，不许显示成一切正常。
 */

import { describe, it, expect } from 'vitest'
import {
  buildMetaAuthTodo,
  fetchMetaAuthTodos,
} from '../meta-auth-health-items'
import type { MetaAuthHealth } from '@/lib/meta/auth-health'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PAGE = '1616575215312482'
const NOW = new Date('2026-09-04T12:00:00Z')

function health(over: Partial<MetaAuthHealth> = {}): MetaAuthHealth {
  return {
    client_id: CLIENT,
    page_id: PAGE,
    state: 'ok',
    token_source: 'stored_connection',
    granted_scopes: [],
    missing_scopes: [],
    connection_status: 'active',
    provider_error: null,
    checked_at: '2026-09-04T07:00:00Z',
    ...over,
  }
}

describe('buildMetaAuthTodo', () => {
  it('🔴 授权失效要报，而且要说清后果不止一处', () => {
    const t = buildMetaAuthTodo(
      health({ state: 'rejected', provider_error: 'Error validating access token: Session has expired' }),
    )!
    expect(t.kind).toBe('meta_auth_rejected')
    expect(t.what).toContain('失效')
    expect(t.what).toContain('发帖')
    expect(t.what).toContain('客资')
    // 「显示成今天没有」是这类事故最贵的部分 —— 必须写在待办上
    expect(t.what).toContain('今天没有')
    expect(t.what).toContain('Session has expired')
  })

  it('🔴 问不到状态也要报，而且要明说这不等于没问题', () => {
    const t = buildMetaAuthTodo(health({ state: 'unknown', provider_error: 'ECONNRESET' }))!
    expect(t.kind).toBe('meta_auth_unknown')
    expect(t.what).toContain('不是「没问题」')
    expect(t.what).toContain('ECONNRESET')
    // 走完一遍还是正常的话，要有一条回给我们的路 —— 否则人只能干等
    expect(t.how).toContain('Meta 体检问不到')
  })

  it('缺权限要列出缺的是哪几项，并说清后果是静默的', () => {
    const t = buildMetaAuthTodo(
      health({ state: 'scope_missing', missing_scopes: ['pages_manage_posts', 'leads_retrieval'] }),
    )!
    expect(t.kind).toBe('meta_auth_scope_missing')
    expect(t.what).toContain('pages_manage_posts、leads_retrieval')
    expect(t.what).toContain('静默')
  })

  it('登记了主页但没有授权 → 说清「是空的」而不是「没有内容」', () => {
    const t = buildMetaAuthTodo(health({ state: 'no_token', token_source: 'none' }))!
    expect(t.kind).toBe('meta_auth_no_token')
    expect(t.what).toContain('找不到它自己的授权')
    expect(t.what).toContain('而不是「没有内容」')
  })

  it('🔴 how 要具体到点哪里，href 要直达这个客户自己的设置页', () => {
    const t = buildMetaAuthTodo(health({ state: 'rejected' }))!
    expect(t.how).toContain('平台连接')
    expect(t.how).toContain('连接 Meta')
    expect(t.href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}?settings=platform`)
  })

  it('🔴 指向「连接 Meta」而不是「去换环境变量」—— 换一次只再撑 60 天，不算修好', () => {
    const t = buildMetaAuthTodo(health({ state: 'rejected' }))!
    expect(t.how).not.toContain('Render')
    expect(t.how).not.toContain('META_SYSTEM_USER_TOKEN')
  })

  it('主页 ID 要印在待办上 —— 一个客户可能不止一个主页', () => {
    expect(buildMetaAuthTodo(health({ state: 'rejected' }))!.what).toContain(PAGE)
  })

  it('没主页 ID 时也说得出话', () => {
    const t = buildMetaAuthTodo(health({ state: 'rejected', page_id: null }))!
    expect(t.what).not.toContain('（主页 ')
  })

  it('健康的不出待办', () => {
    expect(buildMetaAuthTodo(health({ state: 'ok' }))).toBeNull()
  })

  it('没登记主页的不出待办 —— 客户没打算连 Facebook 时天天提醒是噪音', () => {
    expect(buildMetaAuthTodo(health({ state: 'no_page', page_id: null }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------

/** 只对 cron_run_logs 建模 —— 碰别的表就炸，暴露越界读取。 */
function fakeSupabase(run: unknown) {
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`fake supabase: table '${table}' is not modelled`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => Promise.resolve({ data: run === null ? [] : [run], error: null })
      return chain
    },
  } as never
}

describe('fetchMetaAuthTodos', () => {
  const summary = { results: [health({ state: 'rejected' })] }

  it('读最近一轮的体检结果', async () => {
    const todos = await fetchMetaAuthTodos(fakeSupabase({ finished_at: '2026-09-04T07:00:00Z', summary }), NOW)
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe(CLIENT)
    expect(todos[0].kind).toBe('meta_auth_rejected')
  })

  it('🔴 结果太旧就不说话 —— 「该跑没跑」有别的待办在管，两处都报会重复', async () => {
    const todos = await fetchMetaAuthTodos(fakeSupabase({ finished_at: '2026-08-30T07:00:00Z', summary }), NOW)
    expect(todos).toEqual([])
  })

  it('跑到一半没写完 finished_at 的不用', async () => {
    expect(await fetchMetaAuthTodos(fakeSupabase({ finished_at: null, summary }), NOW)).toEqual([])
  })

  it('从没跑过 / 没有 summary 都不出待办，也不炸', async () => {
    expect(await fetchMetaAuthTodos(fakeSupabase(null), NOW)).toEqual([])
    expect(
      await fetchMetaAuthTodos(fakeSupabase({ finished_at: '2026-09-04T07:00:00Z', summary: null }), NOW),
    ).toEqual([])
  })

  it('🔴 形状不对的行整条丢掉 —— 绝不让它把待办挂到别的客户名下', async () => {
    const todos = await fetchMetaAuthTodos(
      fakeSupabase({
        finished_at: '2026-09-04T07:00:00Z',
        summary: {
          results: [
            null,
            { state: 'rejected' }, // 没有 client_id
            { ...health({ state: 'rejected' }), client_id: '' }, // 空字符串
            health({ state: 'rejected' }),
          ],
        },
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe(CLIENT)
  })

  it('健康的客户混在结果里时不产生待办', async () => {
    const todos = await fetchMetaAuthTodos(
      fakeSupabase({
        finished_at: '2026-09-04T07:00:00Z',
        summary: {
          results: [
            health({ state: 'ok' }),
            health({ client_id: 'other-client', state: 'unknown' }),
            health({ state: 'no_page', page_id: null }),
          ],
        },
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('other-client')
    expect(todos[0].kind).toBe('meta_auth_unknown')
  })

  it('每条待办的链接都指向它自己那个客户', async () => {
    const todos = await fetchMetaAuthTodos(
      fakeSupabase({
        finished_at: '2026-09-04T07:00:00Z',
        summary: {
          results: [health({ state: 'rejected' }), health({ client_id: 'oztop', state: 'rejected' })],
        },
      }),
      NOW,
    )
    expect(todos[0].href).toContain(CLIENT)
    expect(todos[1].href).toContain('oztop')
    expect(todos[1].href).not.toContain(CLIENT)
  })
})
