/**
 * POST /api/admin/product-map/refresh — 手动全量刷新(诊断入口,admin-only)。
 *
 * migration apply 之后的 canary 就跑它:RPC 不存在会在这里直接露头,
 * 而不是等到 cron 半夜静默失败。
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import {
  GithubRestProvider,
  NotProvisionedError,
  SupabaseSyncStore,
  runFullSync,
} from '@/lib/product-map-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_request: NextRequest): Promise<NextResponse> {
  const denied = await guardAdmin()
  if (denied) return denied

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ status: 'failed', reason: 'GITHUB_TOKEN 未配置' }, { status: 500 })
  }

  try {
    const result = await runFullSync(
      {
        provider: new GithubRestProvider({ token }),
        store: new SupabaseSyncStore(supabaseAdmin),
        newRunId: () => randomUUID(),
        now: () => new Date().toISOString(),
      },
      'manual',
    )
    return NextResponse.json({ status: result.status, run_id: result.runId, stats: result.stats })
  } catch (err) {
    if (err instanceof NotProvisionedError) {
      return NextResponse.json({
        status: 'not_provisioned',
        detail: err.message,
        fix: 'apply supabase/migrations/20260815000001_product_map_sync_v1.sql 后重试',
      })
    }
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ status: 'failed', reason: message }, { status: 500 })
  }
}
