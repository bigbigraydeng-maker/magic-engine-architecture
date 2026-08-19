'use client'

/**
 * Ga4PropertyPanel — 选「同步哪一个 GA4 Property」。
 *
 * 首次连接时自动选了第一个（跟 GBP 账号选择器一样的 MVP 简化），这个账号下
 * 有不止一个 Property 时，在这里换。跟 GbpLocationPanel 不同的是没有跨客户
 * 互斥检查——见 ga4/property.ts 头部注释，同一个 Property 被多个 ME 客户看到
 * 是正常的业务结构（比如共享代理权限），不是数据冲突。
 *
 * 2026-08-18（#1052 GA4 connector 诊断）：加了手动输入兜底 —— Google Admin
 * API 的自动发现偶尔会失败或者返回空列表（跟这个客户能不能读 GA4 数据是两
 * 件事，见 ga4/admin.ts 头部注释），这种情况下界面以前没有任何出路，只能干
 * 等。手动输入接受纯数字或 properties/数字两种格式，保存时后端会先拿它实际
 * 调一次 GA4 才决定要不要标"已连接"，所以粘贴错编号也不会假装成功。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface PropertyOption {
  property: string
  display_name: string
}

interface Payload {
  connected: boolean
  current: string | null
  options: PropertyOption[]
  error?: 'google_unavailable'
}

interface SaveResult {
  success: boolean
  property?: string
  status?: 'connected' | 'error'
  reason?: string
  message?: string
  error?: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

export function Ga4PropertyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [choice, setChoice] = useState<string>('')
  const [manualInput, setManualInput] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ga4-properties`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setChoice(data.current ?? '')
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async (property: string) => {
    setSaving(true)
    setErrMsg(null)
    setSaveNotice(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ga4-properties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property }),
      })
      const data = (await res.json().catch(() => ({}))) as SaveResult
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      if (data.status === 'error') {
        setSaveNotice({ ok: false, text: data.message ?? '保存了，但验证没通过。' })
      } else {
        setSaveNotice({ ok: true, text: '✓ 已保存并验证成功' })
      }
      setManualInput('')
      await load()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { data } = state

  const manualFallback = (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-bold text-slate-600">手动填 Property ID</p>
      <p className="mb-2 text-xs text-slate-500">
        去 analytics.google.com → 管理 → Property 详情，把「PROPERTY ID」那串数字粘过来
        （纯数字或 properties/数字都行）。保存时会先拿它实际读一次数据确认能用。
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="550203806 或 properties/550203806"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
        />
        <button
          onClick={() => void save(manualInput.trim())}
          disabled={!manualInput.trim() || saving}
          className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '验证中…' : '保存并验证'}
        </button>
      </div>
    </div>
  )

  if (!data.connected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          这个客户暂时没有可用的 Google 授权（GA4 专属或者 GSC 共享的都没有）——
          先在上面完成一次 Google 授权，这里才能验证 Property。
        </p>
        {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}
      </div>
    )
  }

  const dirty = choice !== (data.current ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        这个客户的流量归因会用下面选中的这个 Property 的数据。
        {data.current ? ' 已经选好了，一般不用动。' : ' 还没选。'}
      </p>

      {data.error === 'google_unavailable' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 自动列不出 Property 列表（对方服务或权限问题）。已经选好的不受影响；
          下面可以手动填 Property ID 顶上。
        </p>
      )}

      {data.options.length === 0 && data.error !== 'google_unavailable' ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          自动列不出这个 Google 账号名下的 GA4 Property——可能是账号没有 GA4 权限，
          也可能是真的还没建过。下面可以手动填 Property ID 试一次。
        </p>
      ) : (
        <div className="space-y-2">
          {data.options.map((o) => (
            <label
              key={o.property}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                choice === o.property
                  ? 'cursor-pointer border-cyan-400 bg-cyan-50'
                  : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="ga4-property"
                value={o.property}
                checked={choice === o.property}
                onChange={() => setChoice(o.property)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">{o.display_name}</span>
                <span className="block truncate text-xs text-slate-500">{o.property}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}
      {saveNotice && (
        <p className={`mt-2 text-xs ${saveNotice.ok ? 'text-emerald-600' : 'text-amber-700'}`}>
          {saveNotice.ok ? '✓' : '⚠'} {saveNotice.text}
        </p>
      )}

      {data.options.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void save(choice)}
            disabled={!dirty || !choice || saving}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? '保存中…' : '就用这一个'}
          </button>
          {dirty && !saving && (
            <button
              onClick={() => setChoice(data.current ?? '')}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              撤销修改
            </button>
          )}
        </div>
      )}

      {manualFallback}
    </div>
  )
}
