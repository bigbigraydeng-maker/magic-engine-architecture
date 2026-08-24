import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { reconcile } from '@/lib/todo-reconciliation/reconcile'
import { buildAudited280, AUDITED_280_ASOF } from '@/lib/todo-reconciliation/fixtures/audited-280'

/**
 * GET /api/workbench/today/reconciliation-preview (#1169 WP1)
 *
 * Preview-only: reconciles the FROZEN #1169 audited-280 fixture, not live
 * production data — WP1 proves the reconciliation logic deterministically
 * before it is ever wired to `loadTodoCounts()`'s real Supabase reads
 * (that wiring is a later, separately-authorised WP). Same admin gate as
 * the existing `/api/workbench/today` this extends.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardAdmin()
  if (guard) return guard

  const items = buildAudited280()
  const result = reconcile(items, AUDITED_280_ASOF)

  return NextResponse.json({
    fixture: 'audited-280 (#1169)',
    before: result.totalRaw,
    after: result.unresolvedClusters.length,
    ...result,
  })
}
