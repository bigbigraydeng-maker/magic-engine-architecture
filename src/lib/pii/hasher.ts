/**
 * 客户身份的 SHA-256 —— 广告平台要的都是这个形状（Meta / Google Ads / TikTok 一致）。
 *
 * 规范化在 `./normalize` 里做，这里只负责哈希。分开的理由：
 * 规范化发生在**写库**那一刻（同一个人换个写法要存成同一个值），
 * 哈希发生在**发送**那一刻（明文不出内存）。
 *
 * 🔴 哈希前必须先规范化。`Rosalind@Example.COM` 和 `rosalind@example.com`
 *    直接哈希会得到两个完全不同的值，等于同一个人在平台那边算两个人。
 */

import { createHash } from 'crypto'
import { normalizeEmail, normalizeName, normalizePhone } from './normalize'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** 已经规范化过的值 → 哈希。空值返回 null（不要哈希空串，那会是一个人人相同的假身份）。 */
export function hashNormalized(value: string | null | undefined): string | null {
  if (!value) return null
  return sha256(value)
}

export function hashEmail(raw: string | null | undefined): string | null {
  return hashNormalized(normalizeEmail(raw))
}

export function hashPhone(
  raw: string | null | undefined,
  defaultCountry: string | null | undefined,
): string | null {
  return hashNormalized(normalizePhone(raw, defaultCountry))
}

export function hashName(raw: string | null | undefined): string | null {
  return hashNormalized(normalizeName(raw))
}

/**
 * 国家：平台要的是小写两字母国别码的哈希（'nz' / 'au'）。
 * 传进来的可能是 'NZ'、'nz'、'新西兰' —— 只接受两字母，其余当没有。
 */
export function hashCountry(code: string | null | undefined): string | null {
  if (!code) return null
  const v = code.trim().toLowerCase()
  return /^[a-z]{2}$/.test(v) ? sha256(v) : null
}

/**
 * 内部 id 的哈希（Meta 的 external_id）。
 * 用来把同一个人的多次事件串起来，也让平台在邮箱电话都匹配不上时还有一个键可试。
 */
export function hashExternalId(id: string | null | undefined): string | null {
  if (!id) return null
  const v = id.trim()
  return v.length > 0 ? sha256(v) : null
}
