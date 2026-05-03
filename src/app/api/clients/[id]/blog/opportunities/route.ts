import { NextRequest, NextResponse } from 'next/server'
import { getWeakSpotOpportunities } from '@/lib/blog/topic-selector'

/**
 * GET /api/clients/[id]/blog/opportunities
 *
 * Returns AI Tracker weak spots sorted by weakness score.
 * These are the recommended blog topics for GEO-mode generation.
 *
 * Query params:
 *   limit?   - max results (default 20)
 *
 * Reference: ROADMAP.md P7.3.3
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = params.id
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)

    const opportunities = await getWeakSpotOpportunities(clientId, limit)

    return NextResponse.json({ success: true, opportunities })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
