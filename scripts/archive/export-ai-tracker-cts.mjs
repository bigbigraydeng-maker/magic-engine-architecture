// Read-only archival exporter for the ai-tracker (system B) decommission.
//
// Exports CTS Tours NZ's ai_visibility_* rows to JSON so the irreplaceable raw
// AI responses survive the eventual `DROP TABLE` (see
// docs/specs/2026-08-19-ai-tracker-decommission-v1.md §9.3 — archive is a hard
// prerequisite for the DROP). SELECT-only; never writes to the database.
//
// Usage (from the repo root, with SUPABASE env exported):
//   node scripts/archive/export-ai-tracker-cts.mjs
//
// Requires: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const TABLES = ['ai_visibility_queries', 'ai_visibility_runs', 'ai_visibility_snapshots']
const PAGE = 1000

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'clients', 'cts', 'ai-tracker-archive-2026-08-19')

async function fetchAll(table) {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${CTS_CLIENT_ID}&select=*&order=id.asc&limit=${PAGE}&offset=${offset}`
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const manifest = {
    exported_at: new Date().toISOString(),
    client_id: CTS_CLIENT_ID,
    client_name: 'CTS Tours NZ',
    purpose: 'Pre-DROP archive of ai-tracker (system B). See spec 2026-08-19-ai-tracker-decommission-v1.md §9.3.',
    tables: {},
  }
  for (const table of TABLES) {
    const rows = await fetchAll(table)
    const file = `${table}.json`
    const json = JSON.stringify(rows, null, 2)
    writeFileSync(join(OUT_DIR, file), json)
    manifest.tables[table] = { row_count: rows.length, file, bytes: Buffer.byteLength(json) }
    console.log(`${table}: ${rows.length} rows -> ${file} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`)
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('manifest.json written')
  console.log(JSON.stringify(manifest.tables, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
