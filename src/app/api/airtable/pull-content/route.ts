import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listRecords, updateRecord } from '@/lib/airtable/client'

// GET /api/airtable/pull-content?client_id=xxx
// 从 Airtable Content Calendar 拉取内容回 Supabase content_posts
// 逻辑：有 Supabase ID → 更新已有行（状态、caption等）
//       无 Supabase ID → 新建行 + 回写 Supabase ID 到 Airtable
export async function GET(req: NextRequest) {
  try {
    const client_id = req.nextUrl.searchParams.get('client_id')
    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required' }, { status: 400 })
    }

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, airtable_base_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json(
        { success: false, error: 'No Airtable base configured for this client' },
        { status: 400 }
      )
    }

    // 拉取 Airtable 所有 Content Calendar 记录（最多200条）
    const records = await listRecords(
      client.airtable_base_id,
      'Content Calendar',
      { maxRecords: 200 }
    )

    let updated = 0
    let created = 0
    const errors: string[] = []

    for (const record of records) {
      const f = record.fields as Record<string, unknown>
      const supabaseId = f['Supabase ID'] as string | undefined

      // 字段映射：Airtable → Supabase
      const statusRaw = (f['Status'] as string | undefined)?.toLowerCase() ?? 'draft'
      const validStatuses = ['draft', 'approved', 'scheduled', 'published', 'rejected']
      const status = validStatuses.includes(statusRaw) ? statusRaw : 'draft'

      const platformsRaw = f['Platforms'] as string | undefined
      const platforms = platformsRaw
        ? platformsRaw.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
        : []

      const hashtagsRaw = f['Hashtags'] as string | undefined
      const hashtags = hashtagsRaw
        ? hashtagsRaw.split(/\s+/).map(s => s.trim()).filter(Boolean)
        : []

      const routeRaw = f['Route'] as string | undefined
      const route = reverseRoute(routeRaw ?? '')

      const patchData: Record<string, unknown> = {
        status,
        title: (f['Title'] as string) || '',
        caption: (f['Caption'] as string) || null,
        script: (f['Script'] as string) || null,
        hashtags: hashtags.length > 0 ? hashtags : null,
        visual_brief: (f['Visual Brief'] as string) || null,
        platforms: platforms.length > 0 ? platforms : [],
        route: route || 'route_a',
        source_video_url: (f['Source URL'] as string) || null,
      }

      if (supabaseId) {
        // 更新已有行
        const { error } = await supabaseAdmin
          .from('content_posts')
          .update({ ...patchData, airtable_record_id: record.id })
          .eq('id', supabaseId)

        if (error) {
          errors.push(`Update ${supabaseId}: ${error.message}`)
        } else {
          updated++
        }
      } else {
        // 新建行
        const { data: newPost, error } = await supabaseAdmin
          .from('content_posts')
          .insert({ ...patchData, client_id, airtable_record_id: record.id })
          .select('id')
          .single()

        if (error || !newPost) {
          errors.push(`Create from ${record.id}: ${error?.message ?? 'no data'}`)
        } else {
          created++
          // 回写 Supabase ID 到 Airtable
          try {
            await updateRecord(
              client.airtable_base_id,
              'Content Calendar',
              record.id,
              { 'Supabase ID': newPost.id }
            )
          } catch (e) {
            // 回写失败不阻断，仅记录
            errors.push(`Write-back ${record.id}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: records.length,
      updated,
      created,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/pull-content]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function reverseRoute(s: string): string {
  if (s.includes('Route A') || s.toLowerCase().includes('seo to social')) return 'route_a'
  if (s.includes('Route B') || s.toLowerCase().includes('viral')) return 'route_b'
  if (s.includes('Route C') || s.toLowerCase().includes('master')) return 'route_c'
  return 'route_a'
}
