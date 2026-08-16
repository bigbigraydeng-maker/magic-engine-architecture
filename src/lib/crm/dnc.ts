/**
 * 「别再联系」到底成不成立 —— **全仓只有这一份判据**。
 *
 * 这是系统里最重的一个标记：成立就意味着**任何渠道都不许再发**。所以它的
 * 真相源是**不可变的触点**，不是 `contacts.do_not_contact` 那一列 ——
 * 那一列是尽力维护的反规范化，写失败过，历史导入的 294 条跟进记录也只写了
 * `metadata.outcome`。少打一通电话的代价，远小于打给一个明确说过别打的人。
 *
 * ## 为什么需要「取消」这条路（PM 2026-08-16）
 *
 * 早前的判词把「not intending to go」（我不打算去）当成了「别再联系我」，
 * 于是有人被永久静默排除。词表已经改好，但**存量那些人回不来**：
 *
 *   · 取消 `contacts.do_not_contact` 那一列**没有用** —— 上面说了，
 *     判据看的是触点，那条误判的触点还在
 *   · 而系统里**根本没有取消的入口**
 *
 * 也就是说，在这个函数存在之前，「这个人被误判了」是一件**没有人做得到**的事。
 * 下发一条「去把勾取消掉」的人工任务，FDE 照做也不会有任何变化，第二天任务
 * 又冒出来 —— 那比不下发更糟。
 *
 * ## 为什么是「人明确纠正」，而不是让规则自己解开
 *
 * 让正则去**解除**这个闸，方向恰好反了：万一某人原话里同时含着真正的拒绝，
 * 我们就会去骚扰一个明确说过别联系的客人。所以自动解除一律不做。
 *
 * 但**人**明确说「这条判错了」是另一回事 —— 那是这套系统里最强的信号，
 * 比一句两个月前的正则判断硬得多。纠正同样写成一条触点（真相源不可变，
 * 谁在什么时候纠正的都留痕），然后**看最后一次判决**：
 * 跟 `phoneLineIsDead`、`latestIntentVerdict` 是同一条道理。
 */

/** 只有这两种触点算「对『别再联系』的判决」。 */
const DNC_VERDICTS = new Set(['do_not_contact', 'dnc_cleared'])

/** 人纠正「这条判错了」时写下的那种触点。 */
export const DNC_CLEARED_OUTCOME = 'dnc_cleared'

export interface DncTouch {
  /** `metadata.outcome` */
  outcome?: string | null
  /** `metadata.do_not_contact === true` */
  flagged?: boolean
  occurredAt: string
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 这个人现在算不算「别再联系」。
 *
 * @param contactFlag `contacts.do_not_contact` 那一列
 * @param touches     这个人的全部触点
 *
 * 判法：
 *   1. 有人**明确纠正过**，而且那次纠正**晚于**最后一条拒联证据 → 不算
 *   2. 否则只要那一列说是、或任何一条触点说过 → 算（宁可少打一通）
 */
export function isDoNotContact(contactFlag: boolean, touches: DncTouch[]): boolean {
  const said = (t: DncTouch): boolean =>
    t.flagged === true || t.outcome === 'do_not_contact'

  const latestVerdict = touches
    .filter((t) => (t.outcome && DNC_VERDICTS.has(t.outcome)) || said(t))
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0]

  // 最后一次判决是「人说判错了」—— 这时连 contacts 那一列都不算数：
  // 纠正的人看过原话，而那一列很可能正是当初被误判时写上去的。
  if (latestVerdict?.outcome === DNC_CLEARED_OUTCOME) return false

  return contactFlag || touches.some(said)
}
