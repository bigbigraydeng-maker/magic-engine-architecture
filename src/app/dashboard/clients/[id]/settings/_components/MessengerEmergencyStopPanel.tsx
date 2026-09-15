'use client'

/**
 * MessengerEmergencyStopPanel —— 门户「紧急全渠道停」按钮（issue #1589）。
 *
 * 一次点击把这个客户的 Messenger + WhatsApp AI 客服自动回复全部关掉，
 * 写审计记录（谁点的、什么时候点的）。跟 `dashboard/admin/mcp-keys` 页的
 * kill switch 同一个二次确认模式（`window.prompt` 输入固定短语）——这是一个
 * 后果重大、按错了会让客户几小时收不到自动回复的操作，普通的
 * `window.confirm` 太容易被手滑点过去。
 *
 * 底层真正的开关逻辑不重新发明：API 路由复用 `stopAiRepliesForClient()`
 * （`src/lib/knowledge/kill-switch.ts`），跟客户自助确认页上「先别让 AI
 * 回复顾客」按的是同一个开关、写的是同一张审计表。
 */

import { useState } from 'react'

interface Props {
  clientId: string
}

const CONFIRM_PHRASE = 'STOP-ALL'

export function MessengerEmergencyStopPanel({ clientId }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleClick = async () => {
    const typed = window.prompt(
      `🚨 这会立刻停掉这个客户的 Messenger + WhatsApp AI 客服自动回复，改回需要再来这里手动打开。\n确定的话输入 ${CONFIRM_PHRASE}：`,
    )
    if (typed !== CONFIRM_PHRASE) return

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/messenger-agent/emergency-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        auditWarning?: string | null
      }
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setResult({
        ok: true,
        message: body.auditWarning
          ? `已经停了，但这次操作没能记进审计日志：${body.auditWarning}`
          : '已经停了 —— Messenger 和 WhatsApp 的 AI 客服自动回复现在都是关的。',
      })
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="mb-3 text-sm text-slate-700">
        出事时按这个：立刻把这个客户的 Messenger + WhatsApp AI 客服自动回复<strong>全部关掉</strong>，
        不用分别去关两个渠道。关掉后客户的私信会等人工回复，不会再由 AI 自动回。
        重新打开需要回到这里手动开——不会自己恢复。
      </p>
      <button
        onClick={handleClick}
        disabled={busy}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
      >
        {busy ? '正在关闭…' : '🚨 紧急全渠道停'}
      </button>
      {result && (
        <p className={`mt-3 text-xs ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {result.ok ? '✓ ' : '⚠ '}
          {result.message}
        </p>
      )}
    </div>
  )
}
