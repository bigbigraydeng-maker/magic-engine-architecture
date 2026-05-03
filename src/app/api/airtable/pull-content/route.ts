import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listRecords, updateRecord } from '@/lib/airtable/client'

// GET /api/airtable/pull-content?client_id=xxx
//
// 两种模式自动选择：
//   • 新模式 (airtable_content_table_id 已配置)：从客户社媒总表拉取
//     字段：Headline_EN / Caption_EN / LoveArt_Prompt_EN / Platform / Date+Time_NZST…
//     只拉 Status = "Ready" 的记录
//   • 兼容模式 (未配置)：从旧 "Content Calendar" 表读取（向后兼容）

export async function GET(req: NextRequest) {
  try {
    const client_id = req.nextUrl.searchParams.get('client_id')
    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required' }, { status: 400 })
    }

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, airtable_base_id, airtable_content_table_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json(
        { success: false, error: 'No Airtable base configured for this client' },
        { status: 400 }
      )
    }

    const useNewTable = !!client.airtable_content_table_id

    // ── 拉取记录 ──────────────────────────────────────────────────────────
    const records = await listRecords(
      client.airtable_base_id,
      useNewTable ? client.airtable_content_table_id : 'Content Calendar',
      {
        maxRecords: 200,
        // 新表只拉 Ready；旧 Content Calendar 拉全部（Magic Engine 自己管状态）
        filterByFormula: useNewTable ? "LOWER({Status}) = 'ready'" : undefined,
      }
    )

    let updated = 0
    let created = 0
    const errors: string[] = []

    for (const record of records) {
      const f = record.fields as Record<string, unknown>

      const patchData = useNewTable
        ? mapNewTableFields(f)
        : mapLegacyFields(f)

      // ── 新表：用 airtable_record_id 在 Supabase 查找已有行 ────────────
      if (useNewTable) {
        const { data: existing } = await supabaseAdmin
          .from('content_posts')
          .select('id')
          .eq('client_id', client_id)
          .eq('airtable_record_id', record.id)
          .maybeSingle()

        if (existing) {
          const { error } = await supabaseAdmin
            .from('content_posts')
            .update(patchData)
            .eq('id', existing.id)

          if (error) errors.push(`Update ${existing.id}: ${error.message}`)
          else updated++
        } else {
          const { error } = await supabaseAdmin
            .from('content_posts')
            .insert({ ...patchData, client_id, airtable_record_id: record.id })

          if (error) errors.push(`Create from ${record.id}: ${error.message}`)
          else created++
        }
        continue
      }

      // ── 旧 Content Calendar 表：用 "Supabase ID" 字段匹配 ───────────────
      const supabaseId = f['Supabase ID'] as string | undefined

      if (supabaseId) {
        const { error } = await supabaseAdmin
          .from('content_posts')
          .update({ ...patchData, airtable_record_id: record.id })
          .eq('id', supabaseId)

        if (error) errors.push(`Update ${supabaseId}: ${error.message}`)
        else updated++
      } else {
        const { data: newPost, error } = await supabaseAdmin
          .from('content_posts')
          .insert({ ...patchData, client_id, airtable_record_id: record.id })
          .select('id')
          .single()

        if (error || !newPost) {
          errors.push(`Create from ${record.id}: ${error?.message ?? 'no data'}`)
        } else {
          created++
          try {
            await updateRecord(
              client.airtable_base_id,
              'Content Calendar',
              record.id,
              { 'Supabase ID': newPost.id }
            )
          } catch (e) {
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
      mode: useNewTable ? 'social_calendar' : 'content_calendar',
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/pull-content]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ── 新表字段映射（CTS T061 April Social 结构）──────────────────────────────
function mapNewTableFields(f: Record<string, unknown>): Record<string, unknown> {
  const statusRaw = (f['Status'] as string | undefined)?.toLowerCase() ?? 'draft'
  // "ready" → approved（触发 Magic Engine 处理）
  const status = statusRaw === 'ready' ? 'approved' : 'draft'

  const platform = (f['Platform'] as string | undefined)?.toLowerCase().trim() ?? ''
  // Airtable singleSelect: "Facebook" / "Instagram"
  const platforms = platform ? [platform] : []

  const hashtagsRaw = f['Hashtags_IG'] as string | undefined
  const hashtags = hashtagsRaw
    ? hashtagsRaw.split(/\s+/).map(s => s.trim()).filter(Boolean)
    : null

  // 合并 Date + Time_NZST → scheduled_at (NZ = UTC+12)
  const scheduledAt = parseNZDateTime(
    f['Date'] as string | undefined,
    f['Time_NZST'] as string | undefined
  )

  const format = (f['Format'] as string) || null
  const ratio  = (f['Ratio']  as string) || null

  return {
    status,
    title:        (f['Headline_EN'] as string) || '',
    caption:      (f['Caption_EN'] as string) || null,
    script:       (f['Video_Text_Overlay'] as string) || null,
    hashtags,
    visual_brief: (f['LoveArt_Prompt_EN'] as string) || null,
    platforms,
    route:        'route_a',
    scheduled_at: scheduledAt,
    source_video_url: null,
    format,
    ratio,
  }
}

// ── 旧表字段映射（Content Calendar 结构）──────────────────────────────────
function mapLegacyFields(f: Record<string, unknown>): Record<string, unknown> {
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
    : null

  const routeRaw = f['Route'] as string | undefined
  const route = reverseRoute(routeRaw ?? '')

  return {
    status,
    title:        (f['Title'] as string) || '',
    caption:      (f['Caption'] as string) || null,
    script:       (f['Script'] as string) || null,
    hashtags,
    visual_brief: (f['Visual Brief'] as string) || null,
    platforms,
    route:        route || 'route_a',
    source_video_url: (f['Source URL'] as string) || null,
  }
}

// ── 工具函数 ───────────────────────────────────────────────────────────────

// NZ时间（UTC+12）合并日期和时间字符串 → ISO UTC
function parseNZDateTime(date?: string, time?: string): string | null {
  if (!date) return null
  // time 格式示例：'9:00', '09:00', '9:00am', '21:00'
  const timePart = time
    ? time.trim().replace(/am$/i, '').replace(/pm$/i, s => {
        const [h, m] = s.replace(/pm$/i, '').split(':')
        return `${parseInt(h) + 12}:${m || '00'}`
      })
    : '09:00'
  try {
    const local = new Date(`${date}T${timePart.padStart(5, '0')}:00+12:00`)
    return isNaN(local.getTime()) ? null : local.toISOString()
  } catch {
    return null
  }
}

function reverseRoute(s: string): string {
  if (s.includes('Route A') || s.toLowerCase().includes('seo to social')) return 'route_a'
  if (s.includes('Route B') || s.toLowerCase().includes('viral')) return 'route_b'
  if (s.includes('Route C') || s.toLowerCase().includes('master')) return 'route_c'
  return 'route_a'
}
