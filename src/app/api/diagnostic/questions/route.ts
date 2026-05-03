import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  const { data: queries, error } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question, enabled')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    total: queries?.length || 0,
    questions: queries?.map((q) => q.question) || [],
  })
}
