/**
 * POST /api/clients/[id]/flywheel/gsc-attribution
 *
 * Triggers GSC attribution computation for all SEO flywheel actions for a client.
 * For each SEO action, finds the GSC snapshot before and after the action date,
 * computes delta (clicks, impressions, avg_position), and upserts into flywheel_outcomes.
 *
 * Body: { window_days?: number }  (default 28)
 *
 * Returns: { success, client_id, actions_found, outcomes_written, skipped, errors }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'
import { resolveEffectiveWindow } from '@/lib/flywheel/attribution/dual-window-gate'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 28
const MAX_WINDOW_DAYS     = 90

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  let requestedWindow = DEFAULT_WINDOW_DAYS
  try {
    const body = await req.json() as { window_days?: unknown }
    if (typeof body.window_days === 'number' && body.window_days > 0) {
      requestedWindow = Math.min(Math.round(body.window_days), MAX_WINDOW_DAYS)
    }
  } catch {
    // default stays 28
  }

  // A custom window is a second window, and this endpoint bypasses the cron.
  //
  // On main a manual run REPLACED the previous rows — the delete had no window
  // filter — so an action never held more than one window's worth. The natural
  // key now includes window_days, which is right (a 7-day and a 28-day answer
  // are different facts) but means a manual run ADDS rather than replaces. With
  // the memory consumers still counting rows, one manual 7-day run beside the
  // cron's 28-day one doubles the evidence behind that action, exactly what
  // ATTRIBUTION_DUAL_WINDOW_ENABLED exists to prevent — so the same gate has to
  // cover this path, or the gate is not a gate.
  //
  // Refused out loud rather than silently ignored: an operator who asked for 7
  // days and got 28 without being told would read the result as a 7-day answer.
  const effective = resolveEffectiveWindow(requestedWindow, DEFAULT_WINDOW_DAYS)
  const windowDays = effective.windowDays
  const windowOverrideRefused = effective.overrideRefused

  const result = await runGscAttributionForClient(clientId, windowDays)

  const hasErrors = result.errors.length > 0

  // Two kinds of error, and they mean opposite things for this response:
  //
  //   · reconciliation debt — the outcome rows landed, then retiring superseded
  //     rows failed. Nothing was lost; the next run tidies up. `outcomes_written`
  //     must keep counting those rows, and a 502 here would claim the opposite.
  //   · a real write failure — an upsert or snapshot query threw, so an action
  //     produced nothing.
  //
  // …and a third kind, which used to be unreachable and no longer is:
  //
  //   · a pre-write reconciliation failure — claiming rows an older deployment
  //     left unsigned, or retiring a duplicated window. Reconciliation now runs
  //     BEFORE the snapshot maturity check (it has to: an immature action is the
  //     likeliest one to be carrying such a row), so a run can end with zero
  //     writes and a reconciliation error. Calling that "success" would report a
  //     run that made nothing right — the unsigned rows still block the contract
  //     migration, and a duplicated window is still double-counted downstream.
  //     An earlier version of this file asserted that shape was unreachable;
  //     that stopped being true when the ordering changed.
  //     (Codex P2, round 18 on PR #862.)
  //
  // `errors[]` holds all three, so the two counters are what tell them apart.
  // See Issue #859.
  const onlyCleanupFailed =
    hasErrors &&
    result.reconcile_errors === 0 &&
    result.errors.length === result.cleanup_errors
  const hardErrors =
    result.errors.length - result.cleanup_errors - result.reconcile_errors

  return NextResponse.json(
    {
      success:          !hasErrors || onlyCleanupFailed,
      client_id:        result.client_id,
      actions_found:    result.actions_found,
      outcomes_written: result.outcomes_written,
      skipped:          result.skipped,
      cleanup_errors:   result.cleanup_errors,
      reconcile_errors: result.reconcile_errors,
      errors:           result.errors,
      window_days:      windowDays,
      ...(windowOverrideRefused
        ? {
            window_override_refused: {
              requested: effective.requested ?? requestedWindow,
              used: windowDays,
              reason:
                'Custom attribution windows are disabled while ' +
                'ATTRIBUTION_DUAL_WINDOW_ENABLED is off — a second window would ' +
                'double the evidence behind each action for consumers that still ' +
                'count outcome rows. See Issue #859.',
            },
          }
        : {}),
    },
    { status: hardErrors > 0 && result.outcomes_written === 0 ? 502 : 200 },
  )
}
