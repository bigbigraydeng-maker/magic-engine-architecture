/**
 * GET /api/clients/[id]/zhangqian/latest
 *
 * Read the most recent Zhangqian DiscoveryReport for a client.
 * 404 if no discovery has been run yet.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.10
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'

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
    const discovery = await getLatestDiscovery(supabaseAdmin, clientId)

    if (!discovery) {
      return NextResponse.json(
        { success: false, error: 'No discovery exists for this client' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, discovery })
  } catch (err: unknown) {
    console.error('[zhangqian/latest] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to read discovery' },
      { status: 500 },
    )
  }
}
