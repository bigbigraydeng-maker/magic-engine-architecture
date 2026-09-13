/**
 * Client knowledge base — read entry point (design §3.4/§9.14).
 *
 * The ONLY place any AI-facing code (private message drafts, demand-card
 * briefs, lead classification) is allowed to read a client's approved
 * business facts from. Every consumer migrates to this one function so the
 * five parallel "AI brains" documented in the design (`master_briefs`
 * hard-coded strings, `voice_tenants.settings.brain`, etc.) collapse into a
 * single governed source — see docs/DECISIONS.md 2026-09-13.
 *
 * Fail-closed on every ambiguous path:
 *  - a database read failure THROWS. It never returns an empty list — an
 *    empty list would be indistinguishable from "this client genuinely has
 *    no facts", and a caller that treats "no facts" as "say nothing" would
 *    instead let an AI free-improvise (§3.4).
 *  - the on/off rollout switch (§9.3/§9.14-B) is checked ONLY for
 *    `customer_reply`. A read failure on the switch itself is treated as
 *    OFF, never as "assume enabled" — see `isKnowledgeRolloutEnabled`.
 *  - a non-`general` fact is never returned for `customer_reply` unless the
 *    client's confirmation is present AND still matches the fact's current
 *    content fingerprint (an edit after confirmation reverts to unconfirmed).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { computeFactFingerprint, isConfirmationCurrent } from './fingerprint'
import { FactSensitivity } from './sensitivity'

export type KnowledgePurpose = 'customer_reply' | 'internal_brief' | 'lead_classification'
export type KnowledgeVisibility = 'customer_ok' | 'internal_only' | 'forbidden'

export interface KnowledgeFact {
  id: string
  clientId: string
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: unknown
  visibility: KnowledgeVisibility
  sensitivity: FactSensitivity
  validFrom: string
  validUntil: string | null
  approvedByEmail: string | null
  approvedAt: string | null
  clientConfirmedByEmail: string | null
  clientConfirmedAt: string | null
}

export interface GetClientKnowledgeOptions {
  purpose: KnowledgePurpose
  /** Only facts whose `scope` matches every key given here (exact value match). */
  scope?: Record<string, unknown>
  /** Injectable for tests; defaults to `Date.now()`. */
  now?: Date
}

interface FactRow {
  id: string
  client_id: string
  fact_key: string
  scope: Record<string, unknown> | null
  statement: string
  structured_value: unknown
  status: string
  visibility: KnowledgeVisibility
  sensitivity: string
  valid_from: string
  valid_until: string | null
  approved_by_email: string | null
  approved_at: string | null
  client_confirmed_by_email: string | null
  client_confirmed_at: string | null
  client_confirmation_fingerprint: string | null
}

function mapRow(row: FactRow): KnowledgeFact {
  return {
    id: row.id,
    clientId: row.client_id,
    factKey: row.fact_key,
    scope: row.scope ?? {},
    statement: row.statement,
    structuredValue: row.structured_value ?? null,
    visibility: row.visibility,
    // The stored value is trusted here — resolveFactSensitivity() is applied
    // at write time (mining / FDE approval), not re-derived on every read.
    sensitivity: row.sensitivity as FactSensitivity,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    approvedByEmail: row.approved_by_email,
    approvedAt: row.approved_at,
    clientConfirmedByEmail: row.client_confirmed_by_email,
    clientConfirmedAt: row.client_confirmed_at,
  }
}

function matchesScope(factScope: Record<string, unknown>, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([key, value]) => factScope[key] === value)
}

function withinValidityWindow(fact: KnowledgeFact, now: number): boolean {
  if (new Date(fact.validFrom).getTime() > now) return false
  if (fact.validUntil && new Date(fact.validUntil).getTime() <= now) return false
  return true
}

/** Row shape a confirmation fingerprint is computed over — see fingerprint.ts. */
function toFingerprintable(fact: KnowledgeFact) {
  return {
    statement: fact.statement,
    structuredValue: fact.structuredValue,
    scope: fact.scope,
    validUntil: fact.validUntil,
    visibility: fact.visibility,
    sensitivity: fact.sensitivity,
  }
}

function isUsableForCustomerReply(fact: KnowledgeFact, row: FactRow, now: number): boolean {
  if (fact.visibility !== 'customer_ok') return false
  if (!withinValidityWindow(fact, now)) return false
  if (fact.sensitivity === 'general') return true

  if (!fact.clientConfirmedAt || !fact.clientConfirmedByEmail) return false
  return isConfirmationCurrent(toFingerprintable(fact), row.client_confirmation_fingerprint)
}

/**
 * Read a client's approved knowledge facts, filtered for the given purpose.
 * Throws on a database error — never returns an empty array to signal
 * failure (see module docstring).
 */
export async function getClientKnowledge(
  clientId: string,
  options: GetClientKnowledgeOptions,
): Promise<KnowledgeFact[]> {
  if (options.purpose === 'customer_reply') {
    const enabled = await isKnowledgeRolloutEnabled(clientId)
    if (!enabled) return []
  }

  const { data, error } = await supabaseAdmin
    .from('client_knowledge_facts')
    .select(
      'id, client_id, fact_key, scope, statement, structured_value, status, visibility, ' +
        'sensitivity, valid_from, valid_until, approved_by_email, approved_at, ' +
        'client_confirmed_by_email, client_confirmed_at, client_confirmation_fingerprint',
    )
    .eq('client_id', clientId)
    .eq('status', 'approved')

  if (error) {
    throw new Error(`getClientKnowledge: read failed for client ${clientId}: ${error.message}`)
  }

  // supabase-js 只能从字面量字符串推断 select() 的行类型；这里用字符串拼接
  // 拼出来的 select，所以退化成它的 GenericStringError 占位类型——跟仓库里
  // 现有的同类写法一样（grep '(data ?? []) as unknown as' 命中
  // src/lib/kernel/store.ts、src/lib/kernel-approval/queries.ts、
  // src/lib/tailor-made/store.ts 等多处）。实测过：本机 PG 沙盘重放
  // 20260913120000_client_knowledge_base_v1.sql 后手工 insert + select，
  // 这里列出的每一列都真实存在于该 migration 建的表里，跟 FactRow 逐列对应，
  // 不是凭空猜的形状。
  const rows = (data ?? []) as unknown as FactRow[]
  const now = (options.now ?? new Date()).getTime()

  return rows
    .filter((row) => matchesScope(row.scope ?? {}, options.scope))
    .map((row) => ({ fact: mapRow(row), row }))
    .filter(({ fact, row }) => {
      if (!withinValidityWindow(fact, now)) return false
      if (options.purpose === 'customer_reply') return isUsableForCustomerReply(fact, row, now)
      // internal_brief / lead_classification: internal consumers only, never
      // shown verbatim to a real customer, so the customer confirmation gate
      // does not apply — but `forbidden` facts (e.g. a retired tour) still
      // must not be handed to a caller that might quote them.
      return fact.visibility !== 'forbidden'
    })
    .map(({ fact }) => fact)
}

interface RolloutEventRow {
  event_type: 'enabled' | 'disabled' | 'stage_advanced'
}

/**
 * Whether AI is currently allowed to use knowledge facts in a reply shown to
 * a real customer, for this client. Read failure → false (fail-closed):
 * a transient database error must never be interpreted as "switch is on".
 */
export async function isKnowledgeRolloutEnabled(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('client_knowledge_rollout_events')
    .select('event_type')
    .eq('client_id', clientId)
    .in('event_type', ['enabled', 'disabled'])
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) return false

  const rows = (data ?? []) as RolloutEventRow[]
  return rows[0]?.event_type === 'enabled'
}
