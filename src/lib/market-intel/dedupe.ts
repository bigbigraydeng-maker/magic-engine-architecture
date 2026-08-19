import { createHash } from 'crypto'

/**
 * v2 fix (2026-08-20 设计审): v1 的公式是 normalize(title + domain)，把来源域名
 * 算进哈希，导致两个不同网站报道同一件事永远判不出重复——这恰好是它自己声称要
 * 防的场景（"防止同一条新闻从多个信源重复收进来"）。改成只对标题取哈希，不含
 * domain，跨信源的同一条新闻才能被识别为重复。
 *
 * 代价：两篇标题相似但内容不同的文章可能被误判成重复，这是可接受的权衡——
 * 大新闻标题在不同媒体上高度相似，正是要去重的场景；数量级很小的误判比
 * "同一条大新闻连续几天出现在邮件里"更可接受。
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'is', 'for', 'with', 'at', 'by',
])

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // 去标点，保留字母数字空格（含非拉丁字符）
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(' ')
    .trim()
}

export function dedupeHash(title: string): string {
  const normalized = normalizeTitle(title)
  return createHash('sha256').update(normalized).digest('hex')
}
