'use client'

/**
 * GscPropertyPanel — 选「同步哪一个 GSC 网站(Property)」。
 *
 * 魏征 2026-08-11 复审揪出的缺口：GscPanel 只管 OAuth 连接状态，从来不管
 * "连的是哪个网站"——这一步之前活在已经退役的 connectors/[anchor]/page.tsx
 * 里，PR5 把那个页面删掉时漏了把这块功能搬过来。后果：新客户 GSC 授权完
 * 但选不了网站，`client_connectors.gsc.status` 永远卡在 'partial'，同步
 * 数据的 cron 和「立即同步」按钮都会跳过这个客户，且没有任何报错提示。
 *
 * 写入路径复用现成的 /api/clients/[id]/connectors/gsc/connect（老页面用的
 * 同一条），选好之后这条连接才会真正翻成 'connected'。
 */

import React, { useState, useEffect, useCallback } from 'react'

interface SiteOption {
  site_url: string
  permission_level: string
}

interface Payload {
  connected: boolean
  current: string | null
  options: SiteOption[]
  error?: 'needs_reauth' | 'google_unavailable'
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

export function GscPropertyPanel({ clientId }: { clientId: string }) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [choice, setChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [platformRes, statusRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/platform/gsc`),
        fetch(`/api/clients/${clientId}/connectors/status`),
      ])

      const platformData = platformRes.ok
        ? await platformRes.json() as { connections: Array<{ status: string }> }
        : { connections: [] }
      const connected = platformData.connections.some(c => c.status === 'active')

      if (!connected) {
        setState({ phase: 'ready', data: { connected: false, current: null, options: [] } })
        return
      }

      const statusData = statusRes.ok
        ? await statusRes.json() as { connectors: Array<{ anchor: string; config: Record<string, unknown> | null }> }
        : { connectors: [] }
      const current = (statusData.connectors.find(c => c.anchor === 'gsc')?.config?.site_url as string | undefined) ?? null

      const sitesRes = await fetch(`/api/clients/${clientId}/gsc/sites`)
      const sitesData = await sitesRes.json() as { success: boolean; sites?: SiteOption[]; error?: string }
      // sites/route.ts returns siteUrl/permissionLevel — normalise to this
      // panel's naming so it matches Ga4PropertyPanel's shape.
      const rawSites = (sitesData as unknown as { sites?: Array<{ siteUrl: string; permissionLevel: string }> }).sites ?? []
      if (!sitesData.success) {
        setState({
          phase: 'ready',
          data: { connected: true, current, options: [], error: 'google_unavailable' },
        })
        setChoice(current ?? '')
        return
      }

      setState({
        phase: 'ready',
        data: {
          connected: true,
          current,
          options: rawSites.map(s => ({ site_url: s.siteUrl, permission_level: s.permissionLevel })),
        },
      })
      setChoice(current ?? '')
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/connectors/gsc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { site_url: choice } }),
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error ?? '保存失败')
      setSavedAt(new Date().toLocaleTimeString())
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
          onClick={() => void load()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { data } = state

  if (!data.connected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          还没连上 Google Search Console —— 先在上面完成连接，这里才会出现网站可选。
        </p>
      </div>
    )
  }

  if (data.error === 'needs_reauth') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-800">连接失效了，需要重新连一次</p>
        <p className="mt-1 text-xs text-amber-700">
          在上面的「Google Search Console」重新连接后，这里会重新列出网站。
        </p>
      </div>
    )
  }

  const dirty = choice !== (data.current ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        这个客户的搜索数据会同步下面选中的这个网站。
        {data.current
          ? ' 已经选好了，一般不用动。'
          : ' 还没选 —— 在选好之前，同步不会有任何数据。'}
      </p>

      {data.error === 'google_unavailable' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 暂时问不到 Google（对方服务或权限问题），网站列表拉不出来。稍后重试；已经选好的不受影响。
        </p>
      )}

      {data.options.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          这个 Google 账号名下没看到任何 Search Console 网站。多半是客户还没在 Search Console 里加过这个网站，或者登错了账号。
        </p>
      ) : (
        <div className="space-y-2">
          {data.options.map(o => (
            <label
              key={o.site_url}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                choice === o.site_url
                  ? 'cursor-pointer border-cyan-400 bg-cyan-50'
                  : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="gsc-site"
                value={o.site_url}
                checked={choice === o.site_url}
                onChange={() => setChoice(o.site_url)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-800">{o.site_url}</span>
                <span className="block text-xs text-slate-500">{o.permission_level}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void handleSave()}
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
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
      </div>
    </div>
  )
}
