import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { fileToText, detectKind } from '@/lib/group-tours/read-source'
import { extractGroupTour, GroupTourExtractionError } from '@/lib/group-tours/extract'

/**
 * POST /api/clients/[id]/group-tours/[tourId]/import
 *
 * 上传团资料文件（行程文件必填 + 客户卖点材料可选），解析成结构化团数据。
 * 解析结果写回 group_tours 这一行，状态转成 'review' 等人工确认——
 * 这一步只解析，不落发布，跟 CTS 自己那个原型的"不落库不建页面"边界一致，
 * 差异是这里会落库存草稿，供后续人工编辑/确认/发布。
 *
 * Body: multipart { itineraryFile, sellingPointsFile?, sellingPointsText? }
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 20 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { id: string; tourId: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '请求格式不对，需要 multipart/form-data。' }, { status: 400 })
  }

  const itineraryFile = form.get('itineraryFile')
  if (!(itineraryFile instanceof File) || itineraryFile.size === 0) {
    return NextResponse.json({ error: '请选择团资料文件（行程文档）。' }, { status: 400 })
  }
  if (itineraryFile.size > MAX_BYTES) {
    return NextResponse.json({ error: `文件超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限。` }, { status: 413 })
  }
  if (!detectKind(itineraryFile.name, itineraryFile.type)) {
    return NextResponse.json(
      { error: '只支持 Word（.docx）、PDF 和纯文本。老式 .doc 请先另存为 .docx 或 PDF。' },
      { status: 400 },
    )
  }

  const sellingPointsFile = form.get('sellingPointsFile')
  if (sellingPointsFile instanceof File && sellingPointsFile.size > MAX_BYTES) {
    return NextResponse.json({ error: '卖点材料超过大小上限。' }, { status: 413 })
  }
  const sellingPointsText = form.get('sellingPointsText')?.toString() ?? null

  try {
    const itineraryText = await fileToText(itineraryFile)
    const sellingPointsFileText =
      sellingPointsFile instanceof File && sellingPointsFile.size > 0 ? await fileToText(sellingPointsFile) : null
    const combinedSellingPoints = [sellingPointsFileText, sellingPointsText].filter(Boolean).join('\n\n') || null

    const result = await extractGroupTour({ itineraryText, sellingPointsText: combinedSellingPoints })

    const { data, error } = await supabaseAdmin
      .from('group_tours')
      .update({
        title: result.payload.title || undefined,
        slug: result.payload.suggestedSlug || undefined,
        payload: result.payload,
        confidence_notes: result.confidenceNotes,
        client_claims_to_verify: result.clientClaimsToVerify,
        missing_fields: result.missingFields,
        required_fields_confirmed: false,
        status: 'review',
        source_document_name: itineraryFile.name,
        source_document_kind: detectKind(itineraryFile.name, itineraryFile.type),
      })
      .eq('id', params.tourId)
      .eq('client_id', params.id)
      .select('*')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: '找不到这个团' }, { status: 404 })

    return NextResponse.json({
      tour: data,
      blogAngles: result.blogAngles,
      usage: result.usage,
    })
  } catch (error) {
    if (error instanceof GroupTourExtractionError) {
      return NextResponse.json({ error: `解析失败：${error.message}` }, { status: 502 })
    }
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[group-tours/import]', msg)
    return NextResponse.json(
      { error: `文件解析失败：${msg}。请检查文件是否完整，或换成 PDF 重新上传；仍不行请联系 Ray。` },
      { status: 502 },
    )
  }
}
