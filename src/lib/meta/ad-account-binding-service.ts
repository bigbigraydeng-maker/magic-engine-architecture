/**
 * PATCH /api/clients/[id]/meta-ad-account 的业务流程（AD-SEC-3）。
 * 路由只管鉴权分流和把结果转成 HTTP；为什么要这几道闸见 ad-account-binding.ts。
 *
 * 流程一览：
 *   内部员工 bind  → 令牌 → Graph 核实 → 跨客户重复检查 → [preview 到此为止]
 *                   → 审计 authorized（写不进去 = 拒绝）→ 写 clients + 镜像表 → 审计 applied
 *   内部员工 clear → 审计 authorized → 清 clients + 降级镜像主账户 → 审计 applied
 *   内部员工 dismiss_request → 审计 request_dismissed
 *   客户成员提交   → 不写任何绑定，只记 requested_by_client，交给每日待办
 */

import { supabaseAdmin } from '@/lib/supabase'
import { insertBindingAudit, finishBindingAudit, recordRejectedBinding } from '@/lib/clients/binding-audit'
import { listPendingBindingRequests } from '@/lib/clients/binding-requests'
import { resolveMetaTokenForClient, type MetaTokenSource } from './token-manager'
import {
  verifyAdAccountAccessible, findOtherClientRegistrations,
  type VerifiedAdAccount, type OtherClientRegistration,
} from './ad-account-binding'

export interface ServiceResult {
  status: number
  body: Record<string, unknown>
}

export interface BindOptions {
  clientId: string
  actorEmail: string
  adAccountId: string
  preview: boolean
  override: { reason: string } | null
}

const KIND = 'meta_ad_account' as const
const MIN_OVERRIDE_REASON = 10

/** body 里的覆盖参数 → null（未覆盖）/ {reason} / 抛错（要覆盖但原因不够）。 */
export function parseOverride(body: { allow_shared_account?: unknown; override_reason?: unknown }) {
  if (body.allow_shared_account !== true) return null
  const reason = typeof body.override_reason === 'string' ? body.override_reason.trim() : ''
  if (reason.length < MIN_OVERRIDE_REASON) {
    throw new Error(`共用账户需要写清原因（至少 ${MIN_OVERRIDE_REASON} 个字）`)
  }
  return { reason: reason.slice(0, 500) }
}

async function readPrimary(clientId: string): Promise<{ value: string | null } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Client not found' }
  const raw = (data as { meta_ad_account_id: unknown }).meta_ad_account_id
  return { value: typeof raw === 'string' && raw.trim() ? raw : null }
}

interface Checked {
  account: VerifiedAdAccount
  tokenSource: MetaTokenSource
  sharedWith: OtherClientRegistration[]
}

/** 令牌 + Graph + 重复检查。返回 ServiceResult = 已拒绝（拒绝原因已尽力审计）。 */
async function runChecks(opts: BindOptions): Promise<Checked | ServiceResult> {
  const base = { client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail,
    action: 'bind' as const, requested_value: opts.adAccountId }

  const token = await resolveMetaTokenForClient(opts.clientId)
  if (!token) {
    if (!opts.preview) await recordRejectedBinding({ ...base, outcome: 'rejected_no_token' })
    return { status: 424, body: { error: '这个客户没有可用的 Meta 令牌，无法核实账户，已拒绝保存。', reason: 'no_meta_token' } }
  }

  const verified = await verifyAdAccountAccessible(opts.adAccountId, token.token)
  if (!verified.ok) {
    if (!opts.preview) {
      await recordRejectedBinding({ ...base, outcome: 'rejected_graph', token_source: token.source, detail: `${verified.kind}: ${verified.detail}` })
    }
    const status = verified.kind === 'graph_unavailable' ? 502 : 422
    return { status, body: { error: 'Meta 读不到这个广告账户（号填错了，或 ME 没有这个账户的权限），已拒绝保存。', reason: verified.kind } }
  }

  let sharedWith: OtherClientRegistration[]
  try {
    sharedWith = await findOtherClientRegistrations(opts.clientId, verified.account.id)
  } catch (err) {
    return { status: 500, body: { error: `查不到其他客户的账户登记，无法确认有没有重复，已拒绝保存：${err instanceof Error ? err.message : String(err)}`, reason: 'duplicate_check_failed' } }
  }
  return { account: verified.account, tokenSource: token.source, sharedWith }
}

export async function bindAdAccount(opts: BindOptions): Promise<ServiceResult> {
  const checked = await runChecks(opts)
  if ('status' in checked) return checked
  const { account, tokenSource, sharedWith } = checked
  const summary = { account, token_source: tokenSource, shared_with: sharedWith }

  if (opts.preview) return { status: 200, body: { preview: true, ...summary } }

  if (sharedWith.length > 0 && !opts.override) {
    await recordRejectedBinding({
      client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail, action: 'bind',
      outcome: 'rejected_duplicate', requested_value: account.id, token_source: tokenSource,
      shared_with_client_ids: sharedWith.map(s => s.client_id),
    })
    return { status: 409, body: { error: '这个广告账户已经登记在别的客户名下，已拒绝保存。', reason: 'account_registered_to_other_client', ...summary } }
  }

  const prev = await readPrimary(opts.clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail, action: 'bind',
    outcome: 'authorized', previous_value: prev.value, requested_value: account.id,
    token_source: tokenSource, graph_account: { ...account },
    shared_with_client_ids: sharedWith.length ? sharedWith.map(s => s.client_id) : null,
    override_reason: sharedWith.length ? opts.override?.reason ?? null : null,
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有保存：${audit.error}`, reason: 'audit_unavailable' } }
  }

  const writeErr = await writePrimary(opts.clientId, account.id)
  if (writeErr) {
    await finishBindingAudit(audit.id, 'write_failed', writeErr)
    return { status: 500, body: { error: `保存失败：${writeErr}`, reason: 'write_failed' } }
  }
  await finishBindingAudit(audit.id, 'applied')
  return { status: 200, body: { success: true, ad_account_id: account.id, ...summary } }
}

/**
 * 写 clients.meta_ad_account_id 并镜像到 client_meta_ad_accounts 的主账户行。
 * 返回错误文字 / null。镜像失败也算失败：否则新账户没登记进多账户表、
 * 旧主账户还挂着，界面却显示「已保存」。
 */
async function writePrimary(clientId: string, next: string | null): Promise<string | null> {
  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ meta_ad_account_id: next })
    .eq('id', clientId)
  if (updateErr) return `clients: ${updateErr.message}`

  // 降级旧主账户（不删除：已登记的第二账户 / 前主账户仍受每日安全巡检覆盖）。
  const { error: demoteErr } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .update({ is_primary: false })
    .eq('client_id', clientId)
    .eq('is_primary', true)
  if (demoteErr) return `client_meta_ad_accounts demote: ${demoteErr.message}`
  if (!next) return null

  // 已登记过的账户（如 CTS 官方账户种子行）可能带真实标签 —— 提升为主账户时保留，
  // 不覆盖成默认值（魏征 2026-09-13）。
  const { data: existingRow } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('label')
    .eq('client_id', clientId)
    .eq('ad_account_id', next)
    .maybeSingle()
  const label = (existingRow as { label?: string | null } | null)?.label ?? '主账户'

  const { error: upsertErr } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .upsert(
      { client_id: clientId, ad_account_id: next, is_primary: true, label },
      { onConflict: 'client_id,ad_account_id' },
    )
  return upsertErr ? `client_meta_ad_accounts upsert: ${upsertErr.message}` : null
}

export async function clearAdAccount(clientId: string, actorEmail: string): Promise<ServiceResult> {
  const prev = await readPrimary(clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail, action: 'clear',
    outcome: 'authorized', previous_value: prev.value, requested_value: null,
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有清空：${audit.error}`, reason: 'audit_unavailable' } }
  }

  const writeErr = await writePrimary(clientId, null)
  if (writeErr) {
    await finishBindingAudit(audit.id, 'write_failed', writeErr)
    return { status: 500, body: { error: `清空失败：${writeErr}`, reason: 'write_failed' } }
  }
  await finishBindingAudit(audit.id, 'applied')
  return { status: 200, body: { success: true, ad_account_id: null } }
}

export async function dismissBindingRequest(clientId: string, actorEmail: string): Promise<ServiceResult> {
  const res = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail,
    action: 'dismiss_request', outcome: 'request_dismissed',
  })
  if ('error' in res) return { status: 500, body: { error: `记录失败：${res.error}` } }
  return { status: 200, body: { success: true, dismissed: true } }
}

/**
 * 客户成员（含自助客户、受限管理员）提交的账户号：**不写绑定**，记一笔待核实，
 * 返回 403 让界面说清楚「已收到、FDE 核实后接上」。
 */
export async function recordClientRequest(
  clientId: string,
  actorEmail: string,
  adAccountId: string,
): Promise<ServiceResult> {
  const denied = {
    error: 'Only the Magic Lab team can connect an ad account. We have noted this number and will verify it with you.',
    reason: 'fde_verification_required',
  }
  // 这个客户当前待处理的请求已经是同一个人交的同一个号 → 不重复插（防刷新重交刷行）。
  try {
    const [pending] = await listPendingBindingRequests(supabaseAdmin, KIND, new Date(), [clientId])
    if (pending && pending.requested_value === adAccountId && pending.actor_email === actorEmail) {
      return { status: 403, body: { ...denied, request_recorded: true } }
    }
  } catch {
    // 读不到就照常插一行：多一行重复比漏记一条客户提交好。
  }
  const recorded = await recordRequestRow(clientId, actorEmail, adAccountId)
  return { status: 403, body: { ...denied, request_recorded: recorded } }
}

async function recordRequestRow(clientId: string, actorEmail: string, value: string): Promise<boolean> {
  const res = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail,
    action: 'request', outcome: 'requested_by_client', requested_value: value,
  })
  if ('error' in res) {
    console.error('[meta-ad-account] failed to record client request:', res.error)
    return false
  }
  return true
}
