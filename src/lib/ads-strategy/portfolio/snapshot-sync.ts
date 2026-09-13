/**
 * 广告设置快照 · 取数与写库（ads IMPACT 阶段 1，设计 §2.1 / §14 M1 / M9）。
 *
 * 🔴 对 Meta 只读（`@/lib/meta/entity-settings` 只有 GET）。对库只 insert 快照行。
 * 🔴 共用账户读侧隔离（M9）：同一广告账户登记给多个客户时只写 account 级并标 shared_account，
 *    绝不把另一客户的系列/广告组/广告/受众写进本客户名下。
 *
 * 每个账户独立降级：一个账户读失败不影响其它账户；读不全的层级**不写**（否则「读失败」
 * 会被记成「实体没了」，下一轮又全量 changed，快照历史变成噪音）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import {
  fetchAccountSettings,
  fetchAdSettings,
  fetchAdsetSettings,
  fetchCampaignSettings,
  fetchCustomAudiences,
  type GraphReadResult,
} from '@/lib/meta/entity-settings'
import {
  normalizeAccount,
  normalizeAd,
  normalizeAdset,
  normalizeAudience,
  normalizeCampaign,
  selectRowsToWrite,
  type LatestSnapshotRef,
  type SnapshotContext,
  type SnapshotLevel,
  type SnapshotRowDraft,
} from './snapshot'

export function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

export interface AccountSnapshotResult {
  ad_account_id: string
  shared_account: boolean
  rows_written: number
  /** 读不全、因此本轮跳过写入的层级 */
  skipped_levels: Array<{ level: SnapshotLevel; error: string }>
}

export interface ClientSnapshotResult {
  client_id: string
  success: boolean
  accounts: AccountSnapshotResult[]
  error?: string
}

/** 按 IANA 时区切「哪一天」。时区缺失时按 UTC，并在调用处体现为可比性风险。 */
export function dayKeyIn(timezone: string | null): (iso: string) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return (iso: string) => fmt.format(new Date(iso))
}

/**
 * 这些账户里，哪些同时登记给了别的客户。查询出错时 fail closed：全部当共用处理
 * （宁可只写账户级，也不能把别人的实体写进来）。
 */
export async function findSharedAccounts(clientId: string, accountIds: string[]): Promise<{ shared: Set<string>; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('client_id, ad_account_id')
  if (error) {
    return { shared: new Set(accountIds.map(normalizeAccountId)), error: error.message }
  }
  const owners = new Map<string, Set<string>>()
  for (const r of (data ?? []) as Array<{ client_id: string; ad_account_id: string }>) {
    const key = normalizeAccountId(r.ad_account_id)
    const set = owners.get(key) ?? new Set<string>()
    set.add(r.client_id)
    owners.set(key, set)
  }
  const shared = new Set<string>()
  for (const id of accountIds) {
    const set = owners.get(normalizeAccountId(id))
    if (set && [...set].some(c => c !== clientId)) shared.add(normalizeAccountId(id))
  }
  return { shared }
}

async function loadLatest(clientId: string, adAccountId: string): Promise<{ rows: LatestSnapshotRef[]; error?: string }> {
  // 每实体最新一行：取最近 3 天窗口足够（每天至少一行 daily），按时间倒序在内存里去重。
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('level, entity_id, settings_hash, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(5000)
  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []) as LatestSnapshotRef[] }
}

function takeLevel<T>(
  level: SnapshotLevel,
  read: GraphReadResult<T>,
  map: (item: T) => SnapshotRowDraft,
  drafts: SnapshotRowDraft[],
  skipped: AccountSnapshotResult['skipped_levels'],
): void {
  if (!read.complete) {
    skipped.push({ level, error: read.error?.message ?? 'incomplete read' })
    return
  }
  for (const item of read.rows) drafts.push(map(item))
}

export async function captureAccountSnapshots(
  clientId: string,
  adAccountId: string,
  accessToken: string,
  opts: { shared: boolean; reason?: 'scheduled' | 'kernel_pre' | 'kernel_post'; now?: Date },
): Promise<AccountSnapshotResult> {
  const result: AccountSnapshotResult = { ad_account_id: adAccountId, shared_account: opts.shared, rows_written: 0, skipped_levels: [] }

  const account = await fetchAccountSettings(adAccountId, accessToken)
  if (!account.complete || account.rows.length === 0) {
    result.skipped_levels.push({ level: 'account', error: account.error?.message ?? 'account unreadable' })
    return result
  }
  const acct = account.rows[0]
  const ctx: SnapshotContext = { clientId, adAccountId, currency: acct.currency ?? null, sharedAccount: opts.shared }
  const drafts: SnapshotRowDraft[] = [normalizeAccount(ctx, acct)]

  if (!opts.shared) {
    const [campaigns, adsets, ads, audiences] = await Promise.all([
      fetchCampaignSettings(adAccountId, accessToken),
      fetchAdsetSettings(adAccountId, accessToken),
      fetchAdSettings(adAccountId, accessToken),
      fetchCustomAudiences(adAccountId, accessToken),
    ])
    takeLevel('campaign', campaigns, c => normalizeCampaign(ctx, c), drafts, result.skipped_levels)
    takeLevel('adset', adsets, s => normalizeAdset(ctx, s), drafts, result.skipped_levels)
    takeLevel('ad', ads, a => normalizeAd(ctx, a), drafts, result.skipped_levels)
    takeLevel('audience', audiences, a => normalizeAudience(ctx, a), drafts, result.skipped_levels)
  }

  const latest = await loadLatest(clientId, adAccountId)
  if (latest.error) {
    // 读不到上一行就判不了「变没变」——宁可本轮不写，也不全量写成 changed 污染历史。
    result.skipped_levels.push({ level: 'account', error: `latest snapshot read failed: ${latest.error}` })
    return result
  }

  const capturedAt = (opts.now ?? new Date()).toISOString()
  const rows = selectRowsToWrite(drafts, latest.rows, {
    capturedAt,
    dayKey: dayKeyIn(acct.timezone_name ?? null),
    reason: opts.reason,
  })
  if (rows.length === 0) return result

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('ad_entity_snapshots').insert(rows.slice(i, i + 500))
    if (error) {
      result.skipped_levels.push({ level: 'account', error: `insert failed: ${error.message}` })
      return result
    }
    result.rows_written += Math.min(500, rows.length - i)
  }
  return result
}

/**
 * 抓一个客户全部登记账户的设置快照。阶段 2 内核运行前后以 kernel_pre / kernel_post 调用。
 */
export async function captureClientSnapshots(
  clientId: string,
  accountIds: string[],
  opts: { reason?: 'scheduled' | 'kernel_pre' | 'kernel_post'; now?: Date } = {},
): Promise<ClientSnapshotResult> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return { client_id: clientId, success: false, accounts: [], error: 'no Meta token configured for client' }

  const { shared, error: sharedError } = await findSharedAccounts(clientId, accountIds)
  const accounts: AccountSnapshotResult[] = []
  for (const id of accountIds) {
    accounts.push(await captureAccountSnapshots(clientId, id, token, {
      shared: shared.has(normalizeAccountId(id)),
      reason: opts.reason,
      now: opts.now,
    }))
  }
  const success = accounts.every(a => a.skipped_levels.length === 0) && !sharedError
  return {
    client_id: clientId,
    success,
    accounts,
    error: sharedError ? `shared-account lookup failed (treated all as shared): ${sharedError}` : undefined,
  }
}
