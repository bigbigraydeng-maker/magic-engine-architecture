/**
 * The stranded-action todo must name the right cause — Issue #859, Codex P2.
 *
 * Three causes, three different fixes. The first version asserted "wrong
 * flywheel" for all of them, which is false for a scope mismatch inside the SEO
 * flywheel and sends the reader looking in the wrong place. CLAUDE.md §3 is
 * explicit that `how` has to be concrete enough to act on without asking; a
 * confidently wrong `how` is worse than none.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UnattributableAction } from '@/lib/flywheel/attribution/unattributable-audit'

const stranded: UnattributableAction[] = []

vi.mock('@/lib/flywheel/attribution/unattributable-audit', () => ({
  auditUnattributableActions: vi.fn(async () => stranded),
}))

// Everything else `loadManualItems` reaches is out of scope here; only the
// unattributable lane is exercised, through the exported loader.
import { loadManualItems } from '../manual-items'

function action(over: Partial<UnattributableAction> = {}): UnattributableAction {
  return {
    action_id: 'a1',
    client_id: 'c1',
    flywheel: 'geo',
    expected_metric: 'seo.gsc.clicks',
    action_type: 'geo.deploy_directive',
    executed_at: '2026-06-01T00:00:00.000Z',
    reason: 'cross_flywheel',
    suggested_metric: null,
    ...over,
  }
}

/** Minimal Supabase stub: one active client, everything else empty. */
function stubSupabase() {
  const builder: Record<string, unknown> = {}
  const chain = new Proxy(builder, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res)
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => ({ data: null, error: null })
      }
      return () => chain
    },
  })
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ id: 'c1', name: 'CTS Tours', domain: 'ctstours.co.nz' }],
              error: null,
            }),
          }),
        }
      }
      return chain
    },
  } as never
}

async function itemsFor(rows: UnattributableAction[]) {
  stranded.length = 0
  stranded.push(...rows)
  const all = await loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z'))
  return all.filter(i => i.kind === 'action_unattributable')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('unattributable todo wording', () => {
  it('says "wrong flywheel" only for a cross-flywheel action', async () => {
    const [item] = await itemsFor([action({ reason: 'cross_flywheel' })])

    expect(item.what).toContain('战线')
    expect(item.how).toContain('改指标')
    expect(item.client_name).toBe('CTS Tours')
    expect(item.href).toContain('/dashboard/clients/c1/execution')
  })

  it('does NOT blame the flywheel for a scope mismatch, and names the swap', async () => {
    const [item] = await itemsFor([
      action({
        reason: 'scope_mismatch',
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.gsc.page_clicks',
        suggested_metric: 'seo.gsc.clicks',
      }),
    ])

    // The old text asserted the flywheel was misconfigured. It is not.
    expect(item.how).not.toContain('错的战线')
    expect(item.how).toContain('战线没配错')
    // And it says exactly what to change it to.
    expect(item.how).toContain('seo.gsc.page_clicks → seo.gsc.clicks')
  })

  it('tells the reader a not-yet-live page upgrade will fix itself', async () => {
    const [item] = await itemsFor([
      action({
        reason: 'scope_skip',
        flywheel: 'seo',
        action_type: 'cms_update_existing',
        expected_metric: 'seo.gsc.page_clicks',
      }),
    ])

    expect(item.how).toContain('自己好')
    // Must not ask for a metric change — that is not the fix here.
    expect(item.how).not.toContain('改指标')
    expect(item.how).not.toContain('改口径')
  })

  it('splits one client into one item per cause', async () => {
    const items = await itemsFor([
      action({ action_id: 'a1', reason: 'cross_flywheel' }),
      action({ action_id: 'a2', reason: 'scope_mismatch', flywheel: 'seo', suggested_metric: 'seo.gsc.clicks' }),
      action({ action_id: 'a3', reason: 'scope_skip', flywheel: 'seo' }),
    ])

    expect(items).toHaveLength(3)
    expect(new Set(items.map(i => i.how)).size).toBe(3) // three distinct instructions
  })

  it('produces nothing when no action is stranded', async () => {
    expect(await itemsFor([])).toEqual([])
  })
})

// ── The check failing is itself a finding ──────────────────────────────────

describe('when the audit itself fails', () => {
  it('emits an infra todo instead of swallowing it', async () => {
    // The audit throws deliberately on a query failure so that "nothing is
    // stranded" and "we could not check" never look the same. Catching that
    // into a console.warn undoes the distinction one layer up: the todo list
    // returns cleanly with no attribution item, and the whole detection
    // pipeline disappears into a developer log.
    const { auditUnattributableActions } = await import(
      '@/lib/flywheel/attribution/unattributable-audit'
    )
    vi.mocked(auditUnattributableActions).mockRejectedValueOnce(
      new Error('column "payload" does not exist'),
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = await loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z'))
    warn.mockRestore()

    const item = all.find(i => i.kind === 'attribution_audit_failed')
    expect(item).toBeDefined()
    // The message has to carry the actual cause, not just "something failed".
    expect(item!.what).toContain('column "payload" does not exist')
    // And it must not read as "all clear".
    expect(item!.what).toContain('不是「今天没问题」')
    expect(item!.how).toContain('查不了')
    expect(item!.href).toBeTruthy()
  })

  it('does not emit the failure item on a clean run', async () => {
    const all = await itemsFor([])
    expect(all.find(i => i.kind === 'attribution_audit_failed')).toBeUndefined()
  })

  it('a failed audit does not take the rest of the todo list down with it', async () => {
    const { auditUnattributableActions } = await import(
      '@/lib/flywheel/attribution/unattributable-audit'
    )
    vi.mocked(auditUnattributableActions).mockRejectedValueOnce(new Error('boom'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z')),
    ).resolves.toBeInstanceOf(Array)
    warn.mockRestore()
  })
})
