/**
 * 成交/咨询事实的录入校验与规范化（Issue #1397 PR1）。
 *
 * 纯函数：不碰数据库、不发网络请求。路由层负责鉴权、读客户配置、写库。
 * 这样这一层的规则可以被完整测到，而不需要一个假的 Supabase。
 *
 * 这里挡住的每一条，都是"进了库之后就很难收拾"的东西：
 * 一旦行被人审核放行并发给 Meta，就撤不回（CAPI 没有删除端点）。
 */

import { normalizeEmail, normalizeName, normalizePhone } from '@/lib/pii/normalize'

/** Meta 事件语义在 L3 adapter 里映射；这一层只认业务事实。 */
export type OutcomeKind = 'purchase' | 'balance' | 'lead'

export type SourceKind = 'manual_seed' | 'inbox_extract' | 'web_form' | 'meta_lead_form' | 'api'

export const OUTCOME_KINDS: readonly OutcomeKind[] = ['purchase', 'balance', 'lead']
export const SOURCE_KINDS: readonly SourceKind[] = [
  'manual_seed',
  'inbox_extract',
  'web_form',
  'meta_lead_form',
  'api',
]

export type IntakeInput = {
  clientId: string
  contactId?: string | null
  outcomeKind: string
  customerEmail?: string | null
  customerPhone?: string | null
  customerFirst?: string | null
  customerLast?: string | null
  orderRef?: string | null
  /** 金额的**主单位**（元/刀），如 3880.5。库里存最小单位（分/仙）。 */
  amount?: number | string | null
  currency?: string | null
  /** ISO 8601。到账日 / 首次接触日 —— 不是行程出发日。 */
  occurredAt: string
  sourceKind: string
  sourceRef?: string | null
  createdBy?: string | null
}

export type IntakeContext = {
  /** clients.default_phone_country，如 '64'。拿不到时本地格式电话不入库。 */
  defaultPhoneCountry: string | null
  /** 现在时刻，测试可注入。 */
  now: Date
}

export type IntakeRow = {
  client_id: string
  contact_id: string | null
  outcome_kind: OutcomeKind
  customer_email: string | null
  customer_phone: string | null
  customer_first: string | null
  customer_last: string | null
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  source_kind: SourceKind
  source_ref: string | null
  created_by: string | null
}

export type IntakeResult =
  | { ok: true; row: IntakeRow; warnings: string[] }
  | { ok: false; errors: string[] }

/**
 * 各币种的小数位。**只列真实在用的**，未知币种直接拒收。
 *
 * 为什么不给个默认值 2：绝大多数币种是 2 位，但不是全部（日元 0 位、
 * 科威特第纳尔 3 位）。默认 2 的话，哪天真收了一笔日元，金额会**静默**差 100 倍 ——
 * 而金额错了发给 Meta 是撤不回的。宁可当场报错让人来加一行。
 */
const MINOR_UNITS: Record<string, number> = {
  NZD: 2,
  AUD: 2,
  USD: 2,
}

export function minorUnitsFor(currency: string): number | null {
  return MINOR_UNITS[currency.toUpperCase()] ?? null
}

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNITS)

/**
 * 主单位金额 → 最小单位整数。未知币种返回 null。
 *
 * 🔴 不用 `Math.round(amount * 100)`：浮点乘法会把 `19.99 * 100` 算成 1998.9999…，
 *    四舍五入后看似没事，但换个数字（如 `1.005`）就会少一分。金额必须走十进制字符串。
 */
export function toMinorUnits(amount: number | string, currency: string): number | null {
  const exp = minorUnitsFor(currency)
  if (exp == null) return null

  const raw = typeof amount === 'number' ? amount.toString() : amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null

  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const [intPart, fracPart = ''] = unsigned.split('.')

  // 超出该币种精度的尾数（如 NZD 的第三位小数）拒收，不静默四舍五入 ——
  // 静默改金额比报错难查得多。
  if (fracPart.length > exp && /[^0]/.test(fracPart.slice(exp))) return null

  const padded = (fracPart + '0'.repeat(exp)).slice(0, exp)
  const combined = `${intPart}${padded}`.replace(/^0+(?=\d)/, '')
  const value = Number(combined)

  if (!Number.isSafeInteger(value)) return null
  return negative ? -value : value
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 未来多久之内的时间算合理。系统时钟偏差留一点余量，别把正常录入拦下来。 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** 超过 7 天的行照收（历史成交要留档），但提醒它发不出去。 */
const META_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function buildIntakeRow(input: IntakeInput, ctx: IntakeContext): IntakeResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!UUID_RE.test(input.clientId ?? '')) {
    errors.push('clientId 必须是 uuid')
  }
  if (input.contactId != null && input.contactId !== '' && !UUID_RE.test(input.contactId)) {
    errors.push('contactId 必须是 uuid 或留空')
  }

  const outcomeKind = input.outcomeKind as OutcomeKind
  if (!OUTCOME_KINDS.includes(outcomeKind)) {
    errors.push(`outcomeKind 必须是 ${OUTCOME_KINDS.join(' / ')}`)
  }

  const sourceKind = input.sourceKind as SourceKind
  if (!SOURCE_KINDS.includes(sourceKind)) {
    errors.push(`sourceKind 必须是 ${SOURCE_KINDS.join(' / ')}`)
  }

  // ── 时间 ────────────────────────────────────────────────────────────────
  const occurred = new Date(input.occurredAt ?? '')
  if (Number.isNaN(occurred.getTime())) {
    errors.push('occurredAt 不是合法时间')
  } else if (occurred.getTime() - ctx.now.getTime() > FUTURE_TOLERANCE_MS) {
    // 🔴 这一条挡的是真实事故形状：把**行程出发日**当成付款日录进来。
    //    CTS 有 2027 年 3 月才走的团，定金 2026 年就付了 —— 录错日期会让这笔
    //    永远发不出去（Meta 只收 7 天内的），而且没人知道为什么。
    errors.push('occurredAt 不能是未来时间 —— 这里要填「钱到账 / 客人来问」的日期，不是行程出发日')
  } else if (ctx.now.getTime() - occurred.getTime() > META_WINDOW_MS) {
    warnings.push(
      'occurredAt 已超过 7 天：Meta 只接受 7 天内的事件，这条会存档但发不出去（历史成交可留待客户名单那条腿使用）',
    )
  }

  // ── 金额 ────────────────────────────────────────────────────────────────
  const currency = input.currency ? input.currency.trim().toUpperCase() : null
  if (currency != null && !/^[A-Z]{3}$/.test(currency)) {
    errors.push('currency 必须是三字母 ISO 4217，如 NZD')
  } else if (currency != null && minorUnitsFor(currency) == null) {
    errors.push(
      `暂不支持币种 ${currency}（现支持 ${SUPPORTED_CURRENCIES.join(' / ')}）—— ` +
        '要用新币种请先在 MINOR_UNITS 里补上它的小数位，别让系统去猜',
    )
  }

  let amountMinor: number | null = null
  const hasAmount = input.amount != null && input.amount !== ''

  if (outcomeKind === 'lead') {
    if (hasAmount) {
      // PM 2026-09-05 拍板：咨询不带金额（同一区间内大同小异）。
      errors.push('lead 不带金额')
    }
    if (currency) errors.push('lead 不带币种')
  } else if (OUTCOME_KINDS.includes(outcomeKind)) {
    if (!hasAmount) errors.push(`${outcomeKind} 必须有金额`)
    if (!currency) errors.push(`${outcomeKind} 必须有币种`)
    if (hasAmount && currency) {
      const minor = toMinorUnits(input.amount as number | string, currency)
      if (minor == null) {
        if (minorUnitsFor(currency) != null) {
          errors.push('amount 不是合法金额，或小数位超出该币种精度')
        }
      } else if (minor <= 0) {
        errors.push('amount 必须大于 0（退款不走这张表）')
      } else {
        amountMinor = minor
      }
    }
  }

  // ── 匹配键 ──────────────────────────────────────────────────────────────
  const email = normalizeEmail(input.customerEmail)
  const phoneRaw = input.customerPhone?.trim() ?? ''
  const phone = normalizePhone(input.customerPhone, ctx.defaultPhoneCountry)

  if (phoneRaw.length > 0 && phone == null) {
    // 说清楚为什么丢了，否则会被当成"系统吃了我的输入"。
    warnings.push(
      ctx.defaultPhoneCountry
        ? '电话无法解析成国际格式，已忽略'
        : '该客户没有配置默认国家码，本地格式的电话无法转成国际格式，已忽略（宁可少一个匹配键，也不猜错国家）',
    )
  }

  if (!email && !phone) {
    errors.push('至少要有邮箱或电话之一 —— 两个都没有的话，发给 Meta 100% 匹配不上')
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    warnings,
    row: {
      client_id: input.clientId,
      contact_id: input.contactId && input.contactId !== '' ? input.contactId : null,
      outcome_kind: outcomeKind,
      customer_email: email,
      customer_phone: phone,
      customer_first: normalizeName(input.customerFirst),
      customer_last: normalizeName(input.customerLast),
      order_ref: input.orderRef?.trim() || null,
      amount_minor: amountMinor,
      currency: outcomeKind === 'lead' ? null : currency,
      occurred_at: occurred.toISOString(),
      source_kind: sourceKind,
      source_ref: input.sourceRef?.trim() || null,
      created_by: input.createdBy?.trim() || null,
    },
  }
}
