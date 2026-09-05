/**
 * 收录状态的本地判据与三分类 —— 单一真相源。
 *
 * 「未收录」的权威信号是 `client_site_pages.first_not_indexed_at` 非空：
 * 每日 URL 收录轮检（`seo-patrol/index-check.ts`）在页面翻回已收录时会把它清成
 * null，所以「非空 ⟺ 当前未被谷歌收录」始终成立。
 *
 * 三分类只对未收录页面有意义，对应三种不同的处理动作：
 *   unknown  — 谷歌还不认识这个网址（index_verdict = 'URL is unknown to Google'）→ 去 GSC 请求编入索引
 *   thin     — 谷歌爬过，但正文太薄（word_count < THIN_WORD_COUNT_THRESHOLD）  → 补内容、加内链
 *   declined — 爬过、字数够，谷歌仍没收录                                        → 去 GSC 请求编入索引
 *
 * 这套判据原来内联在 `pm-todo/buildNotIndexedItems` 里。站点页面清单 API 现在也要
 * 按同一口径分类，抽出共享 —— 否则「300 词」和「unknown 文案」会在两处各写一份，
 * 日后一处改了另一处忘改，待办的汇总数和清单页的分类就对不上。
 */

/** 正文字数低于此值算「内容太薄」。改这里，待办和清单页同步生效。 */
export const THIN_WORD_COUNT_THRESHOLD = 300

/** 谷歌 coverageState 里「压根不认识这个网址」的原文（verbatim from GSC）。 */
export const UNKNOWN_TO_GOOGLE = 'URL is unknown to Google'

export type IndexClass = 'unknown' | 'thin' | 'declined'

/** 权威判据：`first_not_indexed_at` 非空 ⟺ 当前未被谷歌收录。 */
export function isNotIndexed(firstNotIndexedAt: string | null | undefined): boolean {
  return !!firstNotIndexedAt
}

/**
 * 未收录页面的本地三分类。
 *
 * 判据顺序不能改：先认「谷歌不认识」，再认「内容太薄」，剩下的才是「爬过却没收录」。
 * 一个未知网址的 word_count 也可能 < 300，若先判 thin 会把它错归成「补内容」，
 * 但它真正的问题是谷歌还没抓到，补内容也没用 —— 所以 unknown 必须优先。
 *
 * ⚠️ 只对确认未收录（isNotIndexed 为真）的行调用；已收录 / 未检查的行没有分类语义。
 */
export function classifyNotIndexed(row: {
  index_verdict: string | null
  word_count: number | null
}): IndexClass {
  // .trim() 防脆：coverageState 是 GSC 原样回写的文本，偶发首尾空格不该让一个
  // 「谷歌不认识」的页面被错归成 thin（→ 误导人去补内容，而它真正缺的是被抓取）。
  if (row.index_verdict?.trim() === UNKNOWN_TO_GOOGLE) return 'unknown'
  if ((row.word_count ?? 0) < THIN_WORD_COUNT_THRESHOLD) return 'thin'
  return 'declined'
}
