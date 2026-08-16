/**
 * POST /api/commerce/scan —— 选品扫描（自营内部工具，**会花钱**）。
 *
 * 🔴 鉴权：`guardGlobalAdmin()` —— 只放行全局 admin，拒受限/演示管理员。
 *    middleware 不覆盖 /api（见 require-admin.ts 注释），所以这里必须自鉴权，
 *    绝不读任何 `x-user-*` header（那是页面渲染用的、且可伪造）。
 *
 * 🔴 花钱封顶 + 防污染：入参一律过 `validateScanRequest`（种子词条数/长度、
 *    maxResults/enrichCount 封顶、成本假设逐字段区间校验）。绝不 spread 客户端 JSON。
 *
 * 🔴 为什么用 SSE 流式：一次 scanSeedKeyword 要跑多个 Apify actor（几十秒起步），
 *    单词就可能 1–2 分钟，同步请求会超时。流式在**同一条连接**里逐词推进度、
 *    最后推结果 —— 不超时、有进度、无跨请求 job store（不落库前提下唯一正确解）。
 *
 * 返回的是 canonical `SeedScanResult`（含完整 ProductCandidate，带 provenance），
 * 前端据此本地重算利润/判定，零回服务器、零重新烧钱。
 */

import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { validateScanRequest } from '@/lib/commerce/scan-request'
import { scanSeedKeyword } from '@/lib/commerce/product-intel/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const parsed = validateScanRequest(body)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const { seeds, market, assumptions, maxResults, enrichCount } = parsed.value

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      // 客户端断连后 controller 已关闭，enqueue 会抛 —— 吞掉，别让它冒泡成 unhandled。
      const send = (obj: unknown): void => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch { /* 连接已关，无处可发 */ }
      }
      try {
        const results = []
        for (let i = 0; i < seeds.length; i++) {
          // 🔴 admin 关页面/断连后别再烧剩余种子词的付费调用（狄仁杰 2026-08-17）。
          if (req.signal.aborted) break
          send({ type: 'progress', done: i, total: seeds.length, current: seeds[i] })
          const result = await scanSeedKeyword(seeds[i], assumptions, { maxResults, enrichCount })
          results.push(result)
        }
        if (!req.signal.aborted) {
          send({ type: 'done', market, assumptions, results, generatedAt: new Date().toISOString() })
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        try { controller.close() } catch { /* 已关 */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
