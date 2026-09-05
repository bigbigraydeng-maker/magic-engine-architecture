/**
 * 试运行时给人看的预览（Issue #1397）。
 *
 * 🔴 这里刻意**不给哈希**。试运行的目的是让人核对"这条发出去对不对"，
 *    而一串 sha256 什么也核对不了 —— 看得出"是不是那位客人、金额对不对、
 *    日期对不对、有几个匹配键"才有意义。
 *
 * 🔴 也刻意**不给明文**。预览会进数据库、进日志、进截图，
 *    明文邮箱电话不该在这些地方留底。
 *
 * 所以给的是打码版 + 一张"哪些字段有、哪些没有"的清单。
 */

import type { ClientSendConfig, OutcomeForSend } from '@/lib/conversions/destination-writer'
import { normalizeEmail, normalizePhone } from '@/lib/pii/normalize'

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const head = email.slice(0, Math.min(3, at))
  return `${head}***${email.slice(at)}`
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  if (phone.length <= 2) return '***'
  return `${'*'.repeat(phone.length - 2)}${phone.slice(-2)}`
}

function maskName(name: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  return trimmed.length === 0 ? null : `${trimmed[0].toUpperCase()}***`
}

const MINOR_UNITS: Record<string, number> = { NZD: 2, AUD: 2, USD: 2 }

function formatAmount(amountMinor: number | null, currency: string | null): string | null {
  if (amountMinor == null || !currency) return null
  const exp = MINOR_UNITS[currency.toUpperCase()] ?? 2
  const major = amountMinor / 10 ** exp
  return `${currency} ${major.toLocaleString('en-NZ', { minimumFractionDigits: exp, maximumFractionDigits: exp })}`
}

export function maskForPreview(
  outcome: OutcomeForSend,
  config: ClientSendConfig,
  meta: { eventName: string; maxEventAgeDays: number },
): Record<string, unknown> {
  const email = normalizeEmail(outcome.customerEmail)
  const phone = normalizePhone(outcome.customerPhone, config.defaultPhoneCountry)

  const present: string[] = []
  const missing: string[] = []
  const note = (key: string, has: boolean) => (has ? present : missing).push(key)

  note('邮箱', email != null)
  note('电话', phone != null)
  note('名', outcome.customerFirst != null)
  note('姓', outcome.customerLast != null)
  note('国家', config.countryCode != null)
  note('内部编号', outcome.contactId != null)

  const ageDays = (Date.now() - new Date(outcome.occurredAt).getTime()) / 86_400_000
  const tooOld = ageDays > meta.maxEventAgeDays

  return {
    事件类型: meta.eventName,
    客户: {
      邮箱: maskEmail(email),
      电话: maskPhone(phone),
      姓名: [maskName(outcome.customerFirst), maskName(outcome.customerLast)]
        .filter(Boolean)
        .join(' ') || null,
    },
    金额: formatAmount(outcome.amountMinor, outcome.currency),
    单号: outcome.orderRef,
    发生时间: outcome.occurredAt,
    距今天数: Math.floor(ageDays * 10) / 10,
    匹配键_有: present,
    匹配键_无: missing,
    // 匹配键越少，Meta 越难认出这是谁。给个直白的判断，别让人自己数。
    匹配质量提示:
      present.length >= 4
        ? '匹配键较全'
        : present.length >= 2
          ? '匹配键偏少，Meta 可能认不出这个人'
          : '只有一个匹配键，大概率匹配不上',
    能否发送: tooOld
      ? `不能 —— 已过去 ${Math.floor(ageDays)} 天，Meta 只收 ${meta.maxEventAgeDays} 天内的`
      : '可以',
  }
}
