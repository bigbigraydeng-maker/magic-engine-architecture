/**
 * 把 info@ 邮箱里的付款事实，变成 Mailchimp 上的 `paid_customer` 标签。
 *
 * 读信在 `microsoft/mail-graph`，判信在 `mailchimp/paid-signal`，改标签在
 * `mailchimp/tags` —— 这里只负责把三件事串起来，并且**决定什么时候不做**。
 *
 * ## 为什么要它
 *
 * 2026-09-01 那次 192 人的群发里混进了 2 个已付款客户，其中 Nikki Smith 是
 * Baker 亲口回过「your payment has been received in full」的人。根因不是判得不准，
 * 是**根本没有任何自动化**：`paid_customer` 那 19 个标签全靠人翻邮箱手打，
 * 8/30 打过一次之后就再没人打过。
 *
 * ## 两档，不是一档
 *
 *   confirmed     我们自己确认过钱到账 → 自动打标签、自动摘掉线索标签
 *   needs_review  客人说他付了 / 甩了张回单 → **不自动打**，下发成人工任务
 *
 * 分两档是因为误判的两个方向代价完全不对等：漏打一个，这个人多收一封营销邮件；
 * 错打一个，一个正在谈的客人被停掉全部跟进 —— 这单就丢了。所以只有「我们自己
 * 说收到了」才够格自动执行，其余一律交给人点一下（铁律 3 下半：确实做不了的
 * 必须下发成人工任务，且带 what / how / href，不许烂在日志里）。
 *
 * ## 标签名必须是客户配置，不是平台常量
 *
 * `paid_customer` / `fb_lead` 这些名字是 CTS 的 Mailchimp 里长出来的，不是平台
 * 规则（平台化红线 2：客户事实不进 shared runtime）。所以 policy 由调用方传进来，
 * 这里只给一个语义通用的默认付费标签名，**线索标签一个默认值都不给** ——
 * 「哪些标签算线索」在每个客户那里都不一样，给默认值等于把 CTS 的事实
 * 悄悄变成所有客户的规则。
 */

import { readPaidSignal, evidenceIsVerbatim, looksLikeCustomerAddress } from './paid-signal'
import { applyMemberTags, type MailchimpTagsConfig } from './tags'

/** 一封待判定的邮件。字段刻意只取 `microsoft/mail-graph` 已经给的那些。 */
export interface CandidateMail {
  id: string
  subject: string | null
  preview: string
  receivedAt: string
  direction: 'inbound' | 'outbound'
  counterparty: { address: string; name: string | null } | null
  /** 带附件吗 —— 付款截图/回单常常整封信只有一句「见附件」，正文判不出来。 */
  hasAttachment?: boolean
}

export interface PaidTaggingPolicy {
  /**
   * 付费客户标签名。语义通用，所以敢给默认值。
   */
  paidTag: string
  /**
   * 成交后要摘掉的线索类标签。**没有默认值** —— 每个客户的线索标签叫什么
   * 都不一样，给默认等于把某一个客户的事实写成平台规则。
   */
  leadTagsToRemove: string[]
}

export const DEFAULT_PAID_TAG = 'paid_customer'

export interface PaidTaggingResult {
  scanned: number
  /** 自动打上标签的人（含摘掉的线索标签）。 */
  tagged: Array<{ email: string; evidence: string; added: string[]; removed: string[] }>
  /** 判定为「有付款意思但要人确认」的 —— 调用方据此下发人工任务。 */
  needsReview: Array<{ email: string; name: string | null; evidence: string; receivedAt: string }>
  /** 命中确认句，但这个邮箱不在 Mailchimp 名单里 —— 绝不新建，如实报数。 */
  notInAudience: string[]
  /** 判成催款的 —— 这些人**还没付**，单独报出来防止有人回头以为漏了。 */
  chasing: string[]
  /** 打标签时真的失败了的。 */
  errors: Array<{ email: string; reason: string; retryable: boolean }>
}

function emptyResult(): PaidTaggingResult {
  return { scanned: 0, tagged: [], needsReview: [], notInAudience: [], chasing: [], errors: [] }
}

/** 主题 + 摘要拼成可搜文本 —— 确认句可能只出现在其中一处。 */
function searchableText(mail: CandidateMail): string {
  return [mail.subject ?? '', mail.preview ?? ''].join(' ').trim()
}

/**
 * 扫一批邮件，该打的打上，该问人的攒起来。
 *
 * **同一个人在一批里可能有多封确认信**（定金一封、尾款一封）。这里靠
 * `applyMemberTags` 自身的幂等短路兜住：第二封查到标签已经对了就直接 noop，
 * 不会重复发写请求，也不会在 `tagged` 里出现两次。
 */
export interface RunOptions {
  /**
   * 只判定不写。补历史要一次动几百个人，先看清楚会打谁再真打 ——
   * 「跑了才发现判错」在生产标签上是不可逆的（客人已经被移出群发名单了）。
   *
   * 注意 dry 跑**仍然会查** Mailchimp：不查就不知道这个人在不在名单里、
   * 标签是不是已经对了，预演出来的数字会比真跑虚高一大截，等于没预演。
   */
  dryRun?: boolean
}

export async function runPaidTagging(
  mails: CandidateMail[],
  cfg: MailchimpTagsConfig,
  policy: PaidTaggingPolicy,
  opts: RunOptions = {},
): Promise<PaidTaggingResult> {
  const out = emptyResult()
  const alreadyTagged = new Set<string>()

  for (const mail of mails) {
    out.scanned += 1
    const text = searchableText(mail)
    const address = mail.counterparty?.address ?? null

    const verdict = readPaidSignal({ text, direction: mail.direction, hasAttachment: mail.hasAttachment })
    if (verdict.kind === 'not_payment') continue

    // 身份闸：自己人 / 机器人一律不当客人。一封 outbound 的收件人可能是同事，
    // 真实语料里就有 `Fw: New Reborn Lead: ...` 这种转发。
    if (!looksLikeCustomerAddress(address)) continue
    const email = (address as string).trim().toLowerCase()

    if (verdict.kind === 'chasing') {
      if (!out.chasing.includes(email)) out.chasing.push(email)
      continue
    }

    // 铁律 8：说不出原话就不算数。evidence 必须能在原文里逐字找回来，
    // 对不上就整条丢掉 —— 宁可继续空着，也不要编一句。
    if (!evidenceIsVerbatim(verdict.evidence, text)) continue

    if (verdict.kind === 'needs_review') {
      out.needsReview.push({
        email,
        name: mail.counterparty?.name ?? null,
        evidence: verdict.evidence,
        receivedAt: mail.receivedAt,
      })
      continue
    }

    if (alreadyTagged.has(email)) continue
    const applied = await applyMemberTags(
      cfg,
      email,
      { add: [policy.paidTag], remove: policy.leadTagsToRemove },
      { dryRun: opts.dryRun === true },
    )

    if (applied.status === 'applied') {
      alreadyTagged.add(email)
      out.tagged.push({ email, evidence: verdict.evidence, added: applied.added, removed: applied.removed })
    } else if (applied.status === 'noop') {
      alreadyTagged.add(email)
    } else if (applied.status === 'skipped') {
      if (!out.notInAudience.includes(email)) out.notInAudience.push(email)
    } else {
      out.errors.push({ email, reason: applied.reason, retryable: applied.retryable })
    }
  }

  return out
}
