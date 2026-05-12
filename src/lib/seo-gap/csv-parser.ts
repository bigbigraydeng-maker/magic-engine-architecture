/**
 * SEMrush Keyword Gap CSV Parser
 *
 * Handles two export formats from SEMrush Keyword Gap tool:
 *   - Comma-delimited  (standard export)
 *   - Semicolon-delimited (EU / regional export)
 *
 * Multiple CSV files are merged and de-duplicated by keyword.
 * The client domain column (oztopbuildingsupplies.com.au) is detected
 * automatically and used to skip keywords where Oztop already ranks.
 */

export interface ParsedKeyword {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: string
  competitors: string[]   // competitor domains that rank for this keyword
}

export interface ParseResult {
  keywords: ParsedKeyword[]
  competitors: string[]
  rows_parsed: number
  files_merged: number
}

const CLIENT_DOMAIN = 'oztopbuildingsupplies.com.au'

// B2B / trade terms to exclude from B2C analysis
const B2B_EXCLUSION_TERMS = [
  'commercial', 'trade', 'builder', 'contractor', 'wholesale',
  'bulk', 'industrial', 'supply chain', 'distributor', 'reseller',
  'developer', 'architect', 'specification', 'spec sheet',
  'b2b', 'trade only', 'trade price', 'trade discount',
]

/**
 * Parse one or more SEMrush keyword gap CSV buffers.
 * Returns de-duplicated keywords sorted by volume desc.
 */
export function parseKeywordGapCsvs(
  fileBuffers: Buffer[],
  clientDomain?: string | null
): ParseResult {
  const resolvedDomain = clientDomain ?? CLIENT_DOMAIN
  const keywordMap = new Map<string, ParsedKeyword>()
  const allCompetitors = new Set<string>()
  let totalRows = 0

  for (const buffer of fileBuffers) {
    const text = buffer.toString('utf-8')
    const result = parseSingleCsv(text, resolvedDomain)
    totalRows += result.rows

    for (const comp of result.competitors) {
      allCompetitors.add(comp)
    }

    // Merge: take the highest volume for duplicate keywords
    for (const kw of result.keywords) {
      const existing = keywordMap.get(kw.keyword)
      if (!existing || kw.volume > existing.volume) {
        keywordMap.set(kw.keyword, kw)
      } else {
        // Merge competitors from different files
        for (const comp of kw.competitors) {
          if (!existing.competitors.includes(comp)) {
            existing.competitors.push(comp)
          }
        }
      }
    }
  }

  const keywords = Array.from(keywordMap.values())
    .sort((a, b) => b.volume - a.volume)

  return {
    keywords,
    competitors: Array.from(allCompetitors),
    rows_parsed: totalRows,
    files_merged: fileBuffers.length,
  }
}

/** Apply B2C filter — removes trade/commercial/builder keywords */
export function filterB2cKeywords(keywords: ParsedKeyword[]): ParsedKeyword[] {
  return keywords.filter(kw => {
    const lower = kw.keyword.toLowerCase()
    return !B2B_EXCLUSION_TERMS.some(term => lower.includes(term))
  })
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface SingleCsvResult {
  keywords: ParsedKeyword[]
  competitors: string[]
  rows: number
}

function parseSingleCsv(text: string, clientDomain: string): SingleCsvResult {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { keywords: [], competitors: [], rows: 0 }

  // Detect delimiter from header row
  const header = lines[0]
  const delimiter = header.includes(';') ? ';' : ','

  const cols = splitRow(header, delimiter)

  // Locate standard columns (case-insensitive)
  const kwIdx     = findCol(cols, ['keyword'])
  const volIdx    = findCol(cols, ['search volume', 'volume', 'nq'])
  const kdIdx     = findCol(cols, ['keyword difficulty', 'kd'])
  const cpcIdx    = findCol(cols, ['cpc'])
  const intentIdx = findCol(cols, ['intent'])

  if (kwIdx === -1 || volIdx === -1) return { keywords: [], competitors: [], rows: 0 }

  // Find domain columns (indices after the standard columns)
  const standardCols = new Set([kwIdx, volIdx, kdIdx, cpcIdx, intentIdx].filter(i => i >= 0))
  const domainCols: { idx: number; domain: string }[] = []

  cols.forEach((col, idx) => {
    if (standardCols.has(idx)) return
    const clean = col.trim().toLowerCase()
    // Domain columns look like "domain.com.au" or "domain.com"
    if (clean.includes('.') && !clean.includes(' ') && clean !== 'competitive density') {
      domainCols.push({ idx, domain: clean })
    }
  })

  const competitors = domainCols
    .map(d => d.domain)
    .filter(d => !d.includes(clientDomain))

  const keywords: ParsedKeyword[] = []

  for (const line of lines.slice(1)) {
    const values = splitRow(line, delimiter)
    if (values.length < 2) continue

    const keyword = values[kwIdx]?.trim()
    if (!keyword || keyword.length === 0) continue

    const volume = parseInt(values[volIdx] ?? '0', 10) || 0
    const kd     = parseInt(values[kdIdx]   ?? '-1', 10)
    const cpc    = parseFloat(values[cpcIdx] ?? '0') || 0
    const intent = normaliseIntent(values[intentIdx]?.trim())

    // Which competitors rank for this keyword?
    const rankingCompetitors = domainCols
      .filter(d => {
        if (d.domain.includes(clientDomain)) return false
        const rank = parseInt(values[d.idx] ?? '0', 10)
        return rank > 0
      })
      .map(d => d.domain)

    keywords.push({ keyword, volume, kd, cpc, intent, competitors: rankingCompetitors })
  }

  return { keywords, competitors, rows: keywords.length }
}

function splitRow(line: string, delimiter: string): string[] {
  // Handles quoted fields with delimiters inside
  const result: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === delimiter && !inQuotes) {
      result.push(field)
      field = ''
    } else {
      field += char
    }
  }
  result.push(field)
  return result
}

function findCol(cols: string[], aliases: string[]): number {
  return cols.findIndex(c =>
    aliases.some(alias => c.trim().toLowerCase().includes(alias))
  )
}

function normaliseIntent(raw?: string): string {
  const map: Record<string, string> = {
    '0': 'informational', 'i': 'informational', 'informational': 'informational',
    '1': 'navigational',  'n': 'navigational',  'navigational': 'navigational',
    '2': 'commercial',    'c': 'commercial',     'commercial': 'commercial',
    '3': 'transactional', 't': 'transactional',  'transactional': 'transactional',
  }
  const key = (raw ?? '').toLowerCase()
  return map[key] ?? 'informational'
}
