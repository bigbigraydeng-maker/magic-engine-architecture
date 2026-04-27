// Airtable 字段映射 — Supabase → Airtable 字段名对应关系
// 注意：Airtable 字段名区分大小写，以实际 Airtable 表为准

import type { Keyword, ContentPost } from '@/types/magic-engine'

export const KEYWORD_TO_AIRTABLE = (kw: Keyword): Record<string, unknown> => ({
  'Keyword':               kw.keyword,
  'Status':                'New',
  'Opportunity Score':     kw.opportunity_score,
  'Volume':                kw.volume,
  'KD':                    kw.kd,
  'CPC (USD)':             kw.cpc,
  'Intent':                capitalize(kw.intent),
  'Source':                formatSource(kw.source),
  'Competitor Source':     kw.competitor_source || '',
  'Recommended Page Type': capitalize(kw.recommended_page_type),
  'Supabase ID':           kw.id,
  'Client_Supabase_ID':    kw.client_id,   // Make.com 自动生成内容时使用
  'Created At':            kw.created_at?.split('T')[0],
})

export const POST_TO_AIRTABLE = (post: ContentPost): Record<string, unknown> => ({
  'Headline_EN':        post.title,
  'Status':             'Draft',
  'Platform':           post.platforms?.[0]
                          ? capitalize(post.platforms[0])
                          : 'Facebook',
  'Caption_EN':         post.caption || '',
  'Hashtags_IG':        post.hashtags?.join(' ') || '',
  'LoveArt_Prompt_EN':  post.visual_brief || '',
  'Video_Text_Overlay': post.script || '',
  'URL_Organic_UTM':    post.source_video_url || '',
})

function capitalize(s?: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatSource(s: string): string {
  const map: Record<string, string> = {
    semrush_batch:   'SEMrush Batch',
    semrush_related: 'SEMrush Related',
    semrush_gap:     'SEMrush Gap',
  }
  return map[s] ?? s
}

