/**
 * Client knowledge base — fact sensitivity classifier.
 *
 * A `client_knowledge_facts` row an AI is allowed to say to a real customer
 * carries a `sensitivity`. `price` / `timeline` / `commitment` / `policy`
 * facts require the client's own confirmation before an AI may use them in a
 * customer-facing reply; `general` facts only need FDE approval (see the
 * 2026-09-13 client knowledge base design, §7.2/§9.5/§9.14-A). This module is
 * the deterministic, language-independent hard rule that decides when a fact
 * — or an AI's own sensitivity tag on it — may NOT be `general`. It never
 * decides FOR `general`, only forces AWAY from it.
 *
 * Extracted as an industry-neutral sibling to
 * `src/lib/social/comment-guardrails.ts` (which stays travel-specific and
 * English-only) so both can share the same hard-rule shape without either
 * pulling in the other's vocabulary.
 *
 * Deliberately over-inclusive: a false "sensitive" costs one extra client
 * confirmation click; a false "general" lets an unconfirmed price or promise
 * reach a real customer under the client's brand.
 */

export type FactSensitivity = 'price' | 'timeline' | 'commitment' | 'policy' | 'general'

const KNOWN_SENSITIVITIES: ReadonlySet<string> = new Set<FactSensitivity>([
  'price',
  'timeline',
  'commitment',
  'policy',
  'general',
])

/** Fold full-width digits/symbols to ASCII before scanning. Chinese numerals are unaffected. */
function normalise(text: string): string {
  return text.normalize('NFKC')
}

// Any Arabic digit (after NFKC-folding full-width digits) or Chinese numeral.
// Deliberately does not try to parse magnitude, unit, or context — a lone "4"
// can be a per-kg rate, a day count, a percentage, or a phone number, and
// this rule must not depend on knowing which. Any digit is enough.
const NUMERAL_PATTERN = /[0-9]|[一二三四五六七八九十百千万两]/

// Guarantee / refund / cutoff / expiry / "covers X"-style commitments that
// carry no digit at all (a digit is already caught by NUMERAL_PATTERN, e.g.
// "3 天内退款"). Bilingual by construction, not a translation of one list —
// English and Chinese keywords each stand on their own.
const COMMITMENT_KEYWORDS = [
  // English
  'guarantee',
  'guaranteed',
  'refund',
  'money back',
  'cut-off',
  'cutoff',
  'deadline',
  'expire',
  'expiry',
  'expires',
  'valid until',
  'promise',
  'promised',
  'warranty',
  'free of charge',
  'no extra charge',
  'included at no cost',
  // Chinese
  '保证',
  '担保',
  '退款',
  '退改',
  '退换',
  '截单',
  '截止',
  '有效期',
  '过期',
  '承诺',
  '包邮',
  '包税',
  '包清关',
  '包安装',
  '包到',
  '包退',
  '包换',
]

/**
 * True when `text` must never be treated as a `general` fact, regardless of
 * what an AI or FDE tagged it — because it asserts a number (price, weight
 * break, day count, percentage, anything) or a guarantee/refund/cutoff/
 * inclusion-style commitment. Language-independent: does not special-case
 * English or Chinese, and matches on either or both in the same string.
 */
export function containsSensitiveSignal(text: string): boolean {
  const normalised = normalise(text)
  if (NUMERAL_PATTERN.test(normalised)) return true
  const lower = normalised.toLowerCase()
  return COMMITMENT_KEYWORDS.some((keyword) => lower.includes(keyword))
}

/**
 * Resolve the sensitivity category a knowledge fact must be gated under.
 * Fail-closed on every ambiguous path:
 *  - a recognised, non-`general` tag is trusted as-is (an AI/FDE that
 *    already flagged `timeline`/`commitment`/`policy` is not second-guessed)
 *  - a tag of `general` is rejected — forced to `price` — when the text
 *    still trips the deterministic hard rule; no AI/FDE tag can downgrade a
 *    numeric or commitment-bearing statement to `general`
 *  - a missing or unrecognised tag defaults to `price`, the strictest
 *    category, never silently to `general`
 */
export function resolveFactSensitivity(text: string, taggedSensitivity?: string | null): FactSensitivity {
  const tag = taggedSensitivity ?? undefined
  const isKnownTag = tag !== undefined && KNOWN_SENSITIVITIES.has(tag)

  if (isKnownTag && tag !== 'general') {
    return tag as FactSensitivity
  }
  if (isKnownTag && tag === 'general') {
    return containsSensitiveSignal(text) ? 'price' : 'general'
  }
  return 'price'
}
