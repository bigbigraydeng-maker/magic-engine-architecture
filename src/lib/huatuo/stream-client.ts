/**
 * 华佗 SSE 流式响应读取器 — 客户端共享工具（P8.10.S5）
 *
 * 处方生成是 SSE 流式响应。这个 reader 解析事件流：
 *   data: {"type":"started","prescription_id":"..."}
 *   data: {"type":"progress","note":"..."}
 *   data: {"type":"done","content":...,"self_grade":...,...}
 *   data: {"type":"error","error":"..."}
 *
 * 心跳行（: heartbeat）会被忽略。
 * 处方页和执行看板内联抽屉共用此函数。
 */

import type { PrescriptionContent } from '@/types/diagnostic'
import type { SelfGrade, HuatuoGenerationMeta, TrendSummaryLite } from './types'

export interface HuatuoDonePayload {
  prescription_id: string
  content: PrescriptionContent
  self_grade?: SelfGrade
  meta?: HuatuoGenerationMeta & { trend_summary?: TrendSummaryLite }
  trend_summary?: TrendSummaryLite
}

export interface HuatuoStreamHandlers {
  onStarted?: (prescriptionId: string) => void
  onProgress?: (note: string) => void
  onDone: (payload: HuatuoDonePayload) => void
  onError: (error: string) => void
}

/**
 * 读取华佗 SSE 流。返回 true=收到 done/error，false=流意外关闭。
 */
export async function readHuatuoStream(
  res: Response,
  handlers: HuatuoStreamHandlers,
): Promise<boolean> {
  const reader = res.body?.getReader()
  if (!reader) return false

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawDoneOrError = false
  let streamError: string | null = null

  outer: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sepIdx: number
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)

      const lines = rawEvent.split('\n')
      let dataPayload: string | null = null
      for (const line of lines) {
        if (line.startsWith(':')) continue
        if (line.startsWith('data:')) {
          dataPayload = line.slice(5).trimStart()
        }
      }
      if (!dataPayload) continue

      let parsed: { type: string } & Record<string, unknown>
      try {
        parsed = JSON.parse(dataPayload) as { type: string } & Record<string, unknown>
      } catch (err) {
        console.warn('[huatuo stream] bad event JSON', dataPayload, err)
        continue
      }

      switch (parsed.type) {
        case 'started':
          handlers.onStarted?.(parsed.prescription_id as string)
          break
        case 'progress':
          handlers.onProgress?.((parsed.note as string) ?? '')
          break
        case 'done':
          sawDoneOrError = true
          handlers.onDone(parsed as unknown as HuatuoDonePayload)
          break
        case 'error':
          sawDoneOrError = true
          streamError = (parsed.error as string) ?? '未知错误'
          break outer
      }
    }
  }

  if (streamError) {
    handlers.onError(streamError)
    return false
  }
  return sawDoneOrError
}
