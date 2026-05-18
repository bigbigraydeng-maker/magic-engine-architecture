import { NextResponse } from 'next/server'

// GET /api/airtable/pull-content
// Stub — Content Workspace 集成尚未完成
export async function GET() {
  return NextResponse.json({
    success: false,
    error: 'Content Workspace 同步正在接通中，即将上线',
  })
}
