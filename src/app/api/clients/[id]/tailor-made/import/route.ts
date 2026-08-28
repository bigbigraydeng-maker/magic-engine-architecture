import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { extractItinerary, applyPatch } from '@/lib/tailor-made/extract'
import { detectKind, docxToText, plainToText, type SourceKind } from '@/lib/tailor-made/read-source'
import { heroForTrip, pickHeroName } from '@/lib/tailor-made/hero'
import { parseFlightPdf } from '@/lib/tailor-made/flights'
import { createOrReuseJob, markRunning, markCompleted, markFailed } from '@/lib/tailor-made/jobs'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/import
 *
 * 上传每日行程文件（Word / PDF / 纯文本），解析成行程数据。
 *
 * 这是新流程的第一步：顾问上传两份文件（这份 + 出票单 PDF），
 * 系统直接出预览，中间不填表。
 *
 * 三种格式各走各的最优路径：
 *   docx  → 解 zip 取正文（保住表格单元格边界，否则「Day 10」会和正文黏成一坨）
 *   pdf   → 直接以 document 喂 Claude，版式不丢，表格类行程解析明显更准
 *   text  → 原样
 * 三条路最后汇到同一个既有抽取链，规则一致：只照抄，不补价格/酒店/餐食。
 *
 * 顺带按目的地选好封面图 —— 甲方原话「重庆团封面就该是重庆」。
 *
 * ⚠️ 这个 POST 只建任务、立刻回 202——真正跑 AI 的活儿在 runImportJob() 里，
 * fire-and-forget，不占这次 HTTP 连接。原因：ME 后台正式域名走 Cloudflare
 * 代理，CF 对被代理的请求有约 100 秒等待上限；27 天以上的团光生成就要
 * 100-180 秒，同步等一个 HTTP 响应必然被 CF 掐断，浏览器只会收到一个
 * HTML 错误页，报 "Unexpected token '<'"（CTS 2027 China Panorama 实测）。
 * 前端改成轮询 /tailor-made/jobs/[jobId] 拿结果，见 TailorMadeEditor.tsx。
 *
 * Body: multipart { file, current, itineraryId }
 * Responses: 202 { job_id } / 400 / 401 / 403 / 413
 */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024

/**
 * PDF 走文档通道：先让 Claude 转成保结构的纯文本，再进抽取链。
 *
 * 这一步的截断和 extractItinerary() 的截断是两个独立的坑：这里如果被
 * max_tokens 切断，转录出来的文本本身就是残的，后面 extractItinerary()
 * 再准也没用——喂给它的原料已经少了几天。所以要单独加 bypassGateway
 * （长文档转录同样可能撞上 CF 网关超时）和 stop_reason 检查。
 */
async function pdfToText(base64: string, filename: string): Promise<string> {
  const res = await callClaudeWithDocs({
    systemPrompt:
      'Transcribe this travel itinerary document to plain text. Preserve the day-by-day structure, ' +
      'each day on its own lines, keeping dates, routes, descriptions, hotels and any pricing/inclusion ' +
      'sections. Do not summarise, do not omit, do not add. Output text only.',
    userMessage: '把这份行程文件转成保留结构的纯文本。',
    docs: [{ type: 'pdf', content: base64, filename }],
    maxOutputTokens: 12000,
    bypassGateway: true,
  })
  if (res.stop_reason === 'max_tokens') {
    throw new Error('行程文件转录到一半就被截断了（文件内容特别多的团容易发生）。请重试一次；如果还是不行，请联系技术支持处理')
  }
  return res.text.trim()
}

/**
 * 这份文件是出票单还是行程？
 *
 * 甲方两个框都传了，但导出的行程里航段是 0 —— 两个上传框长得一样、
 * 都收 PDF，传错框太容易，而传错之后系统还一声不吭当成行程去解析。
 *
 * 与其让人分辨，不如系统自己认：出票单和行程 Word 的特征差得很远。
 * 三个条件同时满足才算出票单，宁可漏判（当行程解析，顾问看得出来），
 * 也不要误判（把真行程当出票单，整份行程就没了）。
 */
function looksLikeTicket(text: string): boolean {
  const t = text.slice(0, 4000)
  const hasFlightNo = /\b[A-Z]{2}\s?\d{2,4}\b/.test(t)
  const hasLeg = /(departure|arrival|出发|到达)/i.test(t)
  const hasTicketMarker = /(booking\s*ref|\bPNR\b|e-?ticket|check-?in|操作航班|电子客票)/i.test(t)
  return hasFlightNo && hasLeg && hasTicketMarker
}

/** 后台真正干活的地方——不绑定任何 HTTP 连接，AI 想跑多久跑多久 */
async function runImportJob(params: {
  jobId: string
  kind: SourceKind
  base64: string
  filename: string
  current: TailorMadeItinerary
}): Promise<void> {
  const { jobId, kind, base64, filename, current } = params
  await markRunning(jobId)

  try {
    const arrayBuffer = Uint8Array.from(Buffer.from(base64, 'base64')).buffer
    let text: string
    if (kind === 'docx') text = await docxToText(arrayBuffer)
    else if (kind === 'pdf') text = await pdfToText(base64, filename)
    else text = await plainToText(arrayBuffer)

    if (text.length > 80_000) text = text.slice(0, 80_000)

    // 传错框也能救回来：认出是出票单就走航班解析，不当行程糟蹋掉
    if (kind === 'pdf' && looksLikeTicket(text)) {
      const flights = await parseFlightPdf(base64, filename)
      await markCompleted(jobId, {
        payload: { ...current, flights: flights.flights, bookingRef: flights.bookingRef || current.bookingRef },
        review: [],
        reply: `这份是出票单，不是行程 —— 已按航班读取。${flights.note}`,
        detectedAs: 'ticket',
      })
      return
    }

    const result = await extractItinerary({ message: text, current })
    const payload = applyPatch(current, result.patch)

    // 航班不能被行程导入冲掉。
    //
    // extractItinerary 压根不把 flights 传给模型（也不该传 —— 那是另一份
    // 文件的事），所以 patch 里永远没有 flights。但只要客户端传来的 current
    // 是旧的（先传航班、再传行程，两次点击之间 state 没跟上），航段就没了。
    // 甲方实测就是「第一版有航班，重新生成后没了」。
    if (!('flights' in (result.patch as Record<string, unknown>))) {
      payload.flights = current.flights ?? payload.flights
      payload.bookingRef = current.bookingRef || payload.bookingRef
    }

    // 封面按目的地自动选；顾问没手动指定过才覆盖
    // 自动选一定有猜错的时候（「重庆+张家界」哪个当主打？）。所以把选中的
    // 名字一并回传，界面上明说「系统选了 X」并给换的入口 —— 静默选错的话
    // 顾问未必注意到，直到客人收到才发现。
    let heroName: string | null = null
    if (!payload.trip.heroImage) {
      const hero = await heroForTrip(payload.trip)
      if (hero) {
        payload.trip.heroImage = hero
        heroName = pickHeroName(payload.trip)
      }
    }

    await markCompleted(jobId, { payload, review: result.review, reply: result.reply, heroName, sourceKind: kind })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/import]', msg)
    await markFailed(jobId, `行程文件解析失败：${msg}`)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let file: File | null = null
  let current: TailorMadeItinerary | null = null
  let itineraryId: string | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const cur = form.get('current')
    if (typeof cur === 'string' && cur) current = JSON.parse(cur) as TailorMadeItinerary
    const id = form.get('itineraryId')
    if (typeof id === 'string' && id) itineraryId = id
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: '请选择行程文件' }, { status: 400 })
  if (!current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })
  if (!itineraryId) return NextResponse.json({ error: '缺少行程 ID' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件过大（上限 12MB）' }, { status: 413 })

  const kind = detectKind(file.name, file.type)
  if (!kind) {
    return NextResponse.json(
      { error: '只支持 Word（.docx）、PDF 和纯文本。老式 .doc 请先另存为 .docx 或 PDF。' },
      { status: 400 },
    )
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  // 建任务本身也可能失败（比如表还没建好、DB 抖动）——不能让这里的异常
  // 甩给 Next.js 默认错误页：那正是这次要修的原始故障（HTML 错误页把
  // "Unexpected token '<'" 甩给浏览器），绝不能在这一层原样复现。
  let jobId: string, reused: boolean
  try {
    ;({ jobId, reused } = await createOrReuseJob({
      clientId: params.id,
      itineraryId,
      kind: 'import_file',
      input: { filename: file.name, sourceKind: kind },
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : '建任务失败'
    console.error('[tailor-made/import] createOrReuseJob failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!reused) {
    void runImportJob({ jobId, kind, base64, filename: file.name, current }).catch((err) => {
      console.error('[tailor-made/import] background job crashed', err)
    })
  }

  return NextResponse.json({ job_id: jobId }, { status: 202 })
}
