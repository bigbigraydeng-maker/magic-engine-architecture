/**
 * 台账落库适配器（Issue #930 store adapter）单测。
 *
 * 🔴 每一条都拿「除被测那一项外全部正常」的输入直撞被测点。
 *    两处关键变异证据在文件末尾单列（空库闸 / 租户隔离），删掉对应实现那两条必须转红。
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ClientSitePagesInventoryStore, InventoryStoreError, CRAWL_STATUS_CRAWLED } from '../store'
import { FakeSupabase, type FakeRow, type FakeSupabaseOptions } from './fake-supabase'
import type { AcceptedPageRecord } from '../../canonical-inventory'

const TARGET = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function makePage(over: Partial<AcceptedPageRecord> = {}): AcceptedPageRecord {
  return {
    canonicalUrl: 'https://example.com/a',
    path: '/a',
    title: 'Page A',
    markdown: '# A\nbody',
    wordCount: 42,
    pageType: 'service',
    topics: ['t1', 't2'],
    primaryKeyword: 'kw',
    classificationConfidence: 0.87,
    hasGeoBlock: true,
    geoDetectionMethod: 'heuristic',
    geoConfidence: 0.5,
    crawledAt: '2026-08-17T01:00:00.000Z',
    ...over,
  }
}

function storeWith(options: FakeSupabaseOptions = {}): { store: ClientSitePagesInventoryStore; db: FakeSupabase } {
  const db = new FakeSupabase(options)
  const store = new ClientSitePagesInventoryStore({ client: db as unknown as SupabaseClient })
  return { store, db }
}

function seedRow(clientId: string, url: string): FakeRow {
  return { client_id: clientId, url, crawl_status: 'crawled' }
}

describe('countExistingPages', () => {
  it('按 client_id 计数，别的租户的行不算进来', async () => {
    const { store } = storeWith({ seed: [seedRow(OTHER, 'https://o.com/1'), seedRow(TARGET, 'https://t.com/1')] })
    expect(await store.countExistingPages(TARGET)).toBe(1)
    expect(await store.countExistingPages(OTHER)).toBe(1)
  })

  it('读失败一律抛，绝不返回 0', async () => {
    const { store } = storeWith({ countError: 'connection reset' })
    await expect(store.countExistingPages(TARGET)).rejects.toThrow(InventoryStoreError)
    await expect(store.countExistingPages(TARGET)).rejects.toThrow(/count_failed|读不到/)
  })

  it('null count 且无 error 也抛（不当成 0）', async () => {
    const { store } = storeWith({ countReturnsNull: true })
    await expect(store.countExistingPages(TARGET)).rejects.toThrow(/count_null|null count/)
  })
})

describe('writeAcceptedPages · 字段映射', () => {
  it('13 字段精确映射到现有列', async () => {
    const { store, db } = storeWith()
    await store.writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
    expect(db.rows).toHaveLength(1)
    const row = db.rows[0]
    expect(row).toMatchObject({
      client_id: TARGET,
      url: 'https://example.com/a',
      path: '/a',
      title: 'Page A',
      markdown_content: '# A\nbody',
      word_count: 42,
      page_type: 'service',
      topics: ['t1', 't2'],
      primary_keyword: 'kw',
      classification_confidence: 0.87,
      has_geo_block: true,
      geo_detection_method: 'heuristic',
      geo_confidence: 0.5,
      crawled_at: '2026-08-17T01:00:00.000Z',
    })
  })

  it('crawl_status 补 「crawled」（下游只认这个值）', async () => {
    const { store, db } = storeWith()
    await store.writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
    expect(db.rows[0].crawl_status).toBe(CRAWL_STATUS_CRAWLED)
    expect(db.rows[0].crawl_status).toBe('crawled')
  })

  it('status_code 故意不写（留空 = 诚实未知）', async () => {
    const { store, db } = storeWith()
    await store.writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
    expect('status_code' in db.rows[0]).toBe(false)
  })

  it('返回实际写进去的 url（供激活方精确对账，不是入参回声）', async () => {
    const { store } = storeWith()
    const written = await store.writeAcceptedPages({
      clientId: TARGET,
      pages: [makePage({ canonicalUrl: 'https://example.com/a', path: '/a' }), makePage({ canonicalUrl: 'https://example.com/b', path: '/b' })],
      requireEmptyInventory: true,
    })
    expect([...written].sort()).toEqual(['https://example.com/a', 'https://example.com/b'])
  })
})

describe('writeAcceptedPages · page_type 收敛到 CHECK 允许值', () => {
  // 变异证据：把 store 里 toAllowedPageType(page.pageType) 改回 page.pageType（不映射）→
  // 'landing' 会撞假件的 page_type CHECK(23514) → 下面第 1 条转红。假件建模了真实 CHECK。
  it('landing→home、contact→other、合法值原样', async () => {
    const { store, db } = storeWith()
    await store.writeAcceptedPages({
      clientId: TARGET,
      pages: [
        makePage({ canonicalUrl: 'https://example.com/home', path: '/', pageType: 'landing' }),
        makePage({ canonicalUrl: 'https://example.com/contact', path: '/contact', pageType: 'contact' }),
        makePage({ canonicalUrl: 'https://example.com/svc', path: '/svc', pageType: 'service' }),
      ],
      requireEmptyInventory: true,
    })
    const byUrl = Object.fromEntries(db.rows.map((r) => [r.url, r.page_type]))
    expect(byUrl['https://example.com/home']).toBe('home')
    expect(byUrl['https://example.com/contact']).toBe('other')
    expect(byUrl['https://example.com/svc']).toBe('service')
  })

  it('认不出来的 page_type → fail-closed 抛 unmappable_page_type，一行不写', async () => {
    const { store, db } = storeWith()
    const err = await store
      .writeAcceptedPages({ clientId: TARGET, pages: [makePage({ pageType: 'nonsense' })], requireEmptyInventory: true })
      .catch((e) => e)
    expect(err).toBeInstanceOf(InventoryStoreError)
    expect(err.code).toBe('unmappable_page_type')
    expect(db.rows).toHaveLength(0)
  })

  it('原型链键（constructor/__proto__/toString）也走 fail-closed，不绕过映射', async () => {
    const { store, db } = storeWith()
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const err = await store
        .writeAcceptedPages({ clientId: TARGET, pages: [makePage({ pageType: evil })], requireEmptyInventory: true })
        .catch((e) => e)
      expect(err, `pageType=${evil} 应 fail-closed`).toBeInstanceOf(InventoryStoreError)
      expect(err.code).toBe('unmappable_page_type')
    }
    expect(db.rows).toHaveLength(0)
  })

  it('假件确实建模了 page_type CHECK（非法值被 23514 拒）', async () => {
    // 直接往假件塞一个非法 page_type 的插入，确认它像 Postgres 一样拒（自证 CHECK 建模非空跑）。
    const db = new FakeSupabase()
    const { error } = await db
      .from('client_site_pages')
      .insert([{ client_id: TARGET, url: 'u', path: '/u', page_type: 'landing', crawl_status: 'crawled' }])
      .select('url')
    expect(error?.code).toBe('23514')
    expect(db.rows).toHaveLength(0)
  })
})

describe('writeAcceptedPages · 唯一约束与写错', () => {
  it('抓取后、写入前有并发写入撞 url → 整批回滚，报 inventory_not_empty，touched=false', async () => {
    // onBeforeInsert 模拟另一次激活在空隙里塞了同一条 url。
    const { store, db } = storeWith({
      onBeforeInsert: (rows) => rows.push(seedRow(TARGET, 'https://example.com/a')),
    })
    const err = await store
      .writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
      .catch((e) => e)
    expect(err).toBeInstanceOf(InventoryStoreError)
    expect(err.code).toBe('inventory_not_empty')
    expect(err.inventoryTouched).toBe(false)
    // 撞约束 = 整批回滚，只剩并发写入那一条，本次的没进去。
    expect(db.rows.filter((r) => r.crawl_status === 'crawled')).toHaveLength(1)
  })

  it('批内自撞（两条同 url）也整批回滚', async () => {
    const { store, db } = storeWith()
    const dup = makePage({ canonicalUrl: 'https://example.com/dup', path: '/dup' })
    const err = await store
      .writeAcceptedPages({ clientId: TARGET, pages: [dup, dup], requireEmptyInventory: true })
      .catch((e) => e)
    expect(err.code).toBe('inventory_not_empty')
    expect(db.rows).toHaveLength(0)
  })

  it('普通库错 → write_failed，touched=true（库里可能已有半批，需人工核对）', async () => {
    const { store } = storeWith({ writeError: { message: 'deadlock detected' } })
    const err = await store
      .writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
      .catch((e) => e)
    expect(err.code).toBe('write_failed')
    expect(err.inventoryTouched).toBe(true)
  })
})

describe('writeAcceptedPages · requireEmptyInventory 语义', () => {
  it('flag=false 时不跑空库闸（同租户不同 url 直接追加）', async () => {
    const { store, db } = storeWith({ seed: [seedRow(TARGET, 'https://example.com/existing')] })
    const written = await store.writeAcceptedPages({
      clientId: TARGET,
      pages: [makePage({ canonicalUrl: 'https://example.com/new', path: '/new' })],
      requireEmptyInventory: false,
    })
    expect(written).toEqual(['https://example.com/new'])
    expect(db.rows).toHaveLength(2)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 变异证据 1 · 空库闸：flag=true 且本租户非空 → 必须拒写
//   删掉 writeAcceptedPages 里的空库 count 检查 → 这条转红（会写进去而不是抛）。
// ───────────────────────────────────────────────────────────────────────────
describe('变异证据 · 空库闸', () => {
  it('本租户台账非空时，首次激活拒写、一行不加', async () => {
    const { store, db } = storeWith({ seed: [seedRow(TARGET, 'https://example.com/old')] })
    const err = await store
      .writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
      .catch((e) => e)
    expect(err).toBeInstanceOf(InventoryStoreError)
    expect(err.code).toBe('inventory_not_empty')
    expect(db.rows).toHaveLength(1) // 只有预置那条，本次没写
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 变异证据 2 · 租户隔离
//   (a) 去掉 count 的 client_id 过滤 → 别租户的行会让本租户「看起来非空」→ 下面第 1 条转红。
//   (b) 写入不盖入参 client_id（改成硬编码 / 取自 record）→ 第 2 条转红。
// ───────────────────────────────────────────────────────────────────────────
describe('变异证据 · 租户隔离', () => {
  it('别的租户塞满了行，本租户仍算空、首次激活照写', async () => {
    const { store, db } = storeWith({
      seed: [seedRow(OTHER, 'https://o.com/1'), seedRow(OTHER, 'https://o.com/2'), seedRow(OTHER, 'https://o.com/3')],
    })
    const written = await store.writeAcceptedPages({ clientId: TARGET, pages: [makePage()], requireEmptyInventory: true })
    expect(written).toEqual(['https://example.com/a'])
    expect(db.rows.filter((r) => r.client_id === TARGET)).toHaveLength(1)
  })

  it('写入的 client_id 只来自入参，不串租户', async () => {
    const { store, db } = storeWith()
    await store.writeAcceptedPages({ clientId: TARGET, pages: [makePage(), makePage({ canonicalUrl: 'https://example.com/b', path: '/b' })], requireEmptyInventory: true })
    expect(db.rows.every((r) => r.client_id === TARGET)).toBe(true)
    expect(db.rows.some((r) => r.client_id === OTHER)).toBe(false)
  })
})
