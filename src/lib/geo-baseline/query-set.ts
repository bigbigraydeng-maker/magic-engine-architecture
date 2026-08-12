/**
 * Magic Engine 2.0 · GEO Baseline —— 查询集读取与首版写入（Issue #883 / #917 · WP04A）
 *
 * 🔴 **为什么这个文件必须存在**：`geo_batches` 的复合外键 `fk_geo_batches_set_same_client`
 *    （migration `:195-197`）指向 `geo_query_sets (client_id, id)`。**查询集行不存在，
 *    批次就插不进去。** 而全仓至今零代码碰过这两张表。
 *
 * 🔴 **锁是数据库自己打的，不是这里。** 第一个批次落地时 `geo_batches_lock_query_set`
 *    触发器（`:766-783`）在同一事务里把 `locked_at` 从 NULL 写成 `now()`，
 *    且只允许发生一次。本文件**绝不写 `locked_at`** —— 建集合时自带锁定时间会被
 *    `geo_query_sets_guard`（`:588-595`）当场拒掉，那条守卫存在的理由就是防止
 *    调用方伪造上锁时间。
 *
 * 🔴 **查询失败一律抛错，绝不 `return []`。** 一个空的查询范围会让 WP04 的
 *    `validateFrozenPlan` 报 `empty_query_scope`，看起来像「PM 还没批问题」，
 *    实际可能是数据库抖了一下 —— 两件事必须分得开。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeoMaybeUnknown } from '@/lib/geo-measurement'
import { TABLE_QUERIES, TABLE_QUERY_SETS } from './store'
import type { GeoFrozenQueryScope } from './types'

export class GeoQuerySetError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoQuerySetError'
    this.code = code
  }
}

function fail(op: string, error: { message?: string } | null): never {
  throw new GeoQuerySetError('query_failed', `[geo-baseline/query-set] ${op} 失败：${error?.message ?? '未知错误'}`)
}

/**
 * `locked_at` 是本迁移里唯一一个不走「已知值 + 未知理由」双列的可空列
 * （migration `:70-77` 把理由写死了：上锁与否是我们自己掌握的事实，
 * 不存在「不知道锁没锁」这种状态）。读取时的映射是钉死的。
 */
function mapLockedAt(value: unknown): GeoMaybeUnknown<string> {
  return typeof value === 'string' && value.length > 0
    ? { known: true, value }
    : { known: false, reason: 'not_applicable' }
}

/**
 * 按 `(client_id, query_set_version)` 读出一份冻结的查询范围。
 *
 * 只取 `is_active = true` 的问题，按 `query_key` 稳定排序 —— 顺序影响样本展开顺序，
 * 不定序的话两次运行的观测顺序会飘，排查时对不上号。
 */
export async function loadFrozenQueryScope(
  sb: SupabaseClient,
  args: { clientId: string; querySetVersion: string },
): Promise<GeoFrozenQueryScope> {
  const { data: sets, error: setErr } = await sb
    .from(TABLE_QUERY_SETS)
    .select('id, query_set_version, locked_at')
    .eq('client_id', args.clientId)
    .eq('query_set_version', args.querySetVersion)
  if (setErr) fail(`读取 ${TABLE_QUERY_SETS}`, setErr)
  if (sets === null) throw new GeoQuerySetError('null_result', `读取 ${TABLE_QUERY_SETS} 返回 null data 且无 error`)
  if (sets.length === 0) {
    throw new GeoQuerySetError(
      'query_set_not_found',
      `客户 ${args.clientId} 名下没有版本为 "${args.querySetVersion}" 的查询集。` +
        `基线不猜问题范围 —— 先由 PM 批准并落一版查询集。`,
    )
  }
  if (sets.length > 1) {
    // 库层有 UNIQUE (client_id, query_set_version)，走到这里说明读到的东西不对劲。
    throw new GeoQuerySetError('query_set_ambiguous', `查询集版本 "${args.querySetVersion}" 读到 ${sets.length} 行`)
  }
  const set = sets[0] as { id: unknown; query_set_version: unknown; locked_at: unknown }
  const querySetId = String(set.id)

  const { data: queries, error: qErr } = await sb
    .from(TABLE_QUERIES)
    .select('query_key, question_text')
    .eq('client_id', args.clientId)
    .eq('query_set_id', querySetId)
    .eq('is_active', true)
    .order('query_key', { ascending: true })
  if (qErr) fail(`读取 ${TABLE_QUERIES}`, qErr)
  if (queries === null) throw new GeoQuerySetError('null_result', `读取 ${TABLE_QUERIES} 返回 null data 且无 error`)
  if (queries.length === 0) {
    throw new GeoQuerySetError(
      'query_set_empty',
      `查询集 ${args.querySetVersion}（${querySetId}）里没有任何启用的问题。` +
        `空范围不是一个可以跑的基线。`,
    )
  }

  return {
    querySetId,
    querySetVersion: String(set.query_set_version),
    lockedAt: mapLockedAt(set.locked_at),
    queries: queries.map((row) => {
      const r = row as { query_key: unknown; question_text: unknown }
      return { queryKey: String(r.query_key), questionText: String(r.question_text) }
    }),
  }
}

export interface GeoQuerySetSeed {
  readonly clientId: string
  readonly querySetVersion: string
  readonly createdBy: string
  readonly queries: readonly {
    readonly queryKey: string
    readonly questionText: string
    readonly locale: string
    readonly market: string
  }[]
}

/**
 * 落一版**新的**查询集（PM 批准之后的一次性动作）。
 *
 * 🔴 不写 `locked_at`（见文件头）。
 * 🔴 同版本已存在就拒 —— 不 upsert、不覆盖。改问题请发新版本
 *    （GEO 契约 §4.1：一旦被用于采集，问题文本永不可改）。
 * 🔴 集合行与问题行是两条语句，中间同样有崩溃窗口；但**未锁死的集合可以整体删掉**
 *    （migration `:598-605`），所以这里的半截状态是可恢复的 —— 与批次/观测/证据
 *    那三张表不同。失败时如实告诉调用方可以删掉重来。
 */
export async function createQuerySet(sb: SupabaseClient, seed: GeoQuerySetSeed): Promise<{ querySetId: string }> {
  if (seed.queries.length === 0) {
    throw new GeoQuerySetError('empty_seed', '不允许创建一个没有问题的查询集')
  }
  const keys = new Set<string>()
  for (const q of seed.queries) {
    if (keys.has(q.queryKey)) {
      throw new GeoQuerySetError('duplicate_query_key', `queryKey "${q.queryKey}" 在种子里重复`)
    }
    keys.add(q.queryKey)
  }

  const { data: created, error: setErr } = await sb
    .from(TABLE_QUERY_SETS)
    .insert({
      client_id: seed.clientId,
      query_set_version: seed.querySetVersion,
      created_by: seed.createdBy,
    })
    .select('id')
  if (setErr) fail(`创建 ${TABLE_QUERY_SETS}`, setErr)
  if (created === null || created.length !== 1) {
    throw new GeoQuerySetError('create_set_no_row', `创建查询集没有返回恰好一行（拿到 ${created?.length ?? 'null'}）`)
  }
  const querySetId = String((created[0] as { id: unknown }).id)

  const { error: qErr } = await sb.from(TABLE_QUERIES).insert(
    seed.queries.map((q) => ({
      client_id: seed.clientId,
      query_set_id: querySetId,
      query_key: q.queryKey,
      question_text: q.questionText,
      locale: q.locale,
      locale_unknown_reason: null,
      market: q.market,
      market_unknown_reason: null,
      is_active: true,
    })),
  )
  if (qErr) {
    throw new GeoQuerySetError(
      'create_queries_failed',
      `写入 ${TABLE_QUERIES} 失败：${qErr.message}\n` +
        `查询集 ${querySetId} 已建但没有问题行。它**尚未锁定**，可以整体删掉重来` +
        `（锁定只发生在第一个批次落地时）。`,
    )
  }
  return { querySetId }
}
