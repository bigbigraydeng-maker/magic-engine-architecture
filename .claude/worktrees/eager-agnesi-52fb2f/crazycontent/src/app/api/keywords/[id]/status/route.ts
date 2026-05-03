import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// PATCH /api/keywords/[id]/status
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { status } = await req.json()

    const validStatuses = ['approved', 'rejected', 'new', 'reviewed', 'published', 'page_created']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('keywords')
      .update({
        status,
        status_updated_at: new Date().toISOString(),
        status_updated_by: 'dashboard',
      })
      .eq('id', params.id)

    if (error) throw error
    return NextResponse.json({ success: true, status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
