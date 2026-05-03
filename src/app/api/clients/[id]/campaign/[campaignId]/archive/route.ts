import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/clients/[id]/campaign/[campaignId]/archive
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
) {
  const { id: clientId, campaignId } = params

  const { data, error } = await supabaseAdmin
    .from('campaign_briefs')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .select('id, title, status')
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, campaign: data })
}
