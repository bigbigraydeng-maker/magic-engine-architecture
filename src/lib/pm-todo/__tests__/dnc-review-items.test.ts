/**
 * 「可能被误判成永久拒联」这条人工任务的出口。
 *
 * 🔴 钉的是**铁律 3 的下半条**：确实不该自动化的事，必须下发成人工任务、
 *    **进同一个管道**（今日待办），而不是写进一份只有开发会看的文档。
 *
 * 背景：旧词表把「not intending to go」（我不打算去）当成了「别再联系我」，
 * 而 `contacts.do_not_contact` 的含义是**任何渠道都不许再发**。词表已经改好，
 * 但存量那几个人不会自己回来 —— 而自动解除是错的方向（万一原话里同时含着
 * 真拒绝，就会去骚扰一个明确说过别联系的客人）。所以交给人看一眼。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushDncReviewItems, type ManualItem } from '../manual-items'

type Row = Record<string, unknown>

/** 假 supabase 按表建模；没建模的表直接抛，不返回半成品。 */
function makeFake(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const filters: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    const chain = () => api
    api.select = () => chain()
    // `metadata->>outcome` 这种 JSON 取值也要认 —— 生产查询就是这么写的。
    const read = (r: Row, col: string): unknown => {
      if (!col.includes('->>')) return r[col]
      const [outer, key] = col.split('->>')
      return (r[outer] as Record<string, unknown> | undefined)?.[key]
    }
    api.eq = (c: string, v: unknown) => (filters.push((r) => read(r, c) === v), chain())
    api.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain())
    api.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: tables[table].filter((r) => filters.every((f) => f(r))),
        error: null,
      }).then(resolve)
    return api
  }
  return { from } as unknown as SupabaseClient
}

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const nameOf = () => 'CTS Tours NZ'

const run = async (contacts: Row[], touches: Row[]): Promise<ManualItem[]> => {
  const items: ManualItem[] = []
  await pushDncReviewItems(
    makeFake({ contacts, contact_touchpoints: touches }),
    items,
    [CLIENT],
    nameOf,
  )
  return items
}

/** 已经被标成「永久别再联系」的人 —— 这条待办只看这一批。 */
const person = (id: string, name: string): Row => ({
  id,
  client_id: CLIENT,
  display_name: name,
  do_not_contact: true,
})

describe('被一句「不打算去」误判成永久拒联的人，必须出现在今日待办上', () => {
  it('原话只有「不打算去」→ 下发一条人工任务', async () => {
    const items = await run(
      [person('c1', 'Christine Matehaere')],
      [{ contact_id: 'c1', raw: 'not intending to go' }],
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('dnc_maybe_wrong')
  })

  /** 三件套缺一条就是没下发好 —— what 要说清影响，how 要具体到点哪里。 */
  it('what 说清是谁、以及代价', async () => {
    const [item] = await run(
      [person('c1', 'Christine Matehaere')],
      [{ contact_id: 'c1', raw: 'not intending to go' }],
    )
    expect(item.what).toContain('Christine Matehaere')
    expect(item.what).toContain('收不到我们任何消息')
  })

  it('how 具体到点哪里，不用回来问人', async () => {
    const [item] = await run(
      [person('c1', 'Christine Matehaere')],
      [{ contact_id: 'c1', raw: 'not intending to go' }],
    )
    expect(item.how).toContain('放回名单')
  })

  /**
   * 🔴 href 必须是**直达那个人**的绝对网址。
   * 写成相对路径会被链接闸判成 broken → **整条待办被丢掉**
   * （狄仁杰 2026-08-05 实测 kept=0）；不带联系人 id 则等于让人自己去翻。
   */
  it('href 是绝对网址，而且直达这个人', async () => {
    const [item] = await run(
      [person('c1', 'Christine Matehaere')],
      [{ contact_id: 'c1', raw: 'not intending to go' }],
    )
    expect(() => new URL(item.href)).not.toThrow()
    expect(item.href).toContain('contact=c1')
  })
})

describe('真的说过「别再联系」的人，一条都不许打扰', () => {
  it.each([
    ['do not follow up'],
    ['客户明确说了不要电话，只邮件联系'],
    ['别再联系了'],
  ])('原话里有「%s」→ 不下发', async (boundary) => {
    const items = await run(
      [person('c1', '某人')],
      [
        { contact_id: 'c1', raw: 'not intending to go' },
        { contact_id: 'c1', raw: boundary },
      ],
    )
    expect(items).toHaveLength(0)
  })

  it('压根没说过「不打算去」的 → 不下发（别把正常拒联翻出来）', async () => {
    const items = await run([person('c1', '某人')], [{ contact_id: 'c1', raw: '不感兴趣' }])
    expect(items).toHaveLength(0)
  })
})

/**
 * 🔴 **半写入状态的人也得被捞出来**（Codex 复审 2026-08-16）。
 *
 * 取消接口是两步写：先写触点，再放下镜像列。第二步失败时，触点说他拒联、
 * 镜像列却是 false —— 而今日名单和分段都按触点判，他照旧被排除着。
 * 这条任务只按镜像列筛的话，最该被复核的这一批永远不会出现。
 */
describe('镜像列没写上的人也要捞出来', () => {
  it('触点说拒联、镜像列是 false → 照样下发', async () => {
    const items = await run(
      [{ id: 'c9', client_id: CLIENT, display_name: 'Half Written', do_not_contact: false }],
      [
        {
          contact_id: 'c9',
          client_id: CLIENT,
          raw: 'not intending to go',
          metadata: { outcome: 'do_not_contact' },
          occurred_at: '2026-07-01T00:00:00Z',
        },
      ],
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('Half Written')
  })

  it('既没标过、触点也没说过 → 不打扰', async () => {
    const items = await run(
      [{ id: 'c9', client_id: CLIENT, display_name: 'Normal', do_not_contact: false }],
      [{ contact_id: 'c9', client_id: CLIENT, raw: 'not intending to go' }],
    )
    expect(items).toHaveLength(0)
  })
})
