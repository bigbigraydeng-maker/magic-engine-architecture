import type { MarketIntelCategory, SummarizedItem } from './types'

const CATEGORY_LABELS: Record<MarketIntelCategory, string> = {
  ai_startup: 'AI 创业动态',
  marketing: '数字营销大盘',
  meta_ads: 'Meta / Facebook 广告',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok 广告',
  llm_pricing: '大模型 Token 定价',
}

// 展示顺序按设计文档 §四表格的顺序，不是按当天条数排。
const CATEGORY_ORDER: MarketIntelCategory[] = [
  'ai_startup',
  'marketing',
  'meta_ads',
  'google_ads',
  'tiktok_ads',
  'llm_pricing',
]

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderItem(item: SummarizedItem): string {
  const published = item.publishedAt ? new Date(item.publishedAt) : null
  const dateStr = published
    ? published.toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })
    : ''
  return `
    <div style="padding:14px 0;border-bottom:1px solid #e2e8f0">
      <a href="${escapeHtml(item.url)}" style="font-size:15px;font-weight:600;color:#0f172a;text-decoration:none">
        ${escapeHtml(item.headlineZh)}
      </a>
      <p style="margin:6px 0 4px;font-size:13.5px;color:#334155;line-height:1.6">${escapeHtml(item.summaryZh)}</p>
      <span style="font-size:12px;color:#94a3b8">${escapeHtml(item.sourceName)}${dateStr ? ' · ' + dateStr : ''}</span>
    </div>`
}

function renderCategorySection(category: MarketIntelCategory, items: SummarizedItem[]): string {
  if (items.length === 0) return '' // §7.5：分类当天没有条目就整栏不出现，不空着占位
  return `
    <div style="margin-bottom:24px">
      <h3 style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#d97706">
        ${escapeHtml(CATEGORY_LABELS[category])}
      </h3>
      ${items.map(renderItem).join('')}
    </div>`
}

export function buildDigestEmailSubject(nzDateLabel: string): string {
  return `Magic Insight · ${nzDateLabel}`
}

export function buildDigestEmailHtml(
  nzDateLabel: string,
  note: string | null,
  items: SummarizedItem[],
): string {
  const byCategory = new Map<MarketIntelCategory, SummarizedItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.matchedCategory) ?? []
    list.push(item)
    byCategory.set(item.matchedCategory, list)
  }

  const sections = CATEGORY_ORDER.map((category) =>
    renderCategorySection(category, byCategory.get(category) ?? []),
  ).join('')

  const noteHtml = note
    ? `<p style="margin:0 0 24px;font-size:14px;color:#475569;font-style:italic">${escapeHtml(note)}</p>`
    : ''

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:19px;color:#0f172a">Magic Insight</h2>
      <p style="margin:0 0 20px;font-size:13px;color:#94a3b8">${escapeHtml(nzDateLabel)}</p>
      ${noteHtml}
      ${sections}
    </div>`
}
