/**
 * P35.14 pilot batch runner — mirrors the exact logic of
 * POST /api/admin/prospecting/discovery-upgrade (claim → runZhangqian →
 * status derivation) run locally against the same production Supabase
 * project, since this session has no authenticated admin browser session to
 * call the deployed HTTP route with. Same status machine, same daily-cap
 * respect (checked before running, not re-implemented here since this is a
 * one-shot 18-prospect run well under the 30/day cap).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { runZhangqian } from '../src/lib/zhangqian/agent'

function loadEnvLocal() {
  const text = readFileSync('.env.local', 'utf8')
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, key, rawVal] = m
    const val = rawVal.replace(/^"(.*)"$/, '$1')
    if (!(key in process.env)) process.env[key] = val
  }
}

interface InsertRow { business_name: string; domain: string }

async function main() {
  loadEnvLocal()
  const ids = JSON.parse(readFileSync('/tmp/minshang_ids.json', 'utf8')) as Record<string, string>
  const rows = JSON.parse(readFileSync('/tmp/minshang-insert-rows.json', 'utf8')) as InsertRow[]
  const domainByName = new Map(rows.map(r => [r.business_name, r.domain]))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const results: Array<Record<string, unknown>> = []

  for (const [name, id] of Object.entries(ids)) {
    const domain = domainByName.get(name)
    if (!domain) {
      results.push({ name, id, status: 'skipped', error: 'no domain mapping' })
      continue
    }

    process.stderr.write(`--- ${name} (${domain}) ---\n`)

    // Optimistic claim, same allowlist as the route (includes 'truncated').
    // Bug found in the first pilot run: 8/18 prospects silently never got
    // claimed because a real Supabase error on this call was swallowed and
    // misreported as "lost the race" — check `error` explicitly.
    const { data: claimed, error: claimError } = await supabase
      .from('outbound_prospects')
      .update({ discovery_report_status: 'running', updated_at: new Date().toISOString() })
      .eq('id', id)
      .or('discovery_report_status.is.null,discovery_report_status.eq.not_run,discovery_report_status.eq.failed,discovery_report_status.eq.truncated')
      .select('id')
    if (claimError) {
      results.push({ name, id, status: 'failed', error: `claim query failed: ${claimError.message}` })
      process.stderr.write(`  failed: claim query error: ${claimError.message}\n`)
      continue
    }
    if (!claimed || claimed.length === 0) {
      results.push({ name, id, status: 'skipped', error: 'claimed by a concurrent run' })
      process.stderr.write(`  skipped: claimed by a concurrent run\n`)
      continue
    }

    try {
      const { report, validation_error } = await runZhangqian(domain)
      const status = validation_error ? 'failed' : report.meta.truncated ? 'truncated' : 'completed'
      await supabase
        .from('outbound_prospects')
        .update({ discovery_report: report, discovery_report_status: status, updated_at: new Date().toISOString() })
        .eq('id', id)
      results.push({ name, id, status, cost_usd: report.meta.cost_usd, tool_calls: report.meta.tool_calls })
      process.stderr.write(`  done: ${status} ($${report.meta.cost_usd.toFixed(3)}, ${report.meta.tool_calls} calls)\n`)
    } catch (err) {
      await supabase
        .from('outbound_prospects')
        .update({ discovery_report_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', id)
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ name, id, status: 'failed', error: msg })
      process.stderr.write(`  failed: ${msg}\n`)
    }

    // incremental save so a crash doesn't lose completed work
    writeFileSync('/tmp/minshang-discovery-pilot-results.json', JSON.stringify(results, null, 2))
  }

  console.log(JSON.stringify(results, null, 2))
}

main()
