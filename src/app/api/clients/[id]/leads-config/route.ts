/**
 * 客户的 leads 模块配置 —— GET / PATCH。
 *
 * 四项：
 *   · 要不要把这个客户的邮件反应（谁打开了、谁点了链接）同步进 CRM
 *   · **客户自己的邮件域名** —— 同域来信是同事，不进客人名单
 *   · **同行 / 分销的域名** —— 是真业务，但跟进方式完全不同，单独分类
 *   · **网站表单来了新客资，发邮件通知谁** —— 客户自己的收件箱（而不是只进 ME 后台
 *     CRM，FDE 才看得到）。2026-08-19 补上：Park Homes 的合同白纸黑字写了「表单要
 *     把询盘发到 115parkhomes@gmail.com」，之前 /api/clients/[id]/leads 只落库，
 *     客户自己的邮箱收不到——落库了不等于客户知道。
 *
 * 后三项 2026-08-04 / 2026-08-19 补上界面（此前只能改数据库）。少了界面这条规则
 * 就是死的：以后新遇到一家同行，FDE 加不进去，只能来找开发 —— 而「要 FDE 填的
 * 字段必须连界面一起做完」是铁律，不是建议。
 *
 * `mailchimpAudienceId` 2026-09-03 补上：`mailchimp-paid-tagging` cron 靠它
 * 找到这个客户在 Mailchimp 的名单，但那条 cron 优先读的专列
 * `clients.mailchimp_audience_id` 至今没在生产 apply（见该 cron 文件里的
 * 注释），回退读的 `leads_config.mailchimp_audience_id` 在这次补之前完全没有
 * 写入口 —— 新客户只能直接改数据库，否则永远走 `no_audience_id` 跳过打标签。
 *
 * Responses: 200 { config } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { parseDomainList, readDomainRules } from '@/lib/crm/contact-kind'
import { parseEmailList } from '@/lib/leads/parse-email-list'

export interface LeadsConfig {
  /** 开了才会把邮件打开/点击同步进这个客户的 CRM。 */
  mailchimpEnabled: boolean
  /** 客户自己的邮件域名（可以有多个：主域名 + 关联公司）。 */
  ownEmailDomains: string[]
  /** 同行 / 分销商的域名。 */
  tradeDomains: string[]
  /** 网站表单每来一条新客资，best-effort 邮件通知的收件人清单。 */
  notifyEmails: string[]
  /** 这个客户在 Mailchimp 的 audience id —— 专列没 apply 时的唯一落脚点。 */
  mailchimpAudienceId: string
}

function readConfig(raw: unknown): LeadsConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  const rules = readDomainRules(o)
  const notifyEmails = Array.isArray(o.notify_emails)
    ? o.notify_emails.filter((x): x is string => typeof x === 'string')
    : []
  return {
    mailchimpEnabled: o.mailchimp_enabled === true,
    ownEmailDomains: rules.own,
    tradeDomains: rules.trade,
    notifyEmails,
    mailchimpAudienceId: typeof o.mailchimp_audience_id === 'string' ? o.mailchimp_audience_id.trim() : '',
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '客户不存在' }, { status: 404 })

  return NextResponse.json({ config: readConfig(data.leads_config) })
}

interface PatchBody {
  mailchimpEnabled?: unknown
  ownEmailDomains?: unknown
  tradeDomains?: unknown
  notifyEmails?: unknown
  mailchimpAudienceId?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 每一项都可以单独改 —— 三个面板各自保存，互不覆盖。
  const patch: Record<string, unknown> = {}
  /** 认不出来的原样带回去说清楚，绝不默默丢掉（丢掉 = 填的人以为标好了）。 */
  const rejected: string[] = []

  if (body.mailchimpEnabled !== undefined) {
    if (typeof body.mailchimpEnabled !== 'boolean') {
      return NextResponse.json({ error: 'mailchimpEnabled 必须是 true / false' }, { status: 400 })
    }
    patch.mailchimp_enabled = body.mailchimpEnabled
  }

  for (const [field, column] of [
    ['ownEmailDomains', 'own_email_domains'],
    ['tradeDomains', 'trade_domains'],
  ] as const) {
    const value = body[field]
    if (value === undefined) continue
    if (typeof value !== 'string' && !Array.isArray(value)) {
      return NextResponse.json({ error: `${field} 要么是一段文字，要么是一个清单` }, { status: 400 })
    }
    const parsed = parseDomainList(value)
    patch[column] = parsed.domains
    rejected.push(...parsed.rejected)
  }

  if (body.notifyEmails !== undefined) {
    if (typeof body.notifyEmails !== 'string' && !Array.isArray(body.notifyEmails)) {
      return NextResponse.json({ error: 'notifyEmails 要么是一段文字，要么是一个清单' }, { status: 400 })
    }
    const parsed = parseEmailList(body.notifyEmails)
    patch.notify_emails = parsed.emails
    rejected.push(...parsed.rejected)
  }

  if (body.mailchimpAudienceId !== undefined) {
    if (typeof body.mailchimpAudienceId !== 'string') {
      return NextResponse.json({ error: 'mailchimpAudienceId 必须是文字' }, { status: 400 })
    }
    // 空字符串是合法的「清空」——不强制必填，客户还没连 Mailchimp 时留空。
    patch.mailchimp_audience_id = body.mailchimpAudienceId.trim()
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '没有要改的项' }, { status: 400 })
  }

  // 读-改-写：leads_config 里还有别的项，整块覆盖会把它们抹掉。
  const { data: cur } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  const next = {
    ...((cur?.leads_config as Record<string, unknown> | null) ?? {}),
    ...patch,
  }

  const { error: updErr } = await supabaseAdmin
    .from('clients')
    .update({ leads_config: next })
    .eq('id', clientId)

  if (updErr) {
    return NextResponse.json({ error: `保存失败: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    config: readConfig(next),
    // 能存的都存了，认不出来的单独说 —— 不因为几条填错就整次拒绝，
    // 那会让人把已经填对的十条一起丢掉。
    rejected: Array.from(new Set(rejected)),
  })
}
