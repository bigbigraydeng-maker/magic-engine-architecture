'use client'

/**
 * 连接客户自己的邮箱。
 *
 * 这一块是给**客户老板或他的 IT 同事**看的 —— 不是给我们自己看的。所以：
 *  · 说的是「客人发来的邮件」，不是「Microsoft Graph 授权」
 *  · 连上之后**把邮箱地址显示出来**：连错邮箱是这条管道最贵的错误（会把别的
 *    部门、甚至老板私人的邮件抓进客户的 CRM），必须让人当场看见连的是哪一个
 *  · 要人做的那一步只有一句话：「用你收 info@ 的那个账号登录一下」
 *
 * 为什么它必须存在（铁律 3）：这一步只有客户那边的人能点。做不了自动化的事，
 * 就要把它做成一个按钮 + 一句人话，而不是写进文档让 PM 转述。
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

export function MailboxPanel({ clientId }: { clientId: string }) {
  const params = useSearchParams()
  const [connections, setConnections] = useState<PlatformConnectionSummary[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/platform/mailbox`)
      if (!res.ok) throw new Error(String(res.status))
      const { connections: list } = (await res.json()) as {
        connections: PlatformConnectionSummary[]
      }
      setConnections(list)
    } catch {
      setConnections([])
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  // 授权回来时带的那句话（见 /api/auth/microsoft/mail/callback）。
  const justConnected = params.get('mail') === 'ok' ? params.get('addr') : null
  const justFailed = params.get('mail') === 'error' ? (params.get('why') ?? '连接失败') : null

  const active = (connections ?? []).filter((c) => c.status === 'active')

  const disconnect = async (id: string, addr: string) => {
    if (!window.confirm(`断开 ${addr}？断开后，客人发到这个邮箱的信不会再进 CRM。`)) return
    setBusy(true)
    try {
      await fetch(`/api/clients/${clientId}/platform/mailbox?connectionId=${id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {justConnected && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-sm font-black text-emerald-800">✓ 连上了：{justConnected}</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            客人发到这个邮箱的信，从现在起会自动出现在「今天该联系谁」里。
          </p>
        </div>
      )}
      {justFailed && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm font-black text-red-800">没连上</p>
          <p className="mt-0.5 text-xs text-red-700">{justFailed}</p>
        </div>
      )}

      {connections === null ? (
        <p className="text-sm text-slate-400">读取中…</p>
      ) : active.length === 0 ? (
        <>
          <p className="text-sm text-slate-700">
            还没连。客人现在发到公司邮箱的询价，<strong>系统里看不到</strong>。
          </p>
          <p className="mt-1 text-xs text-slate-500">
            点下面的按钮，用<strong>平时收这个邮箱的那个账号</strong>登录一次就好。
            我们只读这一个邮箱，不碰公司里其他任何邮箱。
          </p>
          <a
            href={`/api/auth/microsoft/mail/start?clientId=${clientId}`}
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700"
          >
            连接公司邮箱
          </a>
        </>
      ) : (
        <>
          <ul className="space-y-2">
            {active.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">✉️ {c.display_name}</p>
                  <p className="text-xs text-slate-500">
                    {c.last_synced_at ? `最近同步：${new Date(c.last_synced_at).toLocaleString('zh-CN')}` : '还没同步过'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect(c.id, c.display_name)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  断开
                </button>
              </li>
            ))}
          </ul>
          <a
            href={`/api/auth/microsoft/mail/start?clientId=${clientId}`}
            className="mt-3 inline-block text-xs font-bold text-slate-500 underline"
          >
            再连一个邮箱
          </a>
        </>
      )}
    </div>
  )
}
