/**
 * Magic Engine 2.0 · 台账落库适配器（Issue #930 · WP —— store adapter）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个文件补的是唯一缺口
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `canonical-inventory/` 是纯契约层：发现 / 归一 / 计划 / 复核 / 激活闸全在那里，
 * 但它**故意不提供** `CanonicalInventoryStore` 的实现（见 `adapters.ts` 文件头、
 * `canonical-inventory/__tests__/architecture.test.ts:112`）—— 那层任何路径都写不到生产台账。
 * `activateReviewedPlan()` 需要一个注入进来的 store 才能落库，全仓无实现方。
 *
 * 本模块就是那个实现方，且**单独成一个目录**：契约层的「无写入路径」不变，
 * 新获授权的写能力单独放这里、单独复审。激活本身仍是另一次授权（PO `go 写入`）。
 *
 * 🔴 落库口注入 `SupabaseClient`（照 `src/lib/kernel/store.ts` / `src/lib/geo-baseline/store.ts`）：
 *    store 类自己不 import `@/lib/supabase`，于是「只有被接受的 canonical URL 能到达持久化」
 *    「空库闸真的挡得住」这两条能在内存里拿假 supabase 直接测，不碰生产库。
 *    需要一个现成客户端时用本文件的 `createInventoryStore()` —— 它在**函数体内**建客户端，
 *    不在模块顶层。
 *
 * 🔴 租户隔离：写入的 `client_id` 只来自入参，绝不硬编码任何客户（Roman 或别人）。
 * 🔴 读失败一律抛，**绝不 `return 0`**：「查不到」和「查炸了」返回同一个值，
 *    正是这个仓库反复踩、也是激活方空库闸最怕的坑。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AcceptedPageRecord, CanonicalInventoryStore } from '../canonical-inventory'

/** 台账表。字段与列的映射见 `toInsertRow`。本次不加列、不加表、不做 migration。 */
export const TABLE_SITE_PAGES = 'client_site_pages'

/**
 * 写进 `crawl_status` 的值。
 *
 * 🔴 用 `'crawled'` 而不是别的字样：现有写入方（`job-executor.ts:198`）就写这个，
 *    而下游**只认这个**——`content-gate.ts:145`、`seo-patrol/page-signals.ts:118`、
 *    `seo-patrol/index-check.ts:85` 全部 `.eq('crawl_status', 'crawled')`。
 *    换成 `'success'` 之类，行会静静落库却对下游全部隐身（测试全绿、生产全空的经典形状）。
 */
export const CRAWL_STATUS_CRAWLED = 'crawled'

/** Postgres 唯一约束冲突码。台账建了 `unique(client_id, url)`。 */
const UNIQUE_VIOLATION = '23505'

/**
 * `page_type` 的 CHECK 允许值 —— **2026-08-17 生产实测**
 * （`client_site_pages_page_type_check`，列已从 enum 漂移成 text+CHECK；迁移文件不可信）。
 */
export const ALLOWED_PAGE_TYPES = ['service', 'blog', 'about', 'home', 'product', 'faq', 'other'] as const
export type AllowedPageType = (typeof ALLOWED_PAGE_TYPES)[number]

/**
 * 把分类器产出的 page_type 收敛到台账 CHECK 的 7 个允许值。
 *
 * 🔴 分类器（`classifier.ts` PageType）会产出 `'landing'` 与 `'contact'`，这两个**不在** CHECK 里
 *    —— 直接写会撞 `client_site_pages_page_type_check`、让整批激活 fail（正是本次 exit 2 的根因）。
 *    映射是显式、可复核的：语义能对上就对上（landing 是首页→`home`），对不上落 `other`。
 * 🔴 认不出来的值**不硬塞**：`toAllowedPageType` 抛错、整批 fail-closed，绝不写非法值。
 */
export const PAGE_TYPE_MAP: Readonly<Record<string, AllowedPageType>> = {
  landing: 'home', // 分类器把首页判成 'landing'，CHECK 只认 'home'
  home: 'home',
  about: 'about',
  blog: 'blog',
  product: 'product',
  service: 'service',
  faq: 'faq',
  contact: 'other', // CHECK 无 'contact'，诚实落 'other'（不假装它是 about）
  other: 'other',
}

function toAllowedPageType(raw: string): AllowedPageType {
  const mapped = PAGE_TYPE_MAP[raw.trim().toLowerCase()]
  if (mapped === undefined) {
    throw new InventoryStoreError(
      'unmappable_page_type',
      `分类产出的 page_type「${raw}」映射不到台账允许值 [${ALLOWED_PAGE_TYPES.join(', ')}] —— fail-closed，不写。`,
    )
  }
  return mapped
}

/**
 * 落库时出的事。`inventoryTouched` 说清楚失败发生在写之前还是写之中 ——
 * 照抄 geo-baseline `GeoStoreError.committed` 的语义，让激活方 / 重试判断不至于把
 * 「还没碰过库」和「库里可能已有半批」混成一句「跑挂了」。
 */
export class InventoryStoreError extends Error {
  readonly code: string
  /** 抛出这一刻，台账**有没有可能已经被这次调用改动过**。 */
  readonly inventoryTouched: boolean
  constructor(code: string, message: string, inventoryTouched = false) {
    super(message)
    this.name = 'InventoryStoreError'
    this.code = code
    this.inventoryTouched = inventoryTouched
  }
}

export interface InventoryStoreOptions {
  readonly client: SupabaseClient
}

/**
 * 把 `AcceptedPageRecord` 映射成一行 `client_site_pages`。
 *
 * 映射表（13 字段 → 现有列）：
 *   canonicalUrl→url · path→path · title→title · markdown→markdown_content ·
 *   wordCount→word_count · pageType→page_type · topics→topics ·
 *   primaryKeyword→primary_keyword · classificationConfidence→classification_confidence ·
 *   hasGeoBlock→has_geo_block · geoDetectionMethod→geo_detection_method ·
 *   geoConfidence→geo_confidence · crawledAt→crawled_at
 *
 * 🔴 `client_id` **只从入参来**，不取自 record（record 里根本没有它）—— 租户隔离的根。
 * 🔴 `crawl_status` 补 `'crawled'`（NOT NULL 且下游只认它，见上）。
 * 🔴 `status_code` **故意不写**：现有链路拿不到原始 URL 的真实 HTTP 状态
 *    （`AcceptedPageRecord` 按设计不带它），留空 = 诚实的「未知」，不拿 Jina 的 200 充数。
 */
function toInsertRow(clientId: string, page: AcceptedPageRecord): Record<string, unknown> {
  return {
    client_id: clientId,
    url: page.canonicalUrl,
    path: page.path,
    title: page.title,
    markdown_content: page.markdown,
    word_count: page.wordCount,
    page_type: toAllowedPageType(page.pageType), // 收敛到 CHECK 允许值；认不出来 fail-closed
    topics: page.topics,
    primary_keyword: page.primaryKeyword,
    classification_confidence: page.classificationConfidence,
    has_geo_block: page.hasGeoBlock,
    geo_detection_method: page.geoDetectionMethod,
    geo_confidence: page.geoConfidence,
    crawled_at: page.crawledAt,
    crawl_status: CRAWL_STATUS_CRAWLED,
  }
}

/**
 * 真实台账落库口。写入只经过它，一处调用 supabase。
 *
 * ⚠️ 原子性的边界（诚实交代）：PostgREST 给不了跨语句事务，本次又不许加 migration / RPC，
 *    所以「整租户为空」这件事做不到像 geo-baseline 那样用一个 plpgsql 事务锁死。
 *    这里给到 PostgREST 能给的最强条件写：
 *      1. 写前在同一方法里紧贴着再查一次 count，非空 fail-closed；
 *      2. 用**单条批量 `insert`（不是 upsert）**——它是一条原子语句，要么整批进、要么一行不进，
 *         且撞上 `unique(client_id, url)` 会整批回滚。于是「两次一模一样的首次激活并发」
 *         被约束原子挡死，不会各写各的。
 *    残留窗口（两次首次激活各带**互不相交**的 URL 集并发）无法在零 migration 下彻底消除，
 *    已在 PR 里标为已知边界；激活是单次人工授权动作，构造上不并发，激活方另有一次 recheck 兜。
 */
export class ClientSitePagesInventoryStore implements CanonicalInventoryStore {
  private readonly sb: SupabaseClient

  constructor(options: InventoryStoreOptions) {
    this.sb = options.client
  }

  async countExistingPages(clientId: string): Promise<number> {
    const { count, error } = await this.sb
      .from(TABLE_SITE_PAGES)
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (error !== null) {
      throw new InventoryStoreError(
        'count_failed',
        `读不到租户 ${clientId} 的台账行数：${error.message}`,
      )
    }
    if (count === null) {
      // 没 error 又没 count = 客户端行为异常。绝不当成 0 —— 那会让空库闸形同虚设。
      throw new InventoryStoreError('count_null', `台账行数查询对租户 ${clientId} 返回了 null count 且无 error`)
    }
    return count
  }

  async writeAcceptedPages(input: {
    readonly clientId: string
    readonly pages: readonly AcceptedPageRecord[]
    readonly requireEmptyInventory: boolean
  }): Promise<readonly string[]> {
    if (input.requireEmptyInventory) {
      // 紧贴写入的最后一次 count —— 见类文档：把窗口收到最窄，剩下的靠批量 insert 的约束原子性。
      const existing = await this.countExistingPages(input.clientId)
      if (existing !== 0) {
        throw new InventoryStoreError(
          'inventory_not_empty',
          `首次激活要求台账为空，租户 ${input.clientId} 实际有 ${existing} 行 —— 拒写。`,
        )
      }
    }
    return this.insertRows(input.clientId, input.pages)
  }

  /**
   * 单条批量 `insert`（不是 upsert）+ `select('url')` 取回**实际写进去**的清单。
   *
   * 🔴 用 insert 不用 upsert：首次激活撞到已存在的 URL 必须**响**，不能静默覆盖别人的行。
   *    撞 `unique(client_id, url)` ⇒ 整批回滚 ⇒ 抛 `inventory_not_empty`（并发的另一半赢了）。
   */
  private async insertRows(
    clientId: string,
    pages: readonly AcceptedPageRecord[],
  ): Promise<readonly string[]> {
    const rows = pages.map((page) => toInsertRow(clientId, page))
    const { data, error } = await this.sb.from(TABLE_SITE_PAGES).insert(rows).select('url')
    if (error !== null) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new InventoryStoreError(
          'inventory_not_empty',
          `写入撞上唯一约束（client_id, url）——台账在写入前已非空或有并发写入，整批已回滚：${error.message}`,
          false,
        )
      }
      throw new InventoryStoreError(
        'write_failed',
        `台账写入失败：${error.message}`,
        true,
      )
    }
    if (data === null) {
      throw new InventoryStoreError('write_null', '台账写入返回了 null data 且无 error —— 无法确认写进了什么', true)
    }
    // 返回**实际写进去**的 url，供激活方跟被接受集合精确对账（不是入参回声）。
    return data.map((row) => String((row as { url: unknown }).url))
  }
}

/**
 * 构造一个连到生产台账的 store。**客户端在函数体内建，不在模块顶层**（CLAUDE.md #7）。
 *
 * 🔴 复制 `supabaseAdmin` 里那句 `cache: 'no-store'`：Next 会缓存底层 fetch，
 *    而台账的 count 一旦读到缓存里的旧快照，空库闸就会拿过期状态做决策
 *    （对写操作等于重复执行，2026-08-04 讲课片连发三次就是这个坑）。
 * 🔴 只有被 PO 单独授权的 `go 写入` 调用方才 new 它；本 PR 不接任何 route / cron / UI。
 */
export function createInventoryStore(): ClientSitePagesInventoryStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new InventoryStoreError(
      'missing_env',
      'createInventoryStore 需要 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  const client = createClient(url, serviceKey, {
    global: { fetch: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, { ...init, cache: 'no-store' }) },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return new ClientSitePagesInventoryStore({ client })
}
