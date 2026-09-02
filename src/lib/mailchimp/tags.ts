/**
 * 给**已经在名单里**的联系人加 / 摘标签。
 *
 * ## 为什么这个文件在 2026-09-02 才出现
 *
 * 在这之前 ME 跟 Mailchimp 的连接是**单向**的：`sync.ts` 把「谁打开了邮件」读回
 * CRM，`client.ts` 的 `subscribeMember` 只能在人**第一次进名单那一刻**带一个标签。
 * 也就是说，一个人进来之后状态再怎么变，Mailchimp 那边永远不会知道 ——
 * `paid_customer` 那 19 个标签全是 2026-08-30 有人翻邮箱手工打上去的。
 *
 * 手工的代价当天就付了：9/1 那次 192 人的群发混进了 2 个已付款客户，其中一个是
 * Baker 亲口回过「your payment has been received in full」的 Nikki Smith。
 *
 * ## 一条不许破的线：只改已有的人，绝不新建
 *
 * 跟 `sync.ts` 开头那条护栏同源 —— 找不到就跳过并计数，**绝不为一个只在别处
 * 存在的邮箱凭空建联系人**。这里更狠一点的理由是：打标签会直接改变这个人收不收
 * 得到邮件。给一个来路不明的地址建人再打上 `paid_customer`，等于凭空把他从所有
 * 营销名单里踢出去，而且没有任何人会发现。
 *
 * ## PII
 *
 * 错误信息里**不回显邮箱**（同 `client.ts` 的 `safeReadTitle`：只读 title 不读
 * detail，因为 detail 常常把 email 原样吐回来）。调用方要定位是哪个人，用它自己
 * 手上那份输入，不靠我们的日志。
 */

import { createHash } from 'node:crypto'

const API_VERSION = '3.0'
const REQUEST_TIMEOUT_MS = 20_000

/** Mailchimp 用 email 小写后的 md5 当 subscriber_hash。 */
export function subscriberHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

function datacenterFromKey(apiKey: string): string {
  const dc = apiKey.split('-').pop()
  if (!dc) throw new Error('bad_api_key_format')
  return dc
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface MailchimpTagsConfig {
  apiKey: string
  audienceId: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

// ── 查人 ────────────────────────────────────────────────────────────────────

export interface FoundMember {
  email: string
  /** subscribed / unsubscribed / cleaned / transactional / pending / archived */
  status: string
  tags: string[]
}

export type FindMemberResult =
  | { status: 'found'; member: FoundMember }
  | { status: 'not_in_audience' }
  | { status: 'error'; reason: string; retryable: boolean }

/**
 * 这个邮箱在不在名单里。
 *
 * 404 是**正常结果**不是错误 —— 名单里没有这个人是每天都会发生的事（客人用
 * 另一个邮箱付的款、供应商的地址、内部转发）。把它当 error 会让调用方分不清
 * 「没这个人」和「Mailchimp 挂了」，而这两件事的处理方式完全相反。
 */
export async function findMemberByEmail(
  cfg: MailchimpTagsConfig,
  email: string,
): Promise<FindMemberResult> {
  const clean = email.trim().toLowerCase()
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { status: 'error', reason: 'invalid_email', retryable: false }
  }

  let dc: string
  try {
    dc = datacenterFromKey(cfg.apiKey)
  } catch {
    return { status: 'error', reason: 'bad_api_key_format', retryable: false }
  }

  const url =
    `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}` +
    `/members/${subscriberHash(clean)}?fields=email_address,status,tags`

  const doFetch = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return { status: 'error', reason: timeout ? 'timeout' : 'network', retryable: true }
  }

  if (res.status === 404) return { status: 'not_in_audience' }
  if (res.status === 401) return { status: 'error', reason: 'unauthorized', retryable: false }
  if (!res.ok) return { status: 'error', reason: `http_${res.status}`, retryable: res.status >= 500 }

  try {
    const json = (await res.json()) as {
      email_address?: string
      status?: string
      tags?: Array<{ name?: string }>
    }
    return {
      status: 'found',
      member: {
        email: json.email_address ?? clean,
        status: json.status ?? 'unknown',
        tags: (json.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
      },
    }
  } catch {
    return { status: 'error', reason: 'bad_json', retryable: false }
  }
}

// ── 改标签 ──────────────────────────────────────────────────────────────────

export interface ApplyTagsInput {
  /** 要加上的标签名。Mailchimp 里标签不存在会自动建。 */
  add?: string[]
  /** 要摘掉的标签名。摘一个本来就没有的标签不报错。 */
  remove?: string[]
}

export type ApplyTagsResult =
  | { status: 'applied'; added: string[]; removed: string[] }
  | { status: 'noop'; reason: 'nothing_to_do' | 'already_correct' }
  | { status: 'skipped'; reason: 'not_in_audience' }
  | { status: 'error'; reason: string; retryable: boolean }

/**
 * 给一个**已经在名单里**的人改标签。
 *
 * 先查再改，有三个理由，少一个都会出事：
 *   1. 人不在名单里就跳过 —— 绝不新建（见文件头）。
 *   2. 标签已经对了就不发写请求 —— 补历史要跑几百个人，重跑必须是幂等且便宜的。
 *   3. 拿到真实的 tags 才能算出「实际加了什么、摘了什么」，日志才不是猜的。
 */
export interface ApplyTagsOptions {
  /**
   * 只算不写 —— 补历史前的预演。
   *
   * **仍然会发那次查询**：不查就不知道人在不在名单里、标签是不是已经对了，
   * 预演出来的「会打多少人」会比真跑虚高一大截，等于没预演。省掉的只有写请求。
   */
  dryRun?: boolean
}

export async function applyMemberTags(
  cfg: MailchimpTagsConfig,
  email: string,
  input: ApplyTagsInput,
  opts: ApplyTagsOptions = {},
): Promise<ApplyTagsResult> {
  const add = (input.add ?? []).map((t) => t.trim()).filter(Boolean)
  const remove = (input.remove ?? []).map((t) => t.trim()).filter(Boolean)
  if (add.length === 0 && remove.length === 0) return { status: 'noop', reason: 'nothing_to_do' }

  const found = await findMemberByEmail(cfg, email)
  if (found.status === 'not_in_audience') return { status: 'skipped', reason: 'not_in_audience' }
  if (found.status === 'error') return found

  const have = new Set(found.member.tags)
  const toAdd = add.filter((t) => !have.has(t))
  const toRemove = remove.filter((t) => have.has(t))
  if (toAdd.length === 0 && toRemove.length === 0) return { status: 'noop', reason: 'already_correct' }

  // 预演在这里收手 —— 上面那次查询已经发生过了，所以 added/removed 是**真实**
  // 会发生的动作，不是估的。
  if (opts.dryRun) return { status: 'applied', added: toAdd, removed: toRemove }

  const body = {
    tags: [
      ...toAdd.map((name) => ({ name, status: 'active' as const })),
      ...toRemove.map((name) => ({ name, status: 'inactive' as const })),
    ],
  }

  const dc = datacenterFromKey(cfg.apiKey)
  const url =
    `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}` +
    `/members/${subscriberHash(email)}/tags`

  const doFetch = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return { status: 'error', reason: timeout ? 'timeout' : 'network', retryable: true }
  }

  // 打标签成功返回 204 No Content。
  if (res.status === 204 || res.ok) return { status: 'applied', added: toAdd, removed: toRemove }
  if (res.status === 401) return { status: 'error', reason: 'unauthorized', retryable: false }
  return { status: 'error', reason: `http_${res.status}`, retryable: res.status >= 500 }
}
