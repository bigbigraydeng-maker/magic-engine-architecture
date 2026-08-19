/**
 * boost_existing_post 的候选来源 —— CTS 主页最近发的、互动最好的视频帖。
 *
 * ── 为什么是薄封装，不是新打分模型（Build Control 木桶原则第一轮裁决）───────
 * "仅复用现有自然互动排序，输出候选和证据；不新增评分模型、不做自动赢家判定"。
 * 这里唯一的工作是把 `meta/page-posts.ts` 现成的 `fetchPagePosts` +
 * `rankVideoWinners` 的输出，重新摆成 boost_existing_post 用得上的形状
 * （`objectStoryId` 是 `pageId_postId`，直接对应 `PagePost.fullId`）——
 * 打分公式、recency boost、黑名单过滤，一概不动，全部来自 `page-posts.ts`。
 *
 * ── 为什么不用 fetchPageReels ─────────────────────────────────────────────
 * `fetchPageReels()` 拿到的是真实的 Reels，但它的 `score` 恒为 0（那个字段
 * 选择里没有 reactions/shares，只有评论数）——直接用会把"候选"变成"按发布
 * 时间倒序"，不是"按互动排序"。要让它可用，得把两个数据源按 id 拼接、
 * 再重新算分：这正是 Build Control 点名不要做的"新增评分模型/整合逻辑"。
 * `fetchPagePosts()` + `rankVideoWinners()` 已经在给别的场景（winner-reel-
 * sync）挑视频类内容用，直接复用，缺点是候选里可能混进非 Reel 格式的
 * 常规视频帖 —— 这正是"不自动判定赢家、输出候选给人挑"存在的意义：
 * 人一眼就能看出哪条是 Reel。
 *
 * ── 不做的事 ────────────────────────────────────────────────────────────
 * 不反查 content_posts / content_work_orders 找"这是哪个工单出的片"
 * （Build Control 点名不做模糊匹配）；不自动选 top1（同上，人来选）。
 */

import { fetchPagePosts, rankVideoWinners, type PagePost } from '@/lib/meta/page-posts'

export interface BoostCandidate {
  /** `pageId_postId` 形式，直接可用作 AdDraft.objectStoryId。 */
  objectStoryId: string
  createdAt: string
  message: string
  /** 来自 page-posts.ts 的 scorePost()，未经改动。 */
  score: number
  reactions: number
  comments: number
  shares: number
}

export interface ListBoostCandidatesOptions {
  /** 拉最近多少条帖子来挑（不是返回多少条候选）。 */
  fetchLimit?: number
  /** 屏蔽词——含这些词的帖子不进候选（复用 rankVideoWinners 的黑名单机制）。 */
  blacklistKeywords?: string[]
  /** 分数低于这个值的不进候选。 */
  minScore?: number
}

function toCandidate(p: PagePost): BoostCandidate {
  return {
    objectStoryId: p.fullId,
    createdAt: p.createdAt,
    message: p.message,
    score: p.score,
    reactions: p.reactions,
    comments: p.comments,
    shares: p.shares,
  }
}

/**
 * 列出可以拿去 boost 的候选（按互动分排序，不自动挑）。
 *
 * @param pageId Meta 主页 id
 * @param pageAccessToken Page Access Token（不是 User Token —— fetchPagePosts 要求）
 */
export async function listBoostCandidates(
  pageId: string,
  pageAccessToken: string,
  opts: ListBoostCandidatesOptions = {},
): Promise<BoostCandidate[]> {
  const posts = await fetchPagePosts(pageId, pageAccessToken, opts.fetchLimit ?? 30)
  const ranked = rankVideoWinners(posts, opts.blacklistKeywords ?? [], opts.minScore ?? 0)
  return ranked.map(toCandidate)
}
