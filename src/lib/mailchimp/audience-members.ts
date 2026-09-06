/**
 * 只读拉取 Mailchimp 受众里**已订阅**的成员（Issue #1397 · newsletter 合并）。
 *
 * 只拉 `status=subscribed` —— 那是**当前明确同意收营销**的人。
 * 🔴 退订(unsubscribed)、从未订阅(nonsubscribed/transactional)、失效(cleaned) 一律不拉：
 *    退订的传给 Meta 做广告是踩隐私红线，其余没同意或匹配不上。
 *    （2026-09-06 PM 手工从 Mailchimp 导出时正是拿到 4 个分档文件，差点全传。）
 *
 * 纯读：不改 Mailchimp 任何东西。
 */

import { datacenterFromKey } from './client'

const API_VERSION = '3.0'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface MailchimpAudienceConfig {
  apiKey: string
  audienceId: string
}

export type NewsletterMember = {
  email: string
  phone: string | null
  firstName: string | null
  lastName: string | null
}

function authHeader(apiKey: string): string {
  // Mailchimp 接受 Basic（用户名任意）。与 tags.ts 一致。
  return `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`
}

type RawMember = {
  email_address?: string
  status?: string
  merge_fields?: Record<string, unknown>
}

function pickPhone(mf: Record<string, unknown> | undefined): string | null {
  if (!mf) return null
  // Mailchimp 电话常见落在 PHONE；有的账户用别的合并字段名，宽松取第一个像电话的。
  const direct = mf.PHONE ?? mf.Phone ?? mf.phone
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * 拉一个受众里全部**已订阅**成员。分页，每页 1000。
 *
 * @throws 当 Mailchimp 返回非 2xx（把状态与标题带出来，让调用方能说人话）。
 */
export async function fetchSubscribedMembers(
  cfg: MailchimpAudienceConfig,
  opts: { fetcher?: FetchLike } = {},
): Promise<NewsletterMember[]> {
  const fetcher = opts.fetcher ?? (fetch as FetchLike)
  const dc = datacenterFromKey(cfg.apiKey)
  const base = `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}/members`

  const out: NewsletterMember[] = []
  const pageSize = 1000
  let offset = 0

  for (;;) {
    const url =
      `${base}?status=subscribed&count=${pageSize}&offset=${offset}` +
      // 只取要用的字段，别把整份成员画像拉回来（省流量，也少 PII 暴露面）。
      `&fields=members.email_address,members.merge_fields,total_items`
    const res = await fetcher(url, {
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { title?: string; detail?: string }
        detail = body.title || body.detail || ''
      } catch {
        /* 忽略解析失败，用状态码说话 */
      }
      throw new Error(`Mailchimp 拉取成员失败：HTTP ${res.status} ${detail}`)
    }

    const body = (await res.json()) as { members?: RawMember[] }
    const members = body.members ?? []
    for (const m of members) {
      const email = str(m.email_address)?.toLowerCase()
      if (!email) continue
      // 双保险：只收 subscribed（即使 API 过滤失灵也不放过退订的）。
      if (m.status && m.status !== 'subscribed') continue
      out.push({
        email,
        phone: pickPhone(m.merge_fields),
        firstName: str(m.merge_fields?.FNAME),
        lastName: str(m.merge_fields?.LNAME),
      })
    }

    if (members.length < pageSize) break
    offset += pageSize
    // 安全阀：别因为某种分页异常无限拉。10 万成员足够任何客户。
    if (offset > 100_000) break
  }

  return out
}
