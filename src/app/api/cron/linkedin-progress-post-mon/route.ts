/**
 * GET /api/cron/linkedin-progress-post-mon
 *
 * Monday half of the weekly ME-product-progress → LinkedIn pipeline. See
 * src/lib/linkedin-progress/run.ts for the full behaviour — this file only
 * exists so 'linkedin-progress-post-mon' is independently visible in
 * cron_run_logs — startCronRun below must be called with a literal string,
 * not a computed one, or registry.test.ts's static check can't find it
 * (see run.ts's header comment for why).
 */

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { runLinkedinProgressPost } from '@/lib/linkedin-progress/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cronRun = await startCronRun('linkedin-progress-post-mon')
  return runLinkedinProgressPost(cronRun)
}
