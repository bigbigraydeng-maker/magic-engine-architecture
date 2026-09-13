'use client'

/**
 * 网站表单来了新客资，发邮件通知谁。
 *
 * 起因：Park Homes 合同白纸黑字写了「表单要把询盘发到 115parkhomes@gmail.com」，
 * 但 /api/clients/[id]/leads 一直只落库进 ME 的 CRM —— 落库了不等于客户知道，
 * 客户不会天天登 ME 后台看有没有新客资。这个面板补上「谁该收到邮件」这一环。
 *
 * 默认空：不填就不发，跟 mailchimpEnabled 一样默认关闭 —— 不是所有客户的网站表单
 * 都接了这个能力，也不是所有客户都想让 ME 代发通知邮件。
 */

import { useCallback, useEffect, useState } from 'react'

export function LeadNotifyEmailsPanel({ clientId }: { clientId: string }) {
  const [stored, setStored] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`)
      const json = (await res.json()) as { config?: { notifyEmails: string[] }; error?: string }
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      setStored(json.config?.notifyEmails ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const value = draft ?? (stored ?? []).join('\n')
  const dirty = draft !== undefined && draft !== (stored ?? []).join('\n')

  const save = async () => {
    if (draft === undefined) return
    setSaving(true)
    setErr(null)
    setRejected([])
    setSavedAt(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyEmails: draft }),
      })
      const json = (await res.json()) as {
        config?: { notifyEmails: string[] }
        rejected?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      setStored(json.config?.notifyEmails ?? [])
      setDraft(undefined)
      setRejected(json.rejected ?? [])
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (stored === null && !err) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-800">📨 新客资邮件通知谁</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        客户网站的表单一提交，除了进 ME 的 CRM，也会 best-effort 发一封邮件到这里 ——
        客户不用登 ME 后台也能第一时间知道有新客资。留空就只落库不发邮件。
      </p>

      <textarea
        value={value}
        rows={Math.max(3, (stored ?? []).length + 1)}
        placeholder={'115parkhomes@gmail.com'}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-cyan-500 focus:outline-none disabled:bg-slate-50"
      />

      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <span className="text-xs text-slate-400">一行一个，也可以用逗号隔开</span>
      </div>

      {savedAt && !err && (
        <p className="mt-1.5 text-xs text-emerald-600">
          ✓ 已保存（{savedAt}），认下 {(stored ?? []).length} 个收件地址
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-600">⚠ {err}</p>}
      {rejected.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          ⚠ 这几条看不出是邮箱，<strong>没有存进去</strong>：{rejected.join('、')}
        </p>
      )}
    </div>
  )
}
