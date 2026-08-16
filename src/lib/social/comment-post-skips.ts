/**
 * Posts whose comments we already know we cannot read — so the auto-reply cron
 * stops asking Meta the same question every 30 minutes.
 *
 * WHY
 * ---
 * 2026-08-15 生产日志：CTS 每半小时扫 149 个帖子，其中一批固定回 400
 * （#10 缺权限 / #100 帖子不存在 / #12 老式 status 对象已下线），
 * 而那一轮 cron 仍然记成 `ok: true`。既没人看见，也没人停手 ——
 * 每小时两轮，同样的失败重复一整天。
 *
 * 这里存的是「问过了，答案不会变」。存在 `social_comment_config
 * .unreadable_post_ids`（jsonb 数组），不新建表：这批数据只服务这一个功能，
 * 一个客户一行，随配置一起读一起写。
 *
 * 每条都带 `retry_after`，没有「永不再试」：
 *   · 帖子没了 / 端点下线  → 一年后再试（等于不再试，但不会永远钉死）
 *   · 缺权限               → 一天后再试（人补上权限后，第二天自己恢复，
 *                            不需要谁记得回来清标记）
 *
 * 🔴 列还没上库时（migration 未 apply）读写都会报错。这里一律降级成
 *    「没有跳过名单」+ 一条 warn，绝不让它把整轮 cron 拖垮 —— 先扩后收。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommentFetchFailure, CommentFetchFailureReason } from '@/lib/meta/comments'

/** One remembered dead end. */
export interface PostSkip {
  post_id: string
  reason: CommentFetchFailureReason
  /** Graph error code, kept so a human can tell what Meta actually said. */
  code: number | null
  message: string
  first_seen: string
  last_seen: string
  /** Before this instant, do not call Meta for this post again. */
  retry_after: string
}

/** How long each kind of dead end stays remembered. */
const RETRY_AFTER_DAYS: Record<CommentFetchFailureReason, number> = {
  // 缺权限是人能修好的 —— 只压一天，修好了第二天自己恢复
  permission_denied: 1,
  // 帖子已经没了 / 端点已经下线 —— 一年，实际等于不再问
  object_gone: 365,
  deprecated_object: 365,
  // 这两类不进名单（见 isPersistableFailure），列在这里只为类型完整
  token_invalid: 0,
  transient: 0,
}

/**
 * 名单上限。CTS 现在扫 149 个帖子，500 足够放下最坏情况还有余量；
 * 超出时丢掉最久没再遇到的那些（它们本来也快到期了）。
 */
export const MAX_SKIPS = 500

/**
 * 哪些失败值得记进名单。
 *
 * `token_invalid` 故意不进：令牌失效是**整个主页**的事，不是某个帖子的事。
 * 把它记成 149 条帖子级跳过，等于令牌换好之后还要等一天才恢复。
 */
export function isPersistableFailure(failure: CommentFetchFailure): boolean {
  return (
    failure.reason === 'permission_denied' ||
    failure.reason === 'object_gone' ||
    failure.reason === 'deprecated_object'
  )
}

/** 现在还该跳过吗。 */
export function isStillSkipped(skip: PostSkip | undefined, now: Date): boolean {
  if (!skip) return false
  const until = Date.parse(skip.retry_after)
  if (Number.isNaN(until)) return false
  return now.getTime() < until
}

/** 新失败合并进已有记录：首次时间保留，其余按这次的来。 */
export function mergeSkip(
  prev: PostSkip | undefined,
  postId: string,
  failure: CommentFetchFailure,
  now: Date,
): PostSkip {
  const iso = now.toISOString()
  const days = RETRY_AFTER_DAYS[failure.reason] ?? 1
  return {
    post_id: postId,
    reason: failure.reason,
    code: failure.code,
    message: failure.message.slice(0, 300),
    first_seen: prev?.first_seen ?? iso,
    last_seen: iso,
    retry_after: new Date(now.getTime() + days * 86_400_000).toISOString(),
  }
}

/** 超出上限时丢掉最久没再遇到的。 */
export function capSkips(skips: PostSkip[], max = MAX_SKIPS): PostSkip[] {
  if (skips.length <= max) return skips
  return [...skips]
    .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
    .slice(0, max)
}

/** 只接受形状对得上的行 —— 库里可能留着上个版本写的数据。 */
function isPostSkip(row: unknown): row is PostSkip {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return typeof r.post_id === 'string' && typeof r.retry_after === 'string'
}

export async function loadPostSkips(
  supabase: SupabaseClient,
  clientId: string,
): Promise<PostSkip[]> {
  // 单独一次查询，不并进 cron 那条 select：列还没上库时，
  // 合在一起会让整轮 cron 直接查询失败，一个客户都跑不了。
  const { data, error } = await supabase
    .from('social_comment_config')
    .select('unreadable_post_ids')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn('[comment-post-skips] 读取跳过名单失败（当作空名单继续）:', error.message)
    return []
  }
  const raw = (data as { unreadable_post_ids?: unknown } | null)?.unreadable_post_ids
  if (!Array.isArray(raw)) return []
  return raw.filter(isPostSkip)
}

export async function savePostSkips(
  supabase: SupabaseClient,
  clientId: string,
  skips: PostSkip[],
): Promise<void> {
  const { error } = await supabase
    .from('social_comment_config')
    .update({ unreadable_post_ids: capSkips(skips), updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
  if (error) {
    console.warn('[comment-post-skips] 写入跳过名单失败（下一轮会重新遇到同样的失败）:', error.message)
  }
}
