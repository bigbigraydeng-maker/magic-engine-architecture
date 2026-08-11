'use client'

/**
 * DataSnapshotPanel — GSC/GA4 数据快照预览 + 手动同步按钮。
 *
 * PR5：从 connectors/[anchor]/page.tsx 的 SnapshotSyncPanel 原样搬过来，逻辑
 * 不变（同一套 /api/clients/[id]/{anchor}/{snapshots,sync} 接口），只是从
 * 独立页面搬进 settings 页 GscPanel/Ga4Panel 下面。
 */

import { useState, useEffect } from 'react'

interface GscSnapshot {
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  period_start: string
  period_end: string
  synced_at: string
  top_queries: Array<{ query?: string; clicks: number }>
}

interface Ga4Snapshot {
  total_sessions: number
  total_users: number
  total_pageviews: number
  bounce_rate: number
  period_start: string
  period_end: string
  synced_at: string
  top_sources: Array<{ source: string; medium: string; sessions: number }>
}

type AnySnapshot = GscSnapshot | Ga4Snapshot

function isGsc(s: AnySnapshot): s is GscSnapshot {
  return 'total_clicks' in s
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function SnapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold leading-tight text-slate-700">{value}</p>
    </div>
  )
}

export function DataSnapshotPanel({ anchor, clientId }: { anchor: 'gsc' | 'ga4'; clientId: string }) {
  const [snapshot, setSnapshot] = useState<AnySnapshot | null>(null)
  const [loadingSnap, setLoadingSnap] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchLatest = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/${anchor}/snapshots?limit=1`)
      if (res.ok) {
        const data = await res.json() as { latest: AnySnapshot | null }
        setSnapshot(data.latest ?? null)
      }
    } finally {
      setLoadingSnap(false)
    }
  }

  useEffect(() => { void fetchLatest() }, [clientId, anchor]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/${anchor}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (data.success) {
        setSyncMsg({ ok: true, text: '✓ 同步成功' })
        setLoadingSnap(true)
        await fetchLatest()
      } else {
        setSyncMsg({ ok: false, text: data.error ?? '同步失败，请检查连接配置' })
      }
    } catch {
      setSyncMsg({ ok: false, text: '网络错误，请重试' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {anchor === 'gsc' ? '🔎 Search Console 数据快照' : '📈 Analytics 4 数据快照'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">点击「立即同步」拉取最近 28 天数据</p>
        </div>
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? '同步中…' : '立即同步'}
        </button>
      </div>

      {syncMsg && <p className={`text-xs ${syncMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{syncMsg.text}</p>}

      {loadingSnap ? (
        <div className="h-16 animate-pulse rounded-lg border border-slate-100 bg-white" />
      ) : snapshot ? (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-white p-3">
          <p className="text-[10px] text-slate-400">
            {snapshot.period_start} – {snapshot.period_end}
            {' · '}
            上次同步：{new Date(snapshot.synced_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>

          {isGsc(snapshot) ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SnapMetric label="点击量" value={fmtNum(snapshot.total_clicks)} />
                <SnapMetric label="展示量" value={fmtNum(snapshot.total_impressions)} />
                <SnapMetric label="平均 CTR" value={`${(snapshot.avg_ctr * 100).toFixed(1)}%`} />
                <SnapMetric label="平均排名" value={snapshot.avg_position.toFixed(1)} />
              </div>
              {snapshot.top_queries.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] text-slate-400">热门关键词</p>
                  <div className="space-y-0.5">
                    {snapshot.top_queries.slice(0, 3).map((q, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-slate-600">{q.query ?? '—'}</span>
                        <span className="shrink-0 text-slate-400">{fmtNum(q.clicks)} 点击</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SnapMetric label="会话数" value={fmtNum((snapshot as Ga4Snapshot).total_sessions)} />
                <SnapMetric label="用户数" value={fmtNum((snapshot as Ga4Snapshot).total_users)} />
                <SnapMetric label="页面浏览" value={fmtNum((snapshot as Ga4Snapshot).total_pageviews)} />
                <SnapMetric label="跳出率" value={`${((snapshot as Ga4Snapshot).bounce_rate * 100).toFixed(1)}%`} />
              </div>
              {(snapshot as Ga4Snapshot).top_sources.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] text-slate-400">主要流量来源</p>
                  <div className="space-y-0.5">
                    {(snapshot as Ga4Snapshot).top_sources.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-slate-600">
                          {s.source}{s.medium && s.medium !== '(none)' ? ` / ${s.medium}` : ''}
                        </span>
                        <span className="shrink-0 text-slate-400">{fmtNum(s.sessions)} 会话</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">暂无快照数据 — 连接成功后点击「立即同步」</p>
      )}
    </div>
  )
}
