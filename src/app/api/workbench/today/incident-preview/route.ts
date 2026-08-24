import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { aggregateIncidents } from '@/lib/todo-reconciliation/incidents'
import {
  buildAudited77CronOccurrences,
  AUDITED_77_CORRELATION_EVIDENCE,
} from '@/lib/todo-reconciliation/incident-fixtures/audited-77-incidents'

/**
 * GET /api/workbench/today/incident-preview (#1169 WP3)
 *
 * Preview-only: aggregates the FROZEN #1169 audited-77 cron-failure fixture
 * into root-cause × affected-scope incidents — not live production data.
 * Zero recovery receipts are ever passed here, so every incident's status
 * honestly resolves to RECOVERY_UNKNOWN; this route never fabricates a
 * recovery. Same admin gate as the existing `/api/workbench/today` this
 * extends. No retry/fix/notify action exists on this route.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const occurrences = buildAudited77CronOccurrences()
  const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)

  return NextResponse.json({
    fixture: 'audited-77 cron failures (#1169 WP3) — frozen sample, not live data',
    live: false,
    ...result,
  })
}
