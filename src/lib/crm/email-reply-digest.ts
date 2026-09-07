/**
 * 「客人来信没人回」的汇总邮件。
 *
 * 上游已经把「哪些来信超时没回」算好了，这一层只负责一件事：把这份名单发到
 * 销售手上，而不是让它死在 cron 日志里（CLAUDE.md 铁律 3 下半：发现不许死在日志里）。
 *
 * 三个刻意的约束：
 *
 * 1. **测试期必须自报家门**。主题和正文第一段都带 `【测试功能】`（PM 硬性要求）。
 *    收信的是客户的销售，不是 ME 内部人 —— 一封没打招呼的机器信，轻则被当垃圾，
 *    重则让人以为系统在替他们回客人。撤掉标记时只改 DIGEST_TEST_PREFIX 一处。
 *
 * 2. **收件人只认调用方传进来的**。传空 → 退回 ME 自己的信箱，绝不去猜客户地址。
 *    猜错的代价是把某个客户的客人名单发给别人，这条线不接受「大概是对的」。
 *
 * 3. **正文不写客人的邮箱地址**。名字 + 主题 + 等待时长足够销售认人，
 *    多带一个邮箱就是把客人的联系方式复制到一封会被转发的邮件里。
 *    ⚠️ 这条得**动手执行**，不能只写在这儿：`contacts.display_name` 来自
 *    Graph 的 `from.emailAddress.name`，而 Outlook 在对方没设显示名时会把它
 *    填成**邮箱地址本身** —— 直接渲染就是原样漏出去。见 `stripAddress`。
 *
 * 4. **数字不许说小**。被上限压掉的、今天根本没同步进来的，都要在正文里说出来。
 *    「有 10 封在等」而实际 25 封，销售处理完 10 封以为清空了 ——
 *    那比不发这封信更糟。
 *
 * 发送函数永不抛异常：发信失败不该把上游那趟同步一起带崩。
 */

import { Resend } from 'resend'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { describeSendError } from '@/lib/ads-strategy/digest'
import { contactCardTitle } from '@/lib/crm/display-name'

/** 测试期标记。撤掉这个功能的「测试中」身份时，只改这一处。 */
export const DIGEST_TEST_PREFIX = '【测试功能】'

/** 后台入口（登录后可见），拼客人记录的直达链接用。 */
const APP_BASE = 'https://app.magicengine.com.au'

/**
 * 一封等着被回复的客人来信。
 *
 * 字段名刻意跟上游 `email-reply-due.ts` 的 `ReplyDueItem` 对齐 —— 它挑出来的
 * 条目可以直接扔进来，不用中间再翻译一层（多的 conversationId / waitingHours
 * 等字段无害）。类型名不复用是为了避免两个同名 interface 在导入处打架。
 */
export interface DigestItem {
  /** ME 客户 id —— 拼后台直达链接用 */
  clientId: string
  /** CRM 里这位客人的联系人 id */
  contactId: string
  /** 客人名字。查不到就是 null，由 contactCardTitle 兜底成「未留姓名」 */
  displayName: string | null
  /** 邮件主题。没有就是 null */
  subject: string | null
  /** 客人最后说话的时间，ISO 字符串 */
  lastMessageAt: string
}

/** 发信通道，测试用假件替换，绝不真发。 */
export interface DigestMailer {
  emails: {
    send(payload: {
      from: string
      to: string[]
      subject: string
      html: string
    }): Promise<{ error: unknown }>
  }
}

export interface DigestSendResult {
  sent: boolean
  /** 没发出去的原因，说人话 */
  reason?: string
  /** 这次实际用的收件人（含 fallback 之后的结果），方便调用方记日志 */
  recipients: string[]
}

/**
 * 名单之外还有多少 / 这份名单靠不靠谱 —— 两条都必须能跟着名单一起说出去。
 */
export interface DigestExtra {
  /** 被调用方的每客户上限压掉、没有列出来的条数。 */
  dropped?: number
  /** 今天公司邮箱没（全部）同步上 → 这份名单不完整。 */
  syncStale?: boolean
}

/** @param count 在等回复的**总数**（含没列出来的），不是名单长度。 */
export function buildDigestSubject(clientName: string, count: number): string {
  return `${DIGEST_TEST_PREFIX}${clientName}：${count} 封客人来信在等回复`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 名字里长得像邮箱地址的那一截。`<>` 不算地址的一部分。 */
const EMAIL_TOKEN = /[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/g

/**
 * 把名字里的邮箱地址掐成 @ 前那一截（文件头第 3 条）。
 *
 * 为什么不整条换成「未留姓名」：一批客人全显示「未留姓名」等于名单作废，
 * 销售认不出该先回谁。`wang.customer` 还能认人，但已经不是一个能直接发信的地址。
 */
function stripAddress(name: string): string {
  const out = name.replace(EMAIL_TOKEN, (addr) => addr.slice(0, addr.indexOf('@'))).trim()
  return out || '未留姓名'
}

/**
 * 等了多久说成人话。
 *
 * 「等了 51 小时」没人能一眼换算，「等了 2 天 3 小时」才有紧迫感。
 * 时间戳解析不出来时说「时间不详」，而不是显示 NaN 或者干脆把这条丢掉 ——
 * 丢掉就等于这位客人从名单上消失了。
 */
export function humanWait(ms: number): string {
  if (!Number.isFinite(ms)) return '时间不详'
  if (ms < 3_600_000) return '不到 1 小时'
  const totalHours = Math.floor(ms / 3_600_000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days === 0) return `${hours} 小时`
  if (hours === 0) return `${days} 天`
  return `${days} 天 ${hours} 小时`
}

/** 等待毫秒数；时间戳坏掉时给 NaN，由 humanWait / 排序各自处理。 */
function waitedMs(item: DigestItem, now: Date): number {
  const t = new Date(item.lastMessageAt).getTime()
  if (Number.isNaN(t)) return Number.NaN
  return now.getTime() - t
}

/** 等最久的排最前；时间戳坏掉的排最后（还得看见，但不该占头条）。 */
function byWaitDesc(a: number, b: number): number {
  const av = Number.isFinite(a) ? a : -Infinity
  const bv = Number.isFinite(b) ? b : -Infinity
  return bv - av
}

/**
 * 直达链接指向 CRM 里这个人的记录，不是收件箱那条线程视图 ——
 * 线程视图明写着「只回不了信、且是付费功能」，销售点进去会扑空。
 * 这个链接形状跟「需要你动手」那栏用的是同一个（manual-items.ts）。
 */
function contactUrl(item: DigestItem): string {
  const client = encodeURIComponent(item.clientId)
  const contact = encodeURIComponent(item.contactId)
  return `${APP_BASE}/dashboard/clients/${client}/crm/all?contact=${contact}`
}

function renderRow(item: DigestItem, index: number, ms: number): string {
  const name = stripAddress(contactCardTitle(item.displayName))
  const subject = item.subject?.trim() ? item.subject : '（这封信没有主题）'
  return `
      <div style="margin:12px 0;padding:12px 14px;background:#f8fafc;border-radius:8px">
        <div style="font-weight:600;color:#0f172a">${index + 1}. ${esc(name)}</div>
        <div style="margin-top:4px;font-size:14px;color:#475569">主题：${esc(subject)}</div>
        <div style="margin-top:6px;font-size:13px;color:#b45309">已经等了 ${humanWait(ms)}</div>
        <div style="margin-top:8px;font-size:13px">
          <a href="${contactUrl(item)}" style="color:#0891b2">→ 打开这位客人的记录</a>
        </div>
      </div>`
}

/** 「今天的信没进全」——这份名单不完整，得在名单**前面**说。 */
function staleBanner(syncStale: boolean): string {
  if (!syncStale) return ''
  return `
      <p style="margin:0 0 18px;padding:12px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;font-size:14px;color:#991b1b">
        <b>这份名单今天不完整</b>：公司邮箱那边没有全部同步进来，没进系统的信不会出现在下面。
        所以「下面就这几封」这句话今天不成立 —— 我们已经在查了。
      </p>`
}

/** 「名单之外还有几封」——放在名单**末尾**，紧跟着最后一条。 */
function cappedNote(dropped: number): string {
  if (dropped <= 0) return ''
  return `
      <p style="margin:14px 0 0;padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:14px;color:#9a3412">
        另有 <b>${dropped}</b> 封同样超时没回的没有列在上面（一封信一次最多列这么多）。
        它们不是不存在 —— 在后台「全部客人」里能看到全部。
      </p>`
}

/**
 * 正文。第一段固定是测试声明（PM 硬性要求），随后按等待时长从长到短列。
 *
 * `extra` 里那两条不是可有可无的补充：少了它们，这封信会把一个**说小了的数字**
 * 当成事实报给销售（见文件头第 4 条）。
 */
export function buildDigestBody(
  clientName: string,
  items: DigestItem[],
  now: Date,
  extra: DigestExtra = {},
): string {
  const dropped = extra.dropped ?? 0
  const rows = items
    .map((item) => ({ item, ms: waitedMs(item, now) }))
    .sort((a, b) => byWaitDesc(a.ms, b.ms))
    .map((r, i) => renderRow(r.item, i, r.ms))
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 18px;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:14px;color:#92400e">
        <b>${DIGEST_TEST_PREFIX}</b>这封信来自 Magic Engine 正在测试的新功能：自动盯住迟迟没有回复的客人来信，
        每天提醒一次。<b>内容不对、或者其实已经回过了，请直接回复这封邮件告诉我们</b>，我们照着改。
        这个功能不会替你回复任何客人。
      </p>
      ${staleBanner(extra.syncStale === true)}
      <p style="font-size:16px;font-weight:600;margin:0 0 4px">
        ${esc(clientName)} 有 ${items.length + dropped} 封客人来信在等回复，等最久的排在最前：
      </p>
      ${rows}
      ${cappedNote(dropped)}
      <p style="margin-top:20px;font-size:11px;color:#94a3b8">
        Magic Engine · 测试中的功能，暂不影响你现有的工作方式。
      </p>
    </div>`
}

function defaultMailer(apiKey: string): DigestMailer {
  return new Resend(apiKey)
}

/**
 * 发一封汇总信。永不抛异常 —— 上游那趟同步不该因为发信失败而整个失败。
 *
 * 收件人策略：调用方给了就用调用方的；给空或没给，退回 ME 自己的信箱。
 * 绝不猜客户地址。
 */
export async function sendEmailReplyDigest(
  clientName: string,
  items: DigestItem[],
  options: DigestExtra & {
    recipients?: string[]
    now?: Date
    apiKey?: string
    mailerFactory?: (apiKey: string) => DigestMailer
  } = {},
): Promise<DigestSendResult> {
  const recipients =
    options.recipients && options.recipients.length > 0
      ? options.recipients
      : [ME_MAIL_TO_ADDRESS]

  if (items.length === 0) {
    return { sent: false, reason: '无待回邮件', recipients }
  }

  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY 未配置', recipients }
  }

  // 主题里的数字是**总数**，不是名单长度 —— 被压掉的那些也在等着（文件头第 4 条）。
  const extra: DigestExtra = { dropped: options.dropped ?? 0, syncStale: options.syncStale }

  try {
    const mailer = (options.mailerFactory ?? defaultMailer)(apiKey)
    const { error } = await mailer.emails.send({
      from: meMailFrom(`${DIGEST_TEST_PREFIX}Magic Engine 客人来信提醒`),
      to: recipients,
      subject: buildDigestSubject(clientName, items.length + (extra.dropped ?? 0)),
      html: buildDigestBody(clientName, items, options.now ?? new Date(), extra),
    })
    if (error) {
      return { sent: false, reason: describeSendError(error), recipients }
    }
    return { sent: true, recipients }
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : '发信时出现未知错误',
      recipients,
    }
  }
}
