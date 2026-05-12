/**
 * SEO Gap Analysis — DOCX Report Generator
 *
 * Generates a professional Word document from a SeoGapAnalysis object.
 * Uses the `docx` npm package (run: npm install docx).
 *
 * File < 400 lines. Companion to analyzer.ts.
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
import type { SeoGapAnalysis, RankedKeyword, KeywordCluster } from './analyzer'

const DXA_PAGE_WIDTH = 9360  // A4 content width in DXA (twips)
const BRAND_COLOR = '2E4057'  // dark navy header

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns a Buffer containing the .docx file bytes */
export async function generateSeoGapDocx(
  analysis: SeoGapAnalysis,
  clientName: string,
  reportDate: string = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          ...coverSection(clientName, reportDate, analysis),
          ...executiveSummarySection(analysis),
          ...tierASection(analysis.tier_a),
          ...tierBSection(analysis.tier_b),
          ...clusterSection(analysis.clusters),
          ...roadmapSection(analysis.ai_insights),
          ...suburbPageSection(analysis.ai_insights),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}

// ─── Cover page ───────────────────────────────────────────────────────────────

function coverSection(clientName: string, date: string, analysis: SeoGapAnalysis): Paragraph[] {
  return [
    h1(`SEO Keyword Gap Analysis`),
    h1(clientName),
    body(date),
    body(' '),
    statLine('Competitors Analysed', String(analysis.competitors.length)),
    statLine('Total Keywords Scanned', String(analysis.total_keywords_raw)),
    statLine('B2C Opportunities Identified', String(analysis.total_keywords_b2c)),
    statLine('Tier A (Immediate Action)', String(analysis.tier_a.length)),
    statLine('Tier B (Content Strategy)', String(analysis.tier_b.length)),
    statLine('Tier C (Suburb Pages)', String(analysis.tier_c.length)),
    pageBreak(),
  ]
}

// ─── Executive Summary ────────────────────────────────────────────────────────

function executiveSummarySection(analysis: SeoGapAnalysis): Paragraph[] {
  const { ai_insights: ins } = analysis
  const items: Paragraph[] = [
    h2('Executive Summary'),
    body(ins.executive_summary),
    body(' '),
    body(ins.market_opportunity),
    body(' '),
    h3('Competitor Intelligence'),
    body(ins.competitor_intelligence),
    pageBreak(),
  ]
  return items
}

// ─── Tier A table ─────────────────────────────────────────────────────────────

function tierASection(keywords: RankedKeyword[]): (Paragraph | Table)[] {
  return [
    h2('Tier A — Immediate Action Keywords'),
    body('High volume, low competition. Create or optimise product/category pages within 30 days.'),
    body(' '),
    keywordTable(keywords.slice(0, 25)),
    pageBreak(),
  ]
}

// ─── Tier B table ─────────────────────────────────────────────────────────────

function tierBSection(keywords: RankedKeyword[]): (Paragraph | Table)[] {
  return [
    h2('Tier B — Blog & Content Strategy Keywords'),
    body('Medium competition. Target via blog posts, buying guides, and comparison articles.'),
    body(' '),
    keywordTable(keywords.slice(0, 30)),
    pageBreak(),
  ]
}

// ─── Cluster analysis ─────────────────────────────────────────────────────────

function clusterSection(clusters: KeywordCluster[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    h2('Keyword Clusters — Strategic Groupings'),
    body('Keywords grouped by product theme. Each cluster represents a content / page-type opportunity.'),
    body(' '),
  ]

  for (const cluster of clusters.slice(0, 6)) {
    out.push(h3(cluster.name))
    out.push(body(cluster.theme))
    out.push(
      statLine('Cluster Volume', cluster.total_volume.toLocaleString()),
    )
    out.push(
      statLine('Avg KD', String(cluster.avg_kd)),
    )
    out.push(keywordTable(cluster.keywords.slice(0, 10)))
    out.push(body(' '))
  }

  out.push(pageBreak())
  return out
}

// ─── Roadmap section ─────────────────────────────────────────────────────────

function roadmapSection(ins: SeoGapAnalysis['ai_insights']): Paragraph[] {
  const { action_roadmap: rm } = ins
  return [
    h2('30 / 60 / 90 Day Action Roadmap'),
    h3('Days 1–30'),
    ...rm.days_30.map(a => bullet(a)),
    body(' '),
    h3('Days 31–60'),
    ...rm.days_60.map(a => bullet(a)),
    body(' '),
    h3('Days 61–90'),
    ...rm.days_90.map(a => bullet(a)),
    pageBreak(),
  ]
}

// ─── Suburb pages section ─────────────────────────────────────────────────────

function suburbPageSection(ins: SeoGapAnalysis['ai_insights']): Paragraph[] {
  return [
    h2('Suburb Page & Brand Page Opportunities'),
    h3('Recommended Suburb Pages'),
    ...ins.suburb_page_opportunities.map(s => bullet(s)),
    body(' '),
    h3('Brand / Product Pages to Create'),
    ...ins.b2c_brand_pages.map(b => bullet(b)),
  ]
}

// ─── Table builder ────────────────────────────────────────────────────────────

function keywordTable(keywords: RankedKeyword[]): Table {
  const headers = ['Keyword', 'Volume', 'KD', 'Intent', 'Competitors']
  const widths  = [3600, 1000, 800, 1200, 2760]

  const headerRow = new TableRow({
    children: headers.map((h, i) =>
      new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: BRAND_COLOR },
        children: [
          new Paragraph({
            children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 18 })],
            alignment: AlignmentType.CENTER,
          }),
        ],
      })
    ),
  })

  const dataRows = keywords.map((kw, rowIdx) =>
    new TableRow({
      children: [
        cell(kw.keyword, widths[0], rowIdx),
        cell(kw.volume > 0 ? kw.volume.toLocaleString() : '<10', widths[1], rowIdx),
        cell(kw.kd === -1 ? '~0' : String(kw.kd), widths[2], rowIdx),
        cell(kw.intent, widths[3], rowIdx),
        cell(kw.competitors.slice(0, 2).join(', ') || '—', widths[4], rowIdx),
      ],
    })
  )

  return new Table({
    width: { size: DXA_PAGE_WIDTH, type: WidthType.DXA },
    borders: tableBorders(),
    rows: [headerRow, ...dataRows],
  })
}

function cell(text: string, width: number, rowIdx: number): TableCell {
  const fillColor = rowIdx % 2 === 0 ? 'F8F9FA' : 'FFFFFF'
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: fillColor },
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 18 })],
        alignment: AlignmentType.LEFT,
      }),
    ],
  })
}

function tableBorders() {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' }
  return { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border }
}

// ─── Paragraph helpers ────────────────────────────────────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 100 },
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  })
}

function statLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22 }),
      new TextRun({ text: value, size: 22 }),
    ],
    spacing: { after: 80 },
  })
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] })
}
