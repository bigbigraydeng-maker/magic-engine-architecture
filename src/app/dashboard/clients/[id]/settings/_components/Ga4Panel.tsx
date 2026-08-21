'use client'

/** GA4-only view of the two independent truths: Google grant and verified Property. */

import { useCallback, useEffect, useState } from 'react'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

interface Props { clientId: string }

type State =
  | { phase: 'loading' }
  | { phase: 'load_error'; message: string }
  | { phase: 'disconnected' }
  | { phase: 'needs_reconnect'; connection: PlatformConnectionSummary }
  | { phase: 'authorized'; connection: PlatformConnectionSummary | null; verificationFailed: boolean }
  | { phase: 'connected'; connection: PlatformConnectionSummary | null; property: string }

const CONNECT_LABEL = '连接 Google 网站数据'

export function Ga4Panel({ clientId }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const connectHref = `/api/auth/google/connect?client_id=${clientId}&flow=admin`

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [propertyRes, oauthRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/ga4-properties`),
        fetch(`/api/clients/${clientId}/platform/ga4`),
      ])
      if (!propertyRes.ok || !oauthRes.ok) {
        throw new Error(`HTTP ${!propertyRes.ok ? propertyRes.status : oauthRes.status}`)
      }

      const property = (await propertyRes.json()) as {
        connected?: boolean
        connector_status?: string | null
        current?: string | null
      }
      const { connections } = (await oauthRes.json()) as { connections: PlatformConnectionSummary[] }
      const active = connections.find((connection) => connection.status === 'active') ?? null
      const errored = connections.find((connection) => connection.status === 'error') ?? null
      const current = typeof property.current === 'string' && /^properties\/\d{1,20}$/.test(property.current)
        ? property.current
        : null

      // A usable token is not the GA4 connector state. Green additionally
      // requires a verified connector row and a valid Property resource.
      if (property.connected === true && property.connector_status === 'connected' && current) {
        setState({ phase: 'connected', connection: active, property: current })
      } else if (property.connected === true) {
        setState({
          phase: 'authorized',
          connection: active,
          verificationFailed: property.connector_status === 'error',
        })
      } else if (errored) {
        setState({ phase: 'needs_reconnect', connection: errored })
      } else {
        setState({ phase: 'disconnected' })
      }
    } catch (error) {
      setState({ phase: 'load_error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [clientId])

  useEffect(() => {
    void load()
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId?: string }>).detail
      if (detail?.clientId === clientId) void load()
    }
    window.addEventListener('ga4-property-changed', reload)
    return () => window.removeEventListener('ga4-property-changed', reload)
  }, [clientId, load])

  if (state.phase === 'loading') {
    return <div className="text-sm text-slate-500">正在加载连接状态…</div>
  }

  if (state.phase === 'load_error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={() => void load()} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  if (state.phase === 'disconnected') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-black text-slate-900">Google Analytics 4</h3>
        <p className="mt-1 text-sm text-slate-500">连接后拉取真实的网站流量数据（会话、用户、页面浏览、跳出率、流量来源）。</p>
        <a href={connectHref} className="mt-3 inline-flex rounded-lg bg-cyan-700 px-4 py-2 text-sm font-black text-white">🔗 {CONNECT_LABEL}</a>
      </div>
    )
  }

  if (state.phase === 'needs_reconnect') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <h3 className="font-black text-slate-900">连接中断 — {state.connection.display_name}</h3>
        <p className="mt-1 text-sm text-amber-700">{state.connection.error_message ?? 'Google Analytics 4 授权已失效，需要重新授权。'}</p>
        <a href={connectHref} className="mt-3 inline-flex rounded-lg bg-amber-600 px-4 py-2 text-sm font-black text-white">🔄 重新授权</a>
      </div>
    )
  }

  if (state.phase === 'authorized') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Google 账号已授权</p>
        <h3 className="mt-0.5 truncate font-black text-slate-900">{state.connection?.display_name ?? 'Google Analytics 4'}</h3>
        <p className="mt-1 text-sm text-amber-800">
          {state.verificationFailed
            ? 'Property 验证没有通过。请在下方核对或手动填写正确的 Property ID。'
            : '还差一步：请在下方选择或手动填写 GA4 Property，验证成功后才算已连接。'}
        </p>
        <a href={connectHref} className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800">重新授权</a>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">已连接</p>
      <h3 className="mt-0.5 truncate font-black text-slate-900">{state.connection?.display_name ?? 'Google Analytics 4'}</h3>
      <p className="mt-0.5 truncate text-xs text-slate-500">{state.property}</p>
      <a href={connectHref} className="mt-3 inline-flex rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700">重新授权</a>
    </div>
  )
}
