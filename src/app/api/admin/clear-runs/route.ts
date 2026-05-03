import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials')
    }

    // Delete all runs from ai_visibility_runs table
    const response = await fetch(
      `${supabaseUrl}/rest/v1/ai_visibility_runs`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        // Delete all records using a dummy where clause
        // Supabase requires a WHERE clause even for DELETE all
      }
    )

    // Try alternative: delete via RPC or direct SQL if available
    if (!response.ok) {
      // Fallback: delete individual records by fetching all IDs first
      const getResponse = await fetch(
        `${supabaseUrl}/rest/v1/ai_visibility_runs?select=id`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      )

      if (getResponse.ok) {
        const records = (await getResponse.json()) as Array<{ id: string }>
        for (const record of records) {
          await fetch(`${supabaseUrl}/rest/v1/ai_visibility_runs?id=eq.${record.id}`, {
            method: 'DELETE',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          })
        }
      }
    }

    return NextResponse.json({
      status: 'success',
      message: 'Cleared all diagnostic runs from ai_visibility_runs',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Clear runs failed:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
