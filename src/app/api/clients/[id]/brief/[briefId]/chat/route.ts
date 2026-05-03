import { NextRequest, NextResponse } from 'next/server'
import { refineBrief } from '@/lib/brief/refine'
import type { BriefRefineRequest } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/brief/[briefId]/chat
 *
 * Claude refinement endpoint. User sends a natural language request;
 * Claude returns a patch with only the changed fields.
 *
 * Body: BriefRefineRequest
 * {
 *   message: string
 *   history: BriefChatMessage[]
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; briefId: string } }
) {
  try {
    const body = (await req.json()) as Partial<BriefRefineRequest>

    if (!body.message?.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const result = await refineBrief({
      briefId: params.briefId,
      message: body.message.trim(),
      history: body.history ?? [],
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      reasoning: result.reasoning,
      patch: result.patch,
      brief: result.updatedBrief,
      cost_usd: result.costUsd,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
