/**
 * Client knowledge base — conversation mining (design §3.2/§9.7/§9.8/§9.14-E.3).
 *
 * Turns real employee replies into `client_knowledge_facts` CANDIDATES. Never
 * writes anything but `status='candidate'` — approval is always a separate,
 * human step (FDE review, then client confirmation for non-general facts).
 *
 * Pipeline (§3.2): collect → merge exact-duplicate templates → redact PII →
 * extract via LLM → drop deal-specific one-offs → verify every number
 * against its source message → group into conflict clusters (including
 * against already-approved facts) → write candidates + a receipt row.
 *
 * Fail-closed budget (§9.8): every run declares max messages / max model
 * calls / max spend up front; missing any one of the three refuses to run
 * at all (`assertMiningBudget`) — there is no "unlimited" default.
 */

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'
import { jsonrepair } from 'jsonrepair'
import { getClientKnowledge } from './store'

/**
 * supabase-js 只能从字面量字符串推断 select() 的行类型；本文件的 select 都是
 * 拼接出来的普通字符串，退化成它的 GenericStringError 占位类型——跟
 * store.ts 的同一处限制一样（跟仓库里已有多处 `(data ?? []) as unknown as`
 * 写法一致：src/lib/kernel/store.ts、src/lib/kernel-approval/queries.ts、
 * src/lib/tailor-made/store.ts）。集中收口在这一个函数里，只用一处需要
 * 审查的强转，而不是每条查询各写一次。**实测过**：本机 PG 沙盘重放
 * 20260913120000/20260913180000 两条 migration 后手工 insert + select，
 * 每个调用点传入的列清单都跟对应表的真实列逐一对得上，不是凭空猜的形状。
 */
function asRows<T>(data: unknown): T[] {
  return (data ?? []) as unknown as T[]
}

// ── Budget ───────────────────────────────────────────────────────────────

export interface MiningBudget {
  maxMessages: number
  maxModelCalls: number
  maxSpendUsd: number
}

/**
 * Throws unless all three caps are present and positive. There is
 * deliberately no fallback value for a missing cap — "forgot to configure a
 * limit" and "explicitly unlimited" must never look the same (§9.8).
 */
export function assertMiningBudget(budget: Partial<MiningBudget> | null | undefined): asserts budget is MiningBudget {
  if (!budget) throw new Error('assertMiningBudget: no budget given — mining must not run unbounded')
  const { maxMessages, maxModelCalls, maxSpendUsd } = budget
  if (!maxMessages || maxMessages <= 0) {
    throw new Error('assertMiningBudget: maxMessages must be a positive number')
  }
  if (!maxModelCalls || maxModelCalls <= 0) {
    throw new Error('assertMiningBudget: maxModelCalls must be a positive number')
  }
  if (!maxSpendUsd || maxSpendUsd <= 0) {
    throw new Error('assertMiningBudget: maxSpendUsd must be a positive number')
  }
}

// ── Template merging ─────────────────────────────────────────────────────

/**
 * Merge key for "is this the same template". NFKC-normalises and collapses
 * whitespace/newlines so formatting noise doesn't fragment a template, but
 * never touches digits or words — "Under 20 kg" and "Under 10 kg" must
 * never merge (§9.7: "合并只合规范化后完全相同的文本，数字原样保留").
 */
export function normaliseTemplateKey(body: string): string {
  return body.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export interface RawMessage {
  body: string
  sentAt: string
  direction: 'inbound' | 'outbound'
  conversationId: string
}

export interface MessageTemplate {
  normalizedKey: string
  sampleBody: string
  count: number
  firstSeenAt: string
  lastSeenAt: string
  /** The customer message immediately preceding the FIRST occurrence, if any — LLM context only, not evidence. */
  precedingCustomerQuestion: string | null
}

/**
 * Group a client's outbound (employee) messages into exact-duplicate
 * templates, each carrying its occurrence count and a representative
 * preceding customer question for LLM context.
 */
export function groupMessagesIntoTemplates(messages: RawMessage[]): MessageTemplate[] {
  const byConversation = new Map<string, RawMessage[]>()
  for (const m of messages) {
    if (!byConversation.has(m.conversationId)) byConversation.set(m.conversationId, [])
    byConversation.get(m.conversationId)!.push(m)
  }
  for (const list of byConversation.values()) {
    list.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }

  const templates = new Map<string, MessageTemplate>()
  for (const list of byConversation.values()) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (m.direction !== 'outbound') continue
      const key = normaliseTemplateKey(m.body)
      if (!key) continue

      let precedingCustomerQuestion: string | null = null
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].direction === 'inbound') {
          precedingCustomerQuestion = list[j].body
          break
        }
      }

      const existing = templates.get(key)
      if (!existing) {
        templates.set(key, {
          normalizedKey: key,
          sampleBody: m.body,
          count: 1,
          firstSeenAt: m.sentAt,
          lastSeenAt: m.sentAt,
          precedingCustomerQuestion,
        })
      } else {
        existing.count += 1
        if (m.sentAt < existing.firstSeenAt) existing.firstSeenAt = m.sentAt
        if (m.sentAt > existing.lastSeenAt) existing.lastSeenAt = m.sentAt
      }
    }
  }
  return [...templates.values()].sort((a, b) => b.count - a.count)
}

// ── PII redaction ────────────────────────────────────────────────────────
//
// Deliberately aggressive (same philosophy as sensitivity.ts): over-redacting
// business text just costs the LLM a little context; under-redacting sends a
// customer's name/phone/address/order number to a third-party API. Patterns
// are shaped by REAL NAL production messages (see mining.test.ts fixtures).

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

// NZ/AU/CN mobile numbers and any other 6+ digit run — long enough to catch
// phone numbers and postal codes (real NAL postcode: "510890") without ever
// catching a business number seen in real data (largest was "NZD 656.50",
// i.e. 3 digits before the decimal point; weights/prices/percentages in this
// domain never run to 6 consecutive digits).
const LONG_DIGIT_RUN_PATTERN = /\d{6,}/g

// Order/tracking numbers: 2-6 letters immediately followed by 4-8 digits,
// e.g. NAL's real "TJJ28967" / "TJJ28037" shipping-mark codes.
const TRACKING_NUMBER_PATTERN = /\b[A-Za-z]{2,6}\d{4,8}\b/g

// A line is treated as a physical address once it contains 2+ Chinese
// administrative/street markers — matches NAL's real warehouse address
// blocks ("广东省广州市花都区花东镇...栋一楼...邮编：510890").
const ADDRESS_MARKERS = ['省', '市', '区', '镇', '村', '路', '街', '号', '栋', '幢', '单元', '室', '邮编']

function looksLikeAddressLine(line: string): boolean {
  const hits = ADDRESS_MARKERS.filter((marker) => line.includes(marker)).length
  return hits >= 2
}

export interface RedactResult {
  text: string
  hits: string[]
}

/** Strip email / phone-or-postcode / tracking-number / Chinese-address content before any text leaves ME for an LLM call. */
export function redactPersonalInfo(input: string): RedactResult {
  const hits = new Set<string>()
  const lines = input.normalize('NFKC').split('\n')

  const redactedLines = lines.map((line) => {
    if (looksLikeAddressLine(line)) {
      hits.add('address')
      return '[已抹去:地址]'
    }
    let out = line
    if (EMAIL_PATTERN.test(out)) hits.add('email')
    out = out.replace(EMAIL_PATTERN, '[已抹去:邮箱]')
    if (TRACKING_NUMBER_PATTERN.test(out)) hits.add('tracking_number')
    out = out.replace(TRACKING_NUMBER_PATTERN, '[已抹去:单号]')
    if (LONG_DIGIT_RUN_PATTERN.test(out)) hits.add('phone_or_postcode')
    out = out.replace(LONG_DIGIT_RUN_PATTERN, '[已抹去:号码]')
    return out
  })

  return { text: redactedLines.join('\n'), hits: [...hits] }
}

// ── Number provenance ────────────────────────────────────────────────────

function extractNumbers(text: string): Set<number> {
  const normalised = text.normalize('NFKC')
  const matches = normalised.match(/\d+(\.\d+)?/g) ?? []
  return new Set(matches.map(Number))
}

/**
 * Every number the candidate asserts (in its statement AND its structured
 * value) must appear, by numeric value, somewhere in `sourceText`. A
 * candidate that invents a number the source never contained is dropped,
 * never written as a candidate (§9.7 anti-hallucination guard, PITFALLS D1).
 * A candidate with no numbers at all trivially passes (nothing to verify).
 */
export function validateNumberProvenance(
  candidateStatement: string,
  structuredValue: unknown,
  sourceText: string,
): boolean {
  const candidateText = `${candidateStatement} ${JSON.stringify(structuredValue ?? '')}`
  const candidateNumbers = extractNumbers(candidateText)
  if (candidateNumbers.size === 0) return true
  const sourceNumbers = extractNumbers(sourceText)
  return [...candidateNumbers].every((n) => sourceNumbers.has(n))
}

// ── Deal-specific classification ─────────────────────────────────────────

export type CandidateSpecificity = 'template' | 'suspected_deal_specific' | 'deal_specific'

/**
 * §9.7: the model saying nothing defaults to deal-specific (fail-closed — an
 * unlabelled candidate never becomes a reusable fact); a template that only
 * ever appeared once cannot be a reusable candidate either, no matter what
 * the model says; a number that matches what the CUSTOMER themselves quoted
 * (their own weight/value) is flagged suspected rather than dropped outright
 * so a human can look at it once, not to auto-approve or auto-reject it.
 */
export function classifyCandidateSpecificity(input: {
  occurrenceCount: number
  modelSaysDealSpecific: boolean | null | undefined
  numbersMatchCustomerQuestion: boolean
}): CandidateSpecificity {
  if (input.modelSaysDealSpecific === null || input.modelSaysDealSpecific === undefined) return 'deal_specific'
  if (input.modelSaysDealSpecific === true) return 'deal_specific'
  if (input.occurrenceCount <= 1) return 'deal_specific'
  if (input.numbersMatchCustomerQuestion) return 'suspected_deal_specific'
  return 'template'
}

// ── Conflict grouping ────────────────────────────────────────────────────

export interface ConflictMember {
  origin: 'approved' | 'candidate'
  refId: string
  factKey: string
  unit: string | null
  valueSignature: string
}

export interface ConflictGroup {
  factKey: string
  unit: string | null
  members: ConflictMember[]
  hasConflict: boolean
}

/** Stable string for "is this the same asserted value" comparison, order-independent for object keys. */
export function computeValueSignature(structuredValue: unknown): string {
  if (structuredValue === null || structuredValue === undefined) return 'null'
  if (typeof structuredValue !== 'object') return JSON.stringify(structuredValue)
  const entries = Object.entries(structuredValue as Record<string, unknown>)
    .filter(([k]) => k !== 'unit')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

/**
 * Group every member sharing (factKey, unit) into one conflict group —
 * unconditionally, without trying to compare scopes (§9.14-B: "模型新提议的
 * 范围先强制与同单位全部事实归入冲突组，人定下范围后才解除" — scope
 * disambiguation is a human decision, not something this function guesses
 * at). A group is flagged `hasConflict` when it contains more than one
 * distinct asserted value.
 */
export function groupCandidatesByConflict(members: ConflictMember[]): ConflictGroup[] {
  const groups = new Map<string, ConflictMember[]>()
  for (const member of members) {
    const key = `${member.factKey} ${member.unit ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(member)
  }
  return [...groups.entries()].map(([key, groupMembers]) => {
    const [factKey, unit] = key.split(' ')
    const distinctValues = new Set(groupMembers.map((m) => m.valueSignature))
    return { factKey, unit: unit || null, members: groupMembers, hasConflict: distinctValues.size > 1 }
  })
}

// ── LLM extraction ───────────────────────────────────────────────────────

export interface ExtractedCandidate {
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: (Record<string, unknown> & { unit?: string }) | null
  isDealSpecific: boolean | null
}

// Sonnet pricing, kept in sync manually with anthropic/client.ts (which
// does not export these — they're private to that module). Used only for
// the pre-call worst-case budget estimate below, not for the actual
// receipted cost (that always comes from callClaudeChat's real usage).
const SONNET_PRICE_INPUT_PER_M_USD = 3.0
const SONNET_PRICE_OUTPUT_PER_M_USD = 15.0
const EXTRACTION_MAX_OUTPUT_TOKENS = 800

/**
 * Conservative worst-case cost of ONE extraction call, computed from the
 * prompt text BEFORE calling the model — never from what the call actually
 * cost (§9.14-B: "每次调模型前按最坏情况预估判上限，不是调完再算"; a
 * check made after the money is already spent cannot prevent overspend, it
 * can only report it). ~4 chars/token is a standard rough estimate; +200
 * tokens of headroom for the fixed system prompt.
 */
export function estimateWorstCaseExtractionCostUsd(promptText: string): number {
  const estimatedInputTokens = Math.ceil(promptText.length / 4) + 200
  return (
    (estimatedInputTokens / 1_000_000) * SONNET_PRICE_INPUT_PER_M_USD +
    (EXTRACTION_MAX_OUTPUT_TOKENS / 1_000_000) * SONNET_PRICE_OUTPUT_PER_M_USD
  )
}

const EXTRACTION_SYSTEM_PROMPT = `You extract reusable business facts an AI assistant could later say to a customer, from ONE employee reply template a business sent to real customers.

Only extract facts that are GENERALLY TRUE for this business (pricing rules, service fees, cutoff times, policies) — never a specific customer's individual quote (a computed total for one shipment, one person's exact route/weight). If the message is a one-off calculation for a specific customer, set "is_deal_specific": true and return no facts.

Every number you put in a fact (in "statement" or "structured_value") MUST appear verbatim in the source message. Never compute, round, or infer a number that is not literally written there.

Respond with ONLY a JSON object, no prose, shaped exactly like:
{
  "is_deal_specific": boolean,
  "facts": [
    {
      "fact_key": "short.stable.identifier",
      "scope": { "...": "..." },
      "statement": "human-readable sentence, in the same language as the source",
      "structured_value": { "unit": "NZD/kg", "...": "..." } | null
    }
  ]
}
If is_deal_specific is true, "facts" must be an empty array.`

export interface RawExtractionCall {
  candidates: ExtractedCandidate[]
  isDealSpecific: boolean | null
  costUsd: number
}

function parseExtractionResponse(raw: string): { isDealSpecific: boolean | null; facts: unknown[] } {
  const repaired = jsonrepair(raw.trim())
  const parsed = JSON.parse(repaired) as { is_deal_specific?: unknown; facts?: unknown }
  const facts = Array.isArray(parsed.facts) ? parsed.facts : []
  const isDealSpecific = typeof parsed.is_deal_specific === 'boolean' ? parsed.is_deal_specific : null
  return { isDealSpecific, facts }
}

function toExtractedCandidate(raw: unknown, isDealSpecific: boolean | null): ExtractedCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.fact_key !== 'string' || typeof r.statement !== 'string') return null
  return {
    factKey: r.fact_key,
    scope: r.scope && typeof r.scope === 'object' ? (r.scope as Record<string, unknown>) : {},
    statement: r.statement,
    structuredValue:
      r.structured_value && typeof r.structured_value === 'object'
        ? (r.structured_value as Record<string, unknown>)
        : null,
    isDealSpecific,
  }
}

/**
 * One LLM call per template. Industry-neutral prompt (per design §9.14-A —
 * no travel/logistics-specific vocabulary lives here; an industry hint would
 * be injected as a separate L2 layer, not built into this function).
 */
export async function extractCandidatesFromTemplate(
  templateBody: string,
  precedingCustomerQuestion: string | null,
): Promise<RawExtractionCall> {
  const redactedTemplate = redactPersonalInfo(templateBody).text
  const redactedQuestion = precedingCustomerQuestion ? redactPersonalInfo(precedingCustomerQuestion).text : null

  const userPrompt = redactedQuestion
    ? `Customer asked (for context only, do not extract facts from this line):\n${redactedQuestion}\n\nEmployee replied (extract from THIS message):\n${redactedTemplate}`
    : `Employee message (extract from this):\n${redactedTemplate}`

  const result = await callClaudeChat({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
  })

  const parsed = parseExtractionResponse(result.text)
  const candidates = parsed.facts
    .map((f) => toExtractedCandidate(f, parsed.isDealSpecific))
    .filter((c): c is ExtractedCandidate => c !== null)

  return { candidates, isDealSpecific: parsed.isDealSpecific, costUsd: result.cost_usd }
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface MiningRunReceipt {
  runId: string
  status: 'succeeded' | 'failed'
  conversationsScanned: number
  messagesScanned: number
  templatesMerged: number
  candidatesWritten: number
  conflictGroups: number
  dealSpecificSkipped: number
  provenanceRejected: number
  modelCallsUsed: number
  costUsd: number
  error?: string
}

interface ConversationRow {
  id: string
}
interface MessageRow {
  conversation_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}
interface PriorRunRow {
  high_watermark_at: string | null
}

async function fetchWatermark(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('client_knowledge_mining_runs')
    .select('high_watermark_at')
    .eq('client_id', clientId)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`fetchWatermark: read failed for client ${clientId}: ${error.message}`)
  return asRows<PriorRunRow>(data)[0]?.high_watermark_at ?? null
}

async function fetchConversationIds(clientId: string): Promise<string[]> {
  const ids: string[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchConversationIds: read failed for client ${clientId}: ${error.message}`)
    const rows = asRows<ConversationRow>(data)
    ids.push(...rows.map((r) => r.id))
    if (rows.length < pageSize) break
  }
  return ids
}

/** Reads up to `maxMessages` messages (both directions, for pairing) since `sinceIso`, paginated past PostgREST's default row cap. */
async function fetchMessagesSince(
  conversationIds: string[],
  sinceIso: string | null,
  maxMessages: number,
): Promise<RawMessage[]> {
  if (conversationIds.length === 0) return []
  const collected: RawMessage[] = []
  const pageSize = 1000
  for (let offset = 0; collected.length < maxMessages; offset += pageSize) {
    let query = supabaseAdmin
      .from('conversation_messages')
      .select('conversation_id, direction, body, sent_at')
      .in('conversation_id', conversationIds)
      .order('sent_at', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (sinceIso) query = query.gt('sent_at', sinceIso)
    const { data, error } = await query
    if (error) throw new Error(`fetchMessagesSince: read failed: ${error.message}`)
    const rows = asRows<MessageRow>(data)
    for (const row of rows) {
      if (!row.body) continue
      collected.push({
        body: row.body,
        sentAt: row.sent_at,
        direction: row.direction,
        conversationId: row.conversation_id,
      })
    }
    if (rows.length < pageSize) break
  }
  return collected.slice(0, maxMessages)
}

// §9.6's stated default recheck period for price facts. `client_knowledge_facts`
// CHECKs that every non-general fact has a valid_until (verified against a
// real local Postgres insert in this same PR — a candidate row without one
// is rejected by `sensitive_facts_need_expiry`), so a candidate MUST get one
// even before FDE review sets a considered value.
const DEFAULT_CANDIDATE_VALID_DAYS = 90

interface NewFactRow {
  client_id: string
  fact_key: string
  scope: Record<string, unknown>
  statement: string
  structured_value: unknown
  status: 'candidate'
  visibility: 'internal_only'
  sensitivity: 'price'
  valid_until: string
  source_kind: 'conversation_mining'
  evidence: Record<string, unknown>
  conflict_group_id: string | null
}

interface SurvivingCandidate {
  candidate: ExtractedCandidate
  template: MessageTemplate
  unit: string | null
}

/**
 * Run one client's mining pass end to end. Throws only on a setup failure
 * (bad budget, can't read messages at all); a failure partway through is
 * recorded on the run row and reflected in the returned receipt's `status`
 * rather than thrown, so a partial candidate set already written is not lost.
 *
 * `visibility`/`sensitivity` are deliberately conservative placeholders here
 * (`internal_only` / `price`) — a later step (FDE review) is what actually
 * classifies visibility and confirms/overrides sensitivity via
 * `resolveFactSensitivity`. Nothing written by this function is ever
 * `status='approved'`.
 */
export async function runKnowledgeMining(clientId: string, budget: MiningBudget): Promise<MiningRunReceipt> {
  assertMiningBudget(budget)

  const watermark = await fetchWatermark(clientId)
  const conversationIds = await fetchConversationIds(clientId)
  const messages = await fetchMessagesSince(conversationIds, watermark, budget.maxMessages)
  const templates = groupMessagesIntoTemplates(messages)

  const { data: runRow, error: runInsertError } = await supabaseAdmin
    .from('client_knowledge_mining_runs')
    .insert({
      client_id: clientId,
      status: 'running',
      max_messages: budget.maxMessages,
      max_model_calls: budget.maxModelCalls,
      max_spend_usd: budget.maxSpendUsd,
      low_watermark_at: watermark,
      conversations_scanned: conversationIds.length,
      messages_scanned: messages.length,
      templates_merged: templates.length,
    })
    .select('id')
    .single()
  if (runInsertError || !runRow) {
    throw new Error(`runKnowledgeMining: could not create run row: ${runInsertError?.message}`)
  }
  const runId = (runRow as { id: string }).id

  let modelCallsUsed = 0
  let costUsd = 0
  let dealSpecificSkipped = 0
  let provenanceRejected = 0
  const survivingCandidates: SurvivingCandidate[] = []
  let runError: string | undefined

  try {
    for (const template of templates) {
      if (modelCallsUsed >= budget.maxModelCalls) break

      const promptText = `${template.sampleBody} ${template.precedingCustomerQuestion ?? ''}`
      const estimatedCost = estimateWorstCaseExtractionCostUsd(promptText)
      if (costUsd + estimatedCost > budget.maxSpendUsd) break

      const extraction = await extractCandidatesFromTemplate(template.sampleBody, template.precedingCustomerQuestion)
      modelCallsUsed += 1
      costUsd += extraction.costUsd

      for (const candidate of extraction.candidates) {
        // A candidate whose numbers happen to match the CUSTOMER's own
        // question (they quoted their own weight/value) is suspicious even
        // when the model didn't flag it — the reply may just be echoing
        // that customer's specific figures back, not stating a house rate.
        const numbersMatchCustomerQuestion =
          template.precedingCustomerQuestion !== null &&
          validateNumberProvenance(candidate.statement, candidate.structuredValue, template.precedingCustomerQuestion)

        const specificity = classifyCandidateSpecificity({
          occurrenceCount: template.count,
          modelSaysDealSpecific: candidate.isDealSpecific,
          numbersMatchCustomerQuestion,
        })
        if (specificity === 'deal_specific') {
          dealSpecificSkipped += 1
          continue
        }
        if (!validateNumberProvenance(candidate.statement, candidate.structuredValue, template.sampleBody)) {
          provenanceRejected += 1
          continue
        }
        survivingCandidates.push({
          candidate,
          template,
          unit: typeof candidate.structuredValue?.unit === 'string' ? candidate.structuredValue.unit : null,
        })
      }
    }

    const approvedFacts = await getClientKnowledge(clientId, { purpose: 'internal_brief' })
    const approvedMembers: ConflictMember[] = approvedFacts.map((fact) => {
      const structured = fact.structuredValue as Record<string, unknown> | null
      return {
        origin: 'approved',
        refId: fact.id,
        factKey: fact.factKey,
        unit: typeof structured?.unit === 'string' ? structured.unit : null,
        valueSignature: computeValueSignature(fact.structuredValue),
      }
    })
    const candidateMembers: ConflictMember[] = survivingCandidates.map((entry, index) => ({
      origin: 'candidate',
      refId: String(index),
      factKey: entry.candidate.factKey,
      unit: entry.unit,
      valueSignature: computeValueSignature(entry.candidate.structuredValue),
    }))
    const conflictGroups = groupCandidatesByConflict([...approvedMembers, ...candidateMembers]).filter(
      (g) => g.hasConflict,
    )
    const conflictGroupIdByCandidateIndex = new Map<number, string>()
    for (const group of conflictGroups) {
      const groupId = randomUUID()
      for (const member of group.members) {
        if (member.origin === 'candidate') conflictGroupIdByCandidateIndex.set(Number(member.refId), groupId)
      }
    }

    const rows: NewFactRow[] = survivingCandidates.map((entry, index) => ({
      client_id: clientId,
      fact_key: entry.candidate.factKey,
      scope: entry.candidate.scope,
      statement: entry.candidate.statement,
      structured_value: entry.candidate.structuredValue,
      status: 'candidate',
      visibility: 'internal_only',
      sensitivity: 'price',
      valid_until: new Date(Date.now() + DEFAULT_CANDIDATE_VALID_DAYS * 86_400_000).toISOString(),
      source_kind: 'conversation_mining',
      evidence: {
        occurrence_count: entry.template.count,
        first_seen_at: entry.template.firstSeenAt,
        last_seen_at: entry.template.lastSeenAt,
      },
      conflict_group_id: conflictGroupIdByCandidateIndex.get(index) ?? null,
    }))

    let candidatesWritten = 0
    if (rows.length > 0) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('client_knowledge_facts')
        .upsert(rows, { onConflict: 'client_id,fact_key,scope', ignoreDuplicates: true })
        .select('id')
      if (insertError) throw new Error(`candidate write failed: ${insertError.message}`)
      candidatesWritten = asRows<{ id: string }>(inserted).length
    }

    const highWatermark = messages.length > 0 ? messages[messages.length - 1].sentAt : watermark

    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({
        status: 'succeeded',
        high_watermark_at: highWatermark,
        candidates_written: candidatesWritten,
        conflict_groups: conflictGroups.length,
        deal_specific_skipped: dealSpecificSkipped,
        provenance_rejected: provenanceRejected,
        model_calls_used: modelCallsUsed,
        cost_usd: costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return {
      runId,
      status: 'succeeded',
      conversationsScanned: conversationIds.length,
      messagesScanned: messages.length,
      templatesMerged: templates.length,
      candidatesWritten,
      conflictGroups: conflictGroups.length,
      dealSpecificSkipped,
      provenanceRejected,
      modelCallsUsed,
      costUsd,
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({
        status: 'failed',
        error: runError,
        model_calls_used: modelCallsUsed,
        cost_usd: costUsd,
        deal_specific_skipped: dealSpecificSkipped,
        provenance_rejected: provenanceRejected,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return {
      runId,
      status: 'failed',
      conversationsScanned: conversationIds.length,
      messagesScanned: messages.length,
      templatesMerged: templates.length,
      candidatesWritten: 0,
      conflictGroups: 0,
      dealSpecificSkipped,
      provenanceRejected,
      modelCallsUsed,
      costUsd,
      error: runError,
    }
  }
}
