/**
 * 张骞 Discovery — DOCX Report Generator
 *
 * Converts a DiscoveryReport into a professional Word document.
 * Sections: cover → diagnosis → keywords → competitors → AI visibility
 *           → social → GBP → review platforms → meta ads → action plan
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
  WidthType,
  PageBreak,
} from 'docx'
import type { DiscoveryReport } from './types'

const BRAND_COLOR   = '1A5FB4'
const ACCENT_COLOR  = '2E4057'
const HEADER_FILL   = 'EEF2FF'
const PAGE_WIDTH    = 9360   // A4 content width in DXA
const CELL_BORDER   = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } as const
const CELL_BORDERS  = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateZhangqianDocx(
  report: DiscoveryReport,
  clientName: string,
  reportDate: string = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        ...cover(clientName, report, reportDate),
        ...diagnosisSection(report),
        ...keywordsSection(report),
        ...competitorsSection(report),
        ...aiVisibilitySection(report),
        ...socialSection(report),
        ...gbpSection(report),
        ...reviewPlatformsSection(report),
        ...metaAdsSection(report),
        ...actionPlanSection(report),
        ...(report.notes ? notesSection(report.notes) : []),
      ],
    }],
  })
  const buf = await Packer.toBuffer(doc)
  return Buffer.from(buf)
}

// ─── Cover ────────────────────────────────────────────────────────────────────

function cover(clientName: string, report: DiscoveryReport, date: string): Paragraph[] {
  const b = report.business
  const overallScore = report.diagnosis?.scores.overall ?? null

  return [
    h1('品牌发现报告'),
    h1(clientName),
    bodyBold(report.domain),
    body(date),
    body(' '),
    ...(overallScore !== null ? [statLine('综合评分', `${overallScore} / 100`)] : []),
    ...(b.industry.length ? [statLine('行业', b.industry.join(' · '))] : []),
    statLine('市场', b.location.country),
    ...(b.location.city || b.location.region ? [statLine('所在地', [b.location.city, b.location.region].filter(Boolean).join(', '))] : []),
    statLine('竞品数量', String(report.competitors.length)),
    statLine('种子关键词', String(report.seed_keywords.length)),
    pageBreak(),
  ]
}

// ─── Diagnosis Section ────────────────────────────────────────────────────────

function diagnosisSection(report: DiscoveryReport): Paragraph[] {
  const d = report.diagnosis
  if (!d) return []

  const rows: string[][] = [
    ['SEO',       String(d.scores.seo)],
    ['社媒',      String(d.scores.social)],
    ['口碑',      String(d.scores.reputation)],
    ['AI 可见度', String(d.scores.ai_visibility)],
    ['综合',      String(d.scores.overall)],
  ]

  return [
    h2('诊断摘要'),
    ...(d.crisis_type ? [bodyBold(`危机类型：${d.crisis_type}`)] : []),
    body(d.executive_summary),
    body(' '),
    bodyBold('核心发现：' + d.key_finding),
    body(' '),
    bodyBold('钱去了哪里：'),
    body(d.money_flow),
    body(' '),
    h3('各维度评分'),
    table(['维度', '评分'], rows),
    pageBreak(),
  ]
}

// ─── Keywords Section ─────────────────────────────────────────────────────────

function keywordsSection(report: DiscoveryReport): Paragraph[] {
  const kws = report.seed_keywords
  if (!kws.length) return []

  const rows = kws.map(k => [
    k.keyword,
    k.type,
    k.semrush_volume != null ? String(k.semrush_volume) : (k.estimated_volume != null ? `~${k.estimated_volume}` : '-'),
    k.semrush_kd != null ? String(k.semrush_kd) : '-',
    k.semrush_rank != null ? String(k.semrush_rank) : '-',
  ])

  const snap = report.semrush_snapshot
  const snapItems: Paragraph[] = snap ? [
    h3('SEMrush 域名快照'),
    ...(snap.monthly_traffic != null ? [statLine('月均流量', snap.monthly_traffic.toLocaleString())] : []),
    ...(snap.keyword_count   != null ? [statLine('排名关键词数', snap.keyword_count.toLocaleString())] : []),
    ...(snap.trust_score     != null ? [statLine('信任评分', String(snap.trust_score))] : []),
    body(' '),
  ] : []

  return [
    h2('核心关键词'),
    ...snapItems,
    h3('种子关键词列表'),
    table(['关键词', '类型', '搜索量', '难度(KD)', '当前排名'], rows),
    pageBreak(),
  ]
}

// ─── Competitors Section ──────────────────────────────────────────────────────

function competitorsSection(report: DiscoveryReport): Paragraph[] {
  const cs = report.competitors
  if (!cs.length) return []

  const rows = cs.map(c => [
    c.name,
    c.domain,
    c.relevance,
    c.monthly_traffic != null ? c.monthly_traffic.toLocaleString() : '-',
    c.trust_score     != null ? String(c.trust_score) : '-',
    c.rationale,
  ])

  return [
    h2('竞品分析'),
    table(['品牌', '域名', '关系', '月均流量', '信任分', '说明'], rows),
    pageBreak(),
  ]
}

// ─── AI Visibility Section ────────────────────────────────────────────────────

function aiVisibilitySection(report: DiscoveryReport): Paragraph[] {
  const qs   = report.ai_tracker_questions ?? []
  const res  = report.ai_visibility_results ?? []
  if (!qs.length && !res.length) return []

  const items: Paragraph[] = [h2('AI 可见度')]

  if (res.length) {
    const rows = res.map(r => [
      r.question,
      r.client_mentioned ? '✓ 出现' : '✗ 未出现',
      r.top_brands.slice(0, 3).join(', ') || '-',
    ])
    items.push(h3('AI 搜索可见度测试结果'))
    items.push(table(['问题', '客户出现', '出现的品牌'], rows))
    items.push(body(' '))
  }

  if (qs.length) {
    const rows = qs.map(q => [q.question, q.category, q.market, q.rationale])
    items.push(h3('AI 追踪问题（待监控）'))
    items.push(table(['问题', '类型', '市场', '用意'], rows))
  }

  items.push(pageBreak())
  return items
}

// ─── Social Section ───────────────────────────────────────────────────────────

function socialSection(report: DiscoveryReport): Paragraph[] {
  const ss = report.social_profiles
  if (!ss.length) return []

  const rows = ss.map(s => [
    s.platform,
    s.handle ?? '-',
    s.followers_count != null ? s.followers_count.toLocaleString() : '-',
    s.posts_last_30d  != null ? String(s.posts_last_30d) : '-',
    s.engagement_rate != null ? `${(s.engagement_rate * 100).toFixed(1)}%` : '-',
    s.url,
  ])

  return [
    h2('社交媒体档案'),
    table(['平台', '账号', '粉丝', '近30日发帖', '互动率', 'URL'], rows),
    pageBreak(),
  ]
}

// ─── GBP Section ──────────────────────────────────────────────────────────────

function gbpSection(report: DiscoveryReport): Paragraph[] {
  const g = report.gbp
  if (!g) return []

  return [
    h2('Google 商家档案 (GBP)'),
    statLine('商家名称', g.business_name),
    statLine('地址', g.address),
    ...(g.rating       != null ? [statLine('评分', `${g.rating} / 5`)] : []),
    ...(g.review_count != null ? [statLine('评论数', g.review_count.toLocaleString())] : []),
    ...(g.google_maps_url ? [statLine('Google Maps', g.google_maps_url)] : []),
    pageBreak(),
  ]
}

// ─── Review Platforms Section ─────────────────────────────────────────────────

function reviewPlatformsSection(report: DiscoveryReport): Paragraph[] {
  const ps = report.review_platforms
  if (!ps.length) return []

  const rows = ps.map(p => [
    p.platform,
    p.rating       != null ? String(p.rating) : '-',
    p.review_count != null ? p.review_count.toLocaleString() : '-',
    p.response_rate != null ? `${(p.response_rate * 100).toFixed(0)}%` : '-',
    p.url,
  ])

  return [
    h2('评论平台'),
    table(['平台', '评分', '评论数', '回复率', 'URL'], rows),
    pageBreak(),
  ]
}

// ─── Meta Ads Section ─────────────────────────────────────────────────────────

function metaAdsSection(report: DiscoveryReport): Paragraph[] {
  const m = report.meta_ads
  if (!m) return []

  return [
    h2('Meta 广告活动'),
    statLine('在投广告数', String(m.active_ads_count)),
    statLine('广告类型', m.ad_types.join(', ') || '-'),
    statLine('预估投放规模', m.estimated_spend),
    ...(m.top_ad_copy.length ? [
      body(' '),
      h3('广告文案样本'),
      ...m.top_ad_copy.map(c => bullet(c)),
    ] : []),
    pageBreak(),
  ]
}

// ─── Action Plan Section ──────────────────────────────────────────────────────

function actionPlanSection(report: DiscoveryReport): Paragraph[] {
  const actions = report.diagnosis?.actions
  if (!actions) return []

  return [
    h2('行动计划'),
    ...(actions.quick_fix.length ? [
      h3('立即可做（客户自助）'),
      ...actions.quick_fix.map(a => bullet(a)),
      body(' '),
    ] : []),
    ...(actions.important.length ? [
      h3('重要建设（1–3 个月）'),
      ...actions.important.map(a => bullet(a)),
      body(' '),
    ] : []),
    ...(actions.talk_to_us.length ? [
      h3('需要专业支持'),
      ...actions.talk_to_us.map(a => bullet(a)),
    ] : []),
  ]
}

// ─── Notes Section ────────────────────────────────────────────────────────────

function notesSection(notes: string): Paragraph[] {
  return [
    pageBreak(),
    h2('备注'),
    body(notes),
  ]
}

// ─── Primitive builders ───────────────────────────────────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 40, color: BRAND_COLOR })],
    spacing: { before: 360, after: 240 },
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 32, color: BRAND_COLOR })],
    spacing: { before: 300, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_COLOR, space: 4 } },
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 26, color: ACCENT_COLOR })],
    spacing: { before: 240, after: 120 },
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 24 })],
    spacing: { after: 120 },
  })
}

function bodyBold(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 24 })],
    spacing: { after: 120 },
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `• ${text}`, font: 'Arial', size: 24 })],
    indent: { left: 360 },
    spacing: { after: 80 },
  })
}

function statLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: 'Arial', size: 24 }),
      new TextRun({ text: value, font: 'Arial', size: 24 }),
    ],
    spacing: { after: 80 },
  })
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] })
}

function table(headers: string[], rows: string[][]): Table {
  const colCount = headers.length
  const colWidth = Math.floor(PAGE_WIDTH / colCount)
  const colWidths = Array(colCount).fill(colWidth)

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        borders: CELL_BORDERS,
        width: { size: colWidths[i], type: WidthType.DXA },
        shading: { fill: HEADER_FILL, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: h, bold: true, font: 'Arial', size: 22 })],
        })],
      }),
    ),
  })

  const bodyRows = rows.map(row =>
    new TableRow({
      children: Array.from({ length: colCount }, (_, i) =>
        new TableCell({
          borders: CELL_BORDERS,
          width: { size: colWidths[i], type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: row[i] ?? '', font: 'Arial', size: 22 })],
          })],
        }),
      ),
    }),
  )

  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  })
}
