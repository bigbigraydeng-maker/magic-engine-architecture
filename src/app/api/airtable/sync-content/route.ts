import { NextResponse } from 'next/server'

// POST /api/airtable/sync-content
// Stub — Content Workspace 集成尚未完成
export async function POST() {
  return NextResponse.json({
    success: false,
    error: 'Content Workspace 推送正在接通中，即将上线',
  })
}
