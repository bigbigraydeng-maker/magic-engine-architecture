'use client'

/**
 * GoogleAdsPanel — Google Ads customer ID.
 *
 * PR5 (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.3): this
 * used to be a fake "connect via OAuth" status tile — nothing in the codebase
 * ever writes provider='google_ads' to platform_oauth_connections, so it
 * showed "未连接" forever regardless of reality. Ad execution actually uses
 * one shared MCC (Manager) credential for every client, distinguished only
 * by customer_id — there's nothing to "connect" per client, just a number to
 * set. This panel is the real, always-truthful version of that.
 */

import React, { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type SourceLabel = { text: string; tone: 'set' | 'inherited' | 'unset' }

const SOURCE_LABELS: Record<string, SourceLabel> = {
  clients_table:               { text: '手动设置', tone: 'set' },
  platform_oauth_connections:  { text: '来自 OAuth 连接（未手动覆盖）', tone: 'inherited' },
  flywheel_actions_payload:    { text: '来自历史执行记录（未手动覆盖，建议手动确认一次）', tone: 'inherited' },
  none:                        { text: '未设置', tone: 'unset' },
}

export function GoogleAdsPanel({ clientId }: Props) {
  const [customerId, setCustomerId] = useState('')
  const [source, setSource]         = useState<string>('none')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null)

  // 魏征 2026-08-11 复审：保存成功后 load() 会把 loading 设回 true，整卡切成
  // spinner，把刚设置的"✓ 已保存"瞬间盖掉——用独立标记区分"首次加载"（要全卡
  // spinner）和"保存后静默刷新"（不要），避免这次视觉闪烁。
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/google-ads-customer-id`)
      if (res.ok) {
        const data = await res.json() as { customer_id: string | null; source: string }
        setCustomerId(data.customer_id ?? '')
        setSource(data.source)
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/google-ads-customer-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId.trim() || null }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (res.ok && data.success) {
        setMsg({ ok: true, text: '✓ 已保存' })
        await load({ silent: true })
      } else {
        setMsg({ ok: false, text: data.error ?? '保存失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误，请重试' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载…
      </div>
    )
  }

  const label = SOURCE_LABELS[source] ?? SOURCE_LABELS.none

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">
        广告投放走平台共享授权（一个后台账号管理所有客户），不需要每个客户单独连接 Google 账号——
        这里只需要填这个客户在 Google Ads 里的 10 位客户编号，用来在投放时区分是哪个客户。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={customerId}
          onChange={e => setCustomerId(e.target.value)}
          placeholder="1234567890 或 123-456-7890"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="shrink-0 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <p className={`mt-2 text-xs ${label.tone === 'set' ? 'text-emerald-600' : label.tone === 'inherited' ? 'text-amber-600' : 'text-slate-400'}`}>
        {label.text}
      </p>

      {msg && <p className={`mt-1 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
