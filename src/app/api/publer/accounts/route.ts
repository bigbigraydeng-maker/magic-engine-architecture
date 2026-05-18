import { NextResponse } from 'next/server'
import { getAccounts } from '@/lib/publer/client'

export async function GET() {
  try {
    const accounts = await getAccounts()
    return NextResponse.json({ accounts })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
