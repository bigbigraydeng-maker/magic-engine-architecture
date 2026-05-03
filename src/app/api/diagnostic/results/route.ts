import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  const { data: runs, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select(
      'id, ai_engine, ai_model, error_message, latency_ms, tokens_used, cost_usd, brands_mentioned, client_brand_rank'
    )
    .eq('client_id', clientId)
    .order('ran_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Summary
  const openaiRuns = runs?.filter((r) => r.ai_engine === 'openai') || []
  const claudeRuns = runs?.filter((r) => r.ai_engine === 'anthropic') || []

  const openaiSuccess = openaiRuns.filter((r) => !r.error_message)
  const openaiErrors = openaiRuns.filter((r) => r.error_message)

  const claudeSuccess = claudeRuns.filter((r) => !r.error_message)
  const claudeErrors = claudeRuns.filter((r) => r.error_message)

  const summary = {
    totalRuns: runs?.length || 0,
    openai: {
      total: openaiRuns.length,
      success: openaiSuccess.length,
      errors: openaiErrors.length,
      avgLatency: openaiSuccess.length
        ? Math.round(openaiSuccess.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / openaiSuccess.length)
        : 0,
      totalTokens: openaiSuccess.reduce((sum, r) => sum + (r.tokens_used || 0), 0),
      totalCost: parseFloat(
        openaiSuccess.reduce((sum, r) => sum + (r.cost_usd || 0), 0).toFixed(4)
      ),
    },
    claude: {
      total: claudeRuns.length,
      success: claudeSuccess.length,
      errors: claudeErrors.length,
      avgLatency: claudeSuccess.length
        ? Math.round(claudeSuccess.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / claudeSuccess.length)
        : 0,
      totalTokens: claudeSuccess.reduce((sum, r) => sum + (r.tokens_used || 0), 0),
      totalCost: parseFloat(
        claudeSuccess.reduce((sum, r) => sum + (r.cost_usd || 0), 0).toFixed(4)
      ),
    },
  }

  // Sample brand mentions
  const sampleBrands = {
    openai: null as any,
    claude: null as any,
  }

  if (openaiSuccess.length > 0) {
    sampleBrands.openai = {
      brandsCount: openaiSuccess[0].brands_mentioned?.length || 0,
      clientRank: openaiSuccess[0].client_brand_rank,
      firstThree: (openaiSuccess[0].brands_mentioned as any[])?.slice(0, 3),
    }
  }

  if (claudeSuccess.length > 0) {
    sampleBrands.claude = {
      brandsCount: claudeSuccess[0].brands_mentioned?.length || 0,
      clientRank: claudeSuccess[0].client_brand_rank,
      firstThree: (claudeSuccess[0].brands_mentioned as any[])?.slice(0, 3),
    }
  }

  // Sample errors
  const sampleErrors = {
    openai: openaiErrors.length > 0 ? openaiErrors[0].error_message : null,
    claude: claudeErrors.length > 0 ? claudeErrors[0].error_message : null,
  }

  return NextResponse.json({
    summary,
    sampleBrands,
    sampleErrors,
    totalRecords: runs?.length || 0,
  })
}
