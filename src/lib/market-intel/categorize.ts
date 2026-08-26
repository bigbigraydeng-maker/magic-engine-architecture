import type { MarketIntelCategory, RawFeedItem } from './types'

/**
 * 关键词白名单只给"泛泛新闻 vs 真正的营销/广告资讯"容易混的三类广告平台分类。
 * `ai_startup` / `marketing` / `llm_news` / `chatgpt_ads` / `china_outbound`
 * 不设白名单——它们的信源本身就是话题范围已经收窄的分类源（要么是垂直媒体如
 * TechCrunch AI，要么是 Google News 按主题预筛的查询 feed），只要来自这些
 * 信源就算数，不需要再用短语二次过滤。
 *
 * 匹配规则（设计文档 §7.2 锁死）：标题或摘要包含完整短语，大小写不敏感，
 * 不做拆词后的模糊匹配——否则"Meta 财报"这类泛科技新闻会被误判进 meta_ads。
 */
export const CATEGORY_WHITELISTS: Partial<Record<MarketIntelCategory, string[]>> = {
  meta_ads: [
    'Meta Ads', 'Facebook Ads', 'Instagram Ads', 'Instagram advertising', 'IG Ads',
    'Ads Manager', 'Advantage+', 'Meta advertising', 'Facebook advertising',
  ],
  google_ads: ['Google Ads', 'Performance Max', 'Smart Bidding', 'Google advertising', 'PPC'],
  tiktok_ads: ['TikTok Ads', 'TikTok for Business', 'TikTok advertising', 'Spark Ads', 'TikTok Shop ads'],
  // llm_news / chatgpt_ads / china_outbound 不设白名单——它们的信源本身就是
  // Google News 按主题查询预筛过的（例如 "ChatGPT ads" 查询本身已经是过滤条件），
  // 跟 ai_startup / marketing 一样走"来源即数"，不需要标题短语二次过滤。
}

/** 完整短语命中，大小写不敏感。不是拆词匹配。 */
export function hasPhrase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase())
}

function itemMatchesCategory(item: RawFeedItem, category: MarketIntelCategory): boolean {
  const whitelist = CATEGORY_WHITELISTS[category]
  if (!whitelist) return true // 无白名单的分类（ai_startup / marketing）：来源即数
  const haystack = `${item.title} ${item.excerpt}`
  return whitelist.some((phrase) => hasPhrase(haystack, phrase))
}

/**
 * 按信源声明的候选分类（数组顺序即优先级）逐个尝试，返回第一个命中的分类。
 * 全部不命中则返回 null——该条目不入库（§7.2："不命中的条目不进入候选池"）。
 */
export function matchCategory(
  item: RawFeedItem,
  sourceCategories: MarketIntelCategory[],
): MarketIntelCategory | null {
  for (const category of sourceCategories) {
    if (itemMatchesCategory(item, category)) return category
  }
  return null
}
