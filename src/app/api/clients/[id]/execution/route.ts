/**
 * GET /api/clients/[id]/execution
 *
 * Returns all execution_items for a client, optionally filtered by prescription_id.
 * Items are ordered by sort_order ascending (phase then action sequence).
 *
 * Query params:
 *   ?prescription_id=<uuid>  — filter to one prescription (optional)
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.17
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ExecutionItem, ExecutionLog } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

/** 返回时每个 item 附带它的 logs（鲁班 P8.10.S4.1） */
export interface ExecutionItemWithLogs extends ExecutionItem {
  logs: ExecutionLog[]
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params
    const { searchParams } = new URL(req.url)
    const prescriptionId = searchParams.get('prescription_id')

    let query = supabaseAdmin
      .from('execution_items')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })

    if (prescriptionId) {
      query = query.eq('prescription_id', prescriptionId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[execution GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to fetch execution items' }, { status: 500 })
    }

    const baseItems = (data ?? []) as ExecutionItem[]

    // 拉取这些 item 的所有 logs，一次查完按 item 分组
    let logsByItem: Record<string, ExecutionLog[]> = {}
    if (baseItems.length > 0) {
      const { data: logRows, error: logErr } = await supabaseAdmin
        .from('execution_logs')
        .select('*')
        .in('execution_item_id', baseItems.map(i => i.id))
        .order('created_at', { ascending: true })

      if (logErr) {
        console.error('[execution GET] logs fetch error (non-fatal):', logErr)
      } else {
        logsByItem = (logRows ?? []).reduce((acc, row) => {
          const log = row as ExecutionLog
          ;(acc[log.execution_item_id] ??= []).push(log)
          return acc
        }, {} as Record<string, ExecutionLog[]>)
      }
    }

    const items: ExecutionItemWithLogs[] = baseItems.map(it => ({
      ...it,
      logs: logsByItem[it.id] ?? [],
    }))

    return NextResponse.json({ success: true, items, count: items.length }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err: unknown) {
    console.error('[execution GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
