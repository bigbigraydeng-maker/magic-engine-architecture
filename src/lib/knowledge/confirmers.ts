/**
 * Client Knowledge Base — customer-side confirmer registry (design doc §9.14
 * E.2 step 2: "新增'客户确认人登记'：只有全局管理员能登记，留审计；确认人
 * 必须在草稿批准前登记；登记人 ≠ 批草稿的人").
 *
 * Without this table, `read.ts`'s dual-sign gate only checks "confirmer ≠
 * approver" and "confirmer is not a global admin" — any other email could
 * be written into `client_confirmed_by_email` and pass. This closes that
 * gap: a confirmation only counts if the confirmer's email was registered
 * for that client (by a global admin) BEFORE the confirmation was recorded.
 */

import type { KnowledgeSupabaseClient } from './db-client'
import { KnowledgeReadError } from './errors'

interface ConfirmerRow {
  confirmer_email: string
}

/**
 * Registered, non-revoked confirmer emails for `clientId`, lower-cased.
 *
 * 🔴 Fail-closed: a DB error throws (never resolves to "no registered
 * confirmers", which would silently make every customer_reply dual-sign
 * check fail — indistinguishable from "legitimately nobody registered yet"
 * only from the caller's point of view, but the two must not be conflated
 * with an actual read failure).
 */
export async function getRegisteredConfirmerEmails(
  clientId: string,
  sb: KnowledgeSupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await sb
    .from('client_knowledge_confirmers')
    .select('confirmer_email')
    .eq('client_id', clientId)
    .is('revoked_at', null)

  if (error) throw new KnowledgeReadError('读取客户知识库确认人登记（client_knowledge_confirmers）', error)

  // 桥接 unknown：同 entitlement.ts / read.ts 的 defaultSupabase() 深层泛型限制
  // （supabase-js 泛型链过深，tsc 结构比对 "excessively deep"）。实测：本机 PG
  // 沙盘对着真实 client_knowledge_confirmers 表跑过同样的 select，列名
  // confirmer_email 跟 ConfirmerRow 逐一核对一致。
  const rows = (data ?? []) as unknown as ConfirmerRow[]
  // 🔴 魏征复审（2026-09-14）：跟 read.ts 的比较标准对齐——必须 trim 再
  // lower-case，否则登记时留了尾随空格的邮箱会跟 read.ts 里 trim 过的确认人
  // 邮箱对不上，登记形同没登记。
  return new Set(rows.map((r) => r.confirmer_email.trim().toLowerCase()))
}
