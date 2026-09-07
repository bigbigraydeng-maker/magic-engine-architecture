/**
 * 把 CRM 联系人筛成一份能传 Meta「客户名单」(Custom Audience) 的 CSV（Issue #1397）。
 *
 * 纯函数，不碰数据库、不发网络。路由层负责鉴权、读库、下载响应。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 名单 A 的口径（子牙 + 魏征 2026-09-06 复审定死）
 * ────────────────────────────────────────────────────────────────────────
 *
 * 只放同时满足这四条的人：
 *   1. **retail**（终端客户/游客）—— 用既有 contactKindOf 分类，天然剔掉 agent(trade) 与员工(staff)。
 *      把 agent 放进 lookalike 种子会让 Meta 去找更多旅行社，不是游客。
 *   2. **有同意** —— 来源是 Meta 广告（attr_platform='meta' 或有 attr_ad_id）。
 *      那句同意声明在 CTS 的广告线索表单上；没走过广告的人不在覆盖内。
 *   3. **未拒联** —— 走 isDoNotContact（真相源是不可变触点，不是 contacts 那一列）。
 *   4. **有匹配键** —— 至少一个 email 或 phone，否则 Meta 100% 匹配不上。
 *
 * 🔴 这份 CSV 是明文 email/phone —— Meta 上传时才哈希，明文是任务的必然产物。
 *    所以它只能经"系统 → 授权管理员的浏览器下载"这一条路，不落地到别处。
 */

import { normalizePhone, normalizeName } from '@/lib/pii/normalize'

export type ContactKind = 'staff' | 'trade' | 'retail'

/** 已经过 DNC 判据、已算好 kind 的联系人。上游负责把这些算好。 */
export type AudienceContact = {
  displayName: string | null
  email: string | null
  phone: string | null
  kind: ContactKind
  /** 是否来自广告（attr_platform==='meta' 或有 attr_ad_id）。 */
  fromAd: boolean
  /** isDoNotContact 的结果（真相源触点，不是 contacts 那一列）。 */
  doNotContact: boolean
}

export type AudienceRow = {
  email: string
  phone: string
  fn: string
  ln: string
  country: string
}

export type AudienceResult = {
  rows: AudienceRow[]
  /** 说清为什么是这个数：每一条被排除的理由都数出来，方便核对，也方便 PM 知道池子怎么缩的。 */
  stats: {
    total: number
    kept: number
    excluded_not_retail: number
    excluded_no_consent: number
    excluded_dnc: number
    excluded_no_key: number
    with_email: number
    with_phone: number
  }
}

function splitName(displayName: string | null): { fn: string; ln: string } {
  const dn = displayName?.trim()
  if (!dn) return { fn: '', ln: '' }
  const parts = dn.split(/\s+/)
  if (parts.length < 2) return { fn: parts[0] ?? '', ln: '' }
  return { fn: parts[0], ln: parts.slice(1).join(' ') }
}

/**
 * 筛出名单 A。
 * @param defaultPhoneCountry clients.default_phone_country（'64'）—— 电话转国际格式用。
 */
export function buildMetaAudienceA(
  contacts: readonly AudienceContact[],
  defaultPhoneCountry: string | null,
): AudienceResult {
  const stats: AudienceResult['stats'] = {
    total: contacts.length,
    kept: 0,
    excluded_not_retail: 0,
    excluded_no_consent: 0,
    excluded_dnc: 0,
    excluded_no_key: 0,
    with_email: 0,
    with_phone: 0,
  }
  const rows: AudienceRow[] = []

  for (const c of contacts) {
    // 顺序即优先级：先按最该拦的理由归类，一条只数一次。
    if (c.kind !== 'retail') {
      stats.excluded_not_retail++
      continue
    }
    if (c.doNotContact) {
      stats.excluded_dnc++
      continue
    }
    if (!c.fromAd) {
      stats.excluded_no_consent++
      continue
    }

    const email = c.email ? c.email.trim().toLowerCase() : ''
    const phone = normalizePhone(c.phone, defaultPhoneCountry) ?? ''
    if (!email && !phone) {
      stats.excluded_no_key++
      continue
    }

    const { fn, ln } = splitName(c.displayName)
    rows.push({
      email,
      phone,
      fn: normalizeName(fn) ?? '',
      ln: normalizeName(ln) ?? '',
      country: 'nz',
    })
    stats.kept++
    if (email) stats.with_email++
    if (phone) stats.with_phone++
  }

  return { rows, stats }
}

/**
 * 一个 Mailchimp 已订阅成员，配上「算好的 kind」和「是否 ME 侧拒联」。
 * 上游负责用邮箱域名算 kind、用 ME 的 DNC 邮箱集判 doNotContact。
 */
export type NewsletterContact = {
  email: string
  phone: string | null
  firstName: string | null
  lastName: string | null
  kind: ContactKind
  /** 这个邮箱在 ME 侧被标了「别再联系」。 */
  doNotContact: boolean
}

/**
 * 筛出 newsletter 名单（Mailchimp 已订阅者）。
 *
 * 同意基础是「主动订阅营销邮件」，比广告表单更硬 —— 所以**不要求**来自广告，
 * 但仍剔掉：非终端客户(agent/员工)、ME 侧明确拒联的、没匹配键的。
 * 退订者不会进来（上游只拉 subscribed）。
 */
export function buildNewsletterAudience(
  members: readonly NewsletterContact[],
  defaultPhoneCountry: string | null,
): AudienceResult {
  const stats: AudienceResult['stats'] = {
    total: members.length,
    kept: 0,
    excluded_not_retail: 0,
    excluded_no_consent: 0, // newsletter 源天然有同意，这项恒 0
    excluded_dnc: 0,
    excluded_no_key: 0,
    with_email: 0,
    with_phone: 0,
  }
  const rows: AudienceRow[] = []

  for (const m of members) {
    if (m.kind !== 'retail') {
      stats.excluded_not_retail++
      continue
    }
    if (m.doNotContact) {
      stats.excluded_dnc++
      continue
    }
    const email = m.email ? m.email.trim().toLowerCase() : ''
    const phone = normalizePhone(m.phone, defaultPhoneCountry) ?? ''
    if (!email && !phone) {
      stats.excluded_no_key++
      continue
    }
    rows.push({
      email,
      phone,
      fn: normalizeName(m.firstName) ?? '',
      ln: normalizeName(m.lastName) ?? '',
      country: 'nz',
    })
    stats.kept++
    if (email) stats.with_email++
    if (phone) stats.with_phone++
  }

  return { rows, stats }
}

/**
 * 合并两份名单并去重。
 *
 * 去重键：先邮箱，无邮箱用电话。同一个人在两份里都出现时只留一条
 * （优先保留信息更全的：有名字的压过没名字的）。
 */
export function mergeAudiences(...lists: ReadonlyArray<readonly AudienceRow[]>): AudienceRow[] {
  const byKey = new Map<string, AudienceRow>()
  for (const list of lists) {
    for (const r of list) {
      const key = r.email || `phone:${r.phone}`
      if (!key || key === 'phone:') continue
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, r)
        continue
      }
      // 已有：补齐缺的字段（电话/名字），不新增行。
      byKey.set(key, {
        email: existing.email || r.email,
        phone: existing.phone || r.phone,
        fn: existing.fn || r.fn,
        ln: existing.ln || r.ln,
        country: existing.country || r.country,
      })
    }
  }
  return [...byKey.values()]
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Meta 客户名单 CSV。列名用 Meta 上传向导认得的标准 schema。
 * Meta 上传时自己哈希，所以这里是明文。
 */
export function audienceToCsv(rows: readonly AudienceRow[]): string {
  const header = ['email', 'phone', 'fn', 'ln', 'country']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.email, r.phone, r.fn, r.ln, r.country].map(csvCell).join(','))
  }
  return lines.join('\n') + '\n'
}
