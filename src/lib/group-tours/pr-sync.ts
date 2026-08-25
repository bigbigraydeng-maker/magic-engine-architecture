/**
 * 团 PR 合并状态回写 —— 照抄 `src/lib/blog/pr-sync.ts` 的既有模式，改查
 * `group_tours` 表。跟 blog 的差异：PR 被关闭未合并时退回 'draft' 而不是
 * blog 的 'rejected'，因为团被拒绝后通常是改了再发，不是终态。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'

interface PrOpenTour {
  id: string
  client_id: string
  pr_number: number | null
}

export interface TourPrSyncResult {
  checked: number
  published: number
  reverted: number
  errors: number
}

export async function syncTourPrOpenPosts(supabase: SupabaseClient = supabaseAdmin): Promise<TourPrSyncResult> {
  const result: TourPrSyncResult = { checked: 0, published: 0, reverted: 0, errors: 0 }

  const { data, error } = await supabase.from('group_tours').select('id, client_id, pr_number').eq('status', 'pr_open')
  if (error) throw new Error(`group-tours pr-sync read failed: ${error.message}`)

  const tours = (data ?? []) as PrOpenTour[]
  if (tours.length === 0) return result

  const connByClient = new Map<string, { repoOwner: string; repoName: string; plainToken: string } | null>()

  for (const tour of tours) {
    if (!tour.pr_number) continue
    result.checked += 1

    try {
      if (!connByClient.has(tour.client_id)) {
        const conn = await getConnection(tour.client_id).catch(() => null)
        connByClient.set(
          tour.client_id,
          conn && 'repoOwner' in conn
            ? { repoOwner: conn.repoOwner, repoName: conn.repoName, plainToken: conn.plainToken }
            : null,
        )
      }
      const conn = connByClient.get(tour.client_id)
      if (!conn) continue

      const github = new GithubClient(conn.plainToken)
      const pr = await github.getPullRequestState(conn.repoOwner, conn.repoName, tour.pr_number)
      if (pr.state === 'open') continue

      const nowIso = new Date().toISOString()
      const update = pr.merged
        ? { status: 'published', published_at: nowIso }
        : { status: 'draft' } // 关闭未合并 —— 团可能改了再发，不是终态，退回草稿

      const { error: updateErr } = await supabase.from('group_tours').update(update).eq('id', tour.id).eq('status', 'pr_open')
      if (updateErr) throw new Error(updateErr.message)
      if (pr.merged) result.published += 1
      else result.reverted += 1
    } catch (err) {
      result.errors += 1
      console.error(`[group-tours/pr-sync] failed for tour ${tour.id}:`, err instanceof Error ? err.message : String(err))
    }
  }

  return result
}
