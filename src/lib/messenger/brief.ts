/**
 * Customer brief generation — turns a stored Messenger thread into the card a
 * client's salesperson reads (see brief-schema.ts). Every client's threads go
 * through this same code, so nothing client-specific (name, industry facts,
 * contact details) may be hardcoded here — it comes from the `clients` row.
 *
 * Trigger rules live here rather than in the cron route so they can be tested
 * without HTTP. A brief is (re)written only when ALL of these hold:
 *   1. the thread has at least one message
 *   2. nobody has spoken for QUIET_PERIOD_MS — summarise a finished exchange,
 *      not a half-typed one
 *   3. there is no brief yet, or the thread has grown since the last one
 *   4. the thread has not already been rewritten MAX_REGENS_PER_DAY times today
 *
 * Rule 4 is the one that matters commercially: without it a fast back-and-forth
 * re-summarises on every single message.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { hasIndustryFeature } from '@/lib/clients/industry-features'
import {
  MessengerBriefSchema,
  MESSENGER_BRIEF_JSON_SCHEMA,
  BRIEF_SCHEMA_VERSION,
  type MessengerBrief,
  type TripDetails,
  type BriefContext,
} from './brief-schema'

/** Wait this long after the last message before summarising. */
export const QUIET_PERIOD_MS = 30 * 60 * 1000

/** Hard ceiling on rewrites per thread per day. */
export const MAX_REGENS_PER_DAY = 3

export interface BriefCandidate {
  conversationId: string
  clientId: string
  messageCount: number
  lastMessageAt: string | null
  existingBriefMessageCount: number | null
  regenCount: number
  regenCountDate: string | null
}

export interface StoredMessage {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string
  sentAt: string
}

/**
 * Should this thread get a (re)written brief right now?
 * Pure function — `now` is injected so the quiet period is testable.
 */
export function shouldGenerateBrief(c: BriefCandidate, now: Date): boolean {
  if (c.messageCount <= 0 || !c.lastMessageAt) return false

  const quiet = now.getTime() - new Date(c.lastMessageAt).getTime() >= QUIET_PERIOD_MS
  if (!quiet) return false

  // Nothing new to say since the last brief.
  if (c.existingBriefMessageCount !== null && c.existingBriefMessageCount >= c.messageCount) {
    return false
  }

  const today = now.toISOString().slice(0, 10)
  const countedToday = c.regenCountDate === today ? c.regenCount : 0
  return countedToday < MAX_REGENS_PER_DAY
}

function modelName(): string {
  return process.env.MESSENGER_BRIEF_MODEL ?? 'gpt-4o-mini'
}

/** Trip fields, all empty — the safe default for any non-travel business. */
const EMPTY_TRIP: TripDetails = {
  tour_interest: null,
  travel_window: null,
  party_size: null,
  departure_city: null,
  first_time_to_china: null,
  budget_signal: null,
}

const GENERIC_COMPANY_NAME = '这家企业'

/**
 * What the prompt needs to know about the client. Nothing here may be a
 * client-specific fact hardcoded in this file — it must come from the
 * `clients` row, so the same prompt is correct for every client.
 */
interface ClientProfile {
  name: string
  /** Whether "trip" fields make sense to ask for at all (reuses the same
   * industry signal that gates the tailor-made-itinerary feature). */
  isTourism: boolean
}

async function loadClientProfile(clientId: string): Promise<ClientProfile> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('name, industry')
    .eq('id', clientId)
    .maybeSingle()

  // A transient read failure must not be read as "this client doesn't exist"
  // — that would silently fall back to the generic name and null out trip
  // fields for CTS's own real threads too. brief-cycle.ts already wraps each
  // candidate in its own try/catch, so throwing here just fails that one
  // card, exactly like a `conversation_messages` read failure would.
  if (error) throw new Error(`client lookup failed for ${clientId}: ${error.message}`)

  return {
    name: (data?.name as string | null)?.trim() || GENERIC_COMPANY_NAME,
    isTourism: hasIndustryFeature((data?.industry as string | null) ?? null, 'tailor_made'),
  }
}

/**
 * Built per client — no business name, history, policy, or contact detail is
 * ever hardcoded here. Every one of those used to be a CTS-only fact baked
 * into a prompt every client's threads went through (see PR description for
 * the real NAL threads this broke). Anything client-specific must come from
 * the thread itself, or later from a client knowledge base — not from here.
 */
export function buildSystemPrompt(profile: ClientProfile): string {
  const { name, isTourism } = profile

  const tripSection = isTourism
    ? `TRIP DETAILS — this business sells travel/tours, so "trip" is worth filling in from what the CUSTOMER said:
- tour_interest may be filled from a tour the customer named or picked in a form, not from one we merely pitched. Keep the name in ENGLISH exactly as sold, even inside Chinese fields — staff match it against the website.
- travel_window / party_size / departure_city / first_time_to_china / budget_signal: only from what the CUSTOMER stated. A date offered, a price quoted, or a destination ${name} suggested is OUR information, not theirs — leave the field null.`
    : `TRIP DETAILS — ${name} is not a travel agency. Every field under "trip" must be null, even if a place name comes up in passing. Do not invent a travel interest for a customer who never expressed one.`

  return `You turn a Facebook Messenger thread between ${name} and a prospective customer into a briefing card for a ${name} salesperson.

LANGUAGE — this is the most common mistake, get it right:
- summary, customer_needs, objections, promises_made, next_action, risk_flags: write in SIMPLIFIED CHINESE. Staff read these in a Chinese interface.
- draft_reply: write in ENGLISH. It is sent to the customer.
- When quoting the customer inside a Chinese field, keep their original English in brackets.

ATTRIBUTION — the mistake that makes a card useless. Every field under "trip" and "contact" describes what the CUSTOMER told us. Anything ${name}'s side said — a date offered, a price quoted, a product suggested — is OUR information, not theirs.
- If ${name} quoted a price and the customer said nothing about money, budget_signal is null. A quote is not a budget.
- contact.phone / contact.email only from details the customer supplied (lead forms put them in the first message). Never ${name}'s own phone number or email address.

${tripSection}

GROUNDING — only use what is in the thread:
- Never invent product names, prices, dates, company history, policies, or contact details that ${name}'s side did not literally say in this thread. If you do not know it, leave it out or say a specialist will follow up.
- If the customer asked something the thread does not answer, say so in next_action and leave draft_reply asking rather than guessing.
- promises_made must capture EVERY commitment ${name}'s side made ("we'll send you...", "someone will call you within 24 hours"). Staff cannot honour a promise they never saw. An offer the customer has not accepted ("would you like more details?") is NOT a promise.

NOISE / SPAM — check this before anything else. If the thread is an advertisement, a phishing attempt impersonating Facebook/Meta or anyone else, an automated notice, or otherwise has nothing to do with ${name}'s actual business: set customer_needs to an empty array, intent_level to "unknown", and add a risk_flag saying it looks like spam or phishing, not a real enquiry. Never invent a plausible-sounding need to fill the field.

next_action must be a concrete thing a salesperson does today, in the imperative — e.g. "打电话给 Kam，确认需求". Never "等待客户回复": if the customer has gone quiet, chasing them IS the action, and the elapsed time below tells you how overdue it is.

draft_reply rules (it goes to a real customer as ${name}):
- Warm, plain English. Two or three sentences. No hype words.
- Never state a price, date, company-history fact, policy, or contact detail unless it is already in the thread.
- If the thread is about refunds, cancellations, changes, payment, insurance, medical or accessibility needs, or a complaint: do not attempt to resolve it. Draft a short reply saying a specialist will follow up, without inventing a phone number or email that is not already in the thread.`
}

/**
 * Deterministic backstop for the one concrete failure mode we have real
 * evidence of: a Facebook-impersonating ad/phishing message read as a
 * genuine enquiry (see PR description — a "verify your account" ad became
 * "想了解更多关于中国的旅游信息" for a logistics client). The prompt above
 * already asks the model to do this; this does not depend on the model
 * getting it right.
 *
 * Split into STRONG (flags on its own — near-never legitimate business text)
 * and WEAK + URGENCY (only counts as noise together). A bare "verify your
 * business" is routine in real B2B correspondence — e.g. a logistics client
 * confirming a partner's registration before signing — so it only counts as
 * noise alongside an urgency/threat cue, which is what turns it into the
 * classic "verify within 24 hours or be suspended" phishing template.
 */
const STRONG_NOISE_PATTERNS: RegExp[] = [
  /account\s+(has been|will be|is)\s+(suspended|restricted|disabled|limited|deactivated)/i,
  /(claim|redeem)\s+your\s+(prize|reward|gift)/i,
  /you(?:’|')ve\s+(won|been selected)/i,
  /copyright\s+(infringement|violation)/i,
  // Allow an adverb between "will be" and the verb ("will be permanently deleted").
  /page\s+will\s+be\s+(?:\w+\s+)?(deleted|removed|suspended|restricted)/i,
  /violat(?:e|es|ed|ion)\s+(our\s+)?community\s+standards/i,
]

const WEAK_NOISE_PATTERNS: RegExp[] = [
  /verify\s+your\s+(account|identity|page|business)/i,
  /confirm\s+your\s+(account|information|identity)/i,
]

const URGENCY_PATTERNS: RegExp[] = [
  /within\s+\d+\s+(hours?|days?)/i,
  /avoid\s+(restriction|suspension|deletion|deactivation)/i,
  /or\s+your\s+(account|page)\s+will\s+be/i,
  /click\s+(here|the link|below)/i,
]

/** Exported so the pattern list itself has a direct test, not just the thread-level effect. */
export function isLikelyNoiseMessage(text: string): boolean {
  if (STRONG_NOISE_PATTERNS.some((re) => re.test(text))) return true
  return WEAK_NOISE_PATTERNS.some((re) => re.test(text)) && URGENCY_PATTERNS.some((re) => re.test(text))
}

/**
 * Only true when every inbound message looks like noise — one phishing line
 * mixed into a real conversation must not wipe a genuine need.
 *
 * Known gap (魏征 review, 2026-09-13): a real enquiry followed later by an
 * unrelated ad in the same thread will NOT trip this — "every" inbound
 * message must match. That mixed case is left to the NOISE / SPAM prompt
 * rule in buildSystemPrompt(), which has no code-level guarantee behind it.
 * This function only guarantees the "the whole thread is noise" case (which
 * is what both real NAL incidents were).
 */
function threadLooksLikeNoise(messages: StoredMessage[]): boolean {
  const inbound = messages.filter((m) => m.direction === 'inbound' && m.body.trim().length > 0)
  if (inbound.length === 0) return false
  return inbound.every((m) => isLikelyNoiseMessage(m.body))
}

const NOISE_RISK_FLAG = '疑似垃圾/推广/钓鱼消息，非真实客户需求，已忽略模型给出的需求猜测'

/**
 * State the model cannot read off the transcript: who is waiting on whom, and
 * for how long. Without this next_action degrades to "wait for the customer".
 */
function renderContext(name: string, context?: BriefContext): string {
  if (!context) return ''
  const who = context.awaitingReply
    ? `The CUSTOMER spoke last and has been waiting ${context.hoursSinceLastMessage} hours for a reply from ${name}.`
    : `${name} spoke last. The customer has not replied for ${context.hoursSinceLastMessage} hours.`
  return `Current state: ${who}\n\n`
}

function renderThread(name: string, messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const who = m.direction === 'inbound' ? (m.senderName ?? 'Customer') : name
      return `[${m.sentAt}] ${who}: ${m.body}`
    })
    .join('\n')
}

/**
 * Ask the model for a brief. Falls back to a deterministic brief when no API key
 * is configured so dev/test never depends on a network call.
 *
 * `clientId` is what stops every client's threads being read as CTS's — it
 * picks the real business name and whether "trip" fields apply at all.
 */
export async function generateBrief(
  messages: StoredMessage[],
  clientId: string,
  context?: BriefContext,
): Promise<MessengerBrief> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallbackBrief(messages)

  const profile = await loadClientProfile(clientId)
  const isNoise = threadLooksLikeNoise(messages)

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const res = await client.responses.create({
    model: modelName(),
    input: [
      { role: 'system', content: buildSystemPrompt(profile) },
      {
        role: 'user',
        content: `${renderContext(profile.name, context)}Thread:\n${renderThread(profile.name, messages)}`,
      },
    ],
    text: {
      format: { type: 'json_schema', name: 'messenger_brief', schema: MESSENGER_BRIEF_JSON_SCHEMA },
    },
  } as Parameters<typeof client.responses.create>[0])

  const text = (res as { output_text?: string }).output_text ?? '{}'
  const brief = MessengerBriefSchema.parse(JSON.parse(text))
  return {
    ...brief,
    follow_up_due_at: normaliseFollowUpDueAt(brief.follow_up_due_at),
    summary: stripMarkdown(brief.summary),
    next_action: brief.next_action ? stripMarkdown(brief.next_action) : null,
    // A noise thread's "needs" are the model's best guess at a need that was
    // never expressed — belt-and-braces on top of the NOISE / SPAM prompt rule.
    customer_needs: isNoise ? [] : brief.customer_needs.map(stripMarkdown),
    objections: brief.objections.map(stripMarkdown),
    promises_made: brief.promises_made.map(stripMarkdown),
    draft_reply: stripMarkdown(brief.draft_reply),
    intent_level: isNoise ? 'unknown' : brief.intent_level,
    risk_flags: isNoise
      ? brief.risk_flags.includes(NOISE_RISK_FLAG)
        ? brief.risk_flags
        : [...brief.risk_flags, NOISE_RISK_FLAG]
      : brief.risk_flags,
    // Non-travel clients never get trip fields, no matter what the model
    // returned — this is the fix for the NAL thread that came back with a
    // fabricated "了解更多关于中国的旅游信息" travel interest.
    trip: profile.isTourism && !isNoise ? brief.trip : EMPTY_TRIP,
  }
}

/**
 * follow_up_due_at goes straight into a TIMESTAMPTZ column, so a model that
 * answers "下周三" or "in 3 days" does not merely render oddly — the INSERT
 * throws and the salesperson gets NO card for that thread at all. One unusable
 * date must not cost the whole brief, so anything unparseable becomes null.
 *
 * Bare dates ("2026-08-03") are accepted; Postgres would take them anyway and
 * midnight UTC is a reasonable reading of "that day".
 */
export function normaliseFollowUpDueAt(raw: string | null): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed.toISOString()
}

/**
 * Messenger has no markdown: `**Best of China**` reaches the customer with the
 * asterisks visible. The source threads are full of them (the Meta agent writes
 * markdown), so the model copies the habit. A prompt rule alone is not enough
 * for text that goes to a real customer, so strip it here too.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * Deterministic brief for the no-API-key path. Says only what is mechanically
 * true — it must never look like a real summary the salesperson can trust.
 */
export function fallbackBrief(messages: StoredMessage[]): MessengerBrief {
  const inbound = messages.filter((m) => m.direction === 'inbound')
  return MessengerBriefSchema.parse({
    summary: `未生成 AI 摘要（未配置模型）。客户共发送 ${inbound.length} 条消息，最后一条：${inbound[inbound.length - 1]?.body?.slice(0, 80) ?? '—'}`,
    intent_level: 'unknown',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: '请直接查看下方完整对话记录。',
    follow_up_due_at: null,
    risk_flags: ['AI 摘要未生成，请以原始对话为准'],
    trip: EMPTY_TRIP,
    contact: { phone: null, email: null },
    draft_reply: '',
  })
}

/** Write (or rewrite) the brief row for one conversation. */
export async function storeBrief(
  candidate: BriefCandidate,
  brief: MessengerBrief,
  now: Date,
): Promise<void> {
  const today = now.toISOString().slice(0, 10)
  const countedToday = candidate.regenCountDate === today ? candidate.regenCount : 0

  const { error } = await supabaseAdmin.from('conversation_briefs').upsert(
    {
      conversation_id: candidate.conversationId,
      client_id: candidate.clientId,
      schema_version: BRIEF_SCHEMA_VERSION,
      model: process.env.OPENAI_API_KEY ? modelName() : 'fallback',
      summary: brief.summary,
      intent_level: brief.intent_level,
      customer_needs: brief.customer_needs,
      objections: brief.objections,
      promises_made: brief.promises_made,
      next_action: brief.next_action,
      follow_up_due_at: brief.follow_up_due_at,
      risk_flags: brief.risk_flags,
      trip: brief.trip,
      contact: brief.contact,
      draft_reply: brief.draft_reply,
      source_message_count: candidate.messageCount,
      generated_at: now.toISOString(),
      regen_count: countedToday + 1,
      regen_count_date: today,
      updated_at: now.toISOString(),
    },
    { onConflict: 'conversation_id' },
  )

  if (error) throw new Error(`brief upsert failed: ${error.message}`)
}
