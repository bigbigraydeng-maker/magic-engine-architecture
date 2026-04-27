// Airtable REST API Client

const AIRTABLE_BASE = 'https://api.airtable.com/v0'
const API_KEY = process.env.AIRTABLE_API_KEY!

export interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
  createdTime: string
}

export interface AirtableCreateResult {
  id: string
  fields: Record<string, unknown>
}

export async function createRecord(
  baseId: string,
  tableId: string,
  fields: Record<string, unknown>
): Promise<AirtableCreateResult> {
  const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable create error ${res.status}: ${err}`)
  }

  return res.json()
}

// 批量创建（Airtable 每次最多10条）
export async function createRecords(
  baseId: string,
  tableId: string,
  records: Record<string, unknown>[]
): Promise<AirtableCreateResult[]> {
  const results: AirtableCreateResult[] = []

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10)
    const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })) }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Airtable batch create error ${res.status}: ${err}`)
    }
    const data = await res.json()
    results.push(...data.records)
  }

  return results
}

export async function updateRecord(
  baseId: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord> {
  const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable update error ${res.status}: ${err}`)
  }
  return res.json()
}

export async function listRecords(
  baseId: string,
  tableId: string,
  options?: {
    filterByFormula?: string
    maxRecords?: number
    fields?: string[]
  }
): Promise<AirtableRecord[]> {
  const params = new URLSearchParams()
  if (options?.filterByFormula) params.set('filterByFormula', options.filterByFormula)
  if (options?.maxRecords) params.set('maxRecords', String(options.maxRecords))
  options?.fields?.forEach(f => params.append('fields[]', f))

  const res = await fetch(
    `${AIRTABLE_BASE}/${baseId}/${tableId}?${params}`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable list error ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.records || []
}
