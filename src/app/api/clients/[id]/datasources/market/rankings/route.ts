import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Get today's market comparison data
    const today = new Date().toISOString().split('T')[0]

    const { data: comparisons, error } = await supabase
      .from('market_comparison')
      .select('*')
      .eq('client_id', clientId)
      .eq('date', today)
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    if (!comparisons || comparisons.length === 0) {
      return NextResponse.json({
        comparisons: [],
        topOpportunities: [],
        underperformers: [],
        aligned: [],
        avgOpportunityScore: 0,
        totalKeywords: 0,
        snapshotDate: today,
      })
    }

    // Calculate metrics from comparisons
    const topOpportunities = comparisons
      .filter((c: any) => c.opportunity_score > 60)
      .sort((a: any, b: any) => b.opportunity_score - a.opportunity_score)
      .slice(0, 10)

    const underperformers = comparisons
      .filter(
        (c: any) =>
          c.client_ranking_strength === 'behind' && c.client_position
      )
      .sort(
        (a: any, b: any) => (b.position_diff || 0) - (a.position_diff || 0)
      )
      .slice(0, 10)

    const aligned = comparisons.filter(
      (c: any) => c.client_ranking_strength === 'aligned'
    )

    const avgOpportunityScore =
      comparisons.reduce((sum: number, c: any) => sum + c.opportunity_score, 0) /
      comparisons.length

    return NextResponse.json({
      comparisons,
      topOpportunities,
      underperformers,
      aligned,
      avgOpportunityScore: Math.round(avgOpportunityScore),
      totalKeywords: comparisons.length,
      snapshotDate: today,
    })
  } catch (error) {
    console.error('Failed to fetch market comparisons:', error)
    return NextResponse.json(
      { error: 'Failed to fetch market comparisons' },
      { status: 500 }
    )
  }
}
