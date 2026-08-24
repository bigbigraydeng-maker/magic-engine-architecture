'use client'

/**
 * /dashboard/today — 今日待办 (22.E.S18 前置 · 滚动排班).
 *
 * The in-ME home of the PM's rolling to-do: today's pillar theme + live
 * counts with deep links. Reads GET /api/workbench/today — the same lib the
 * pm-daily-todo email renders, so inbox and dashboard never disagree.
 *
 * First brick of the "一条待办流" product surface (2026-07-28 拍板):
 * today it serves the PM; the data shape is per-client so FDE / client-boss
 * filtered views can layer on top later (四视角).
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface ClientCount {
  name: string
  id: string
  drafts?: number
  findings?: number
  cards?: number
  reels?: number
}

interface ManualItem {
  kind: string
  client_name: string
  client_id: string
  what: string
  how: string
  href: string
}

interface SetupTask {
  name: string
  id: string
  label: string
  href: string
}

interface TodayPayload {
  weekday: number
  weekday_label: string
  theme: { title: string; hint: string } | null
  nz_date: string
  counts: {
    setupTasks?: SetupTask[]
    draftsByClient: ClientCount[]
    findingsByClient: ClientCount[]
    recentCardsByClient: ClientCount[]
    reelsByClient: ClientCount[]
    manualItems: ManualItem[]
    cronFailures24h: number
  }
}

interface ReconciliationCluster {
  rootCauseKey: string
  clientName: string | null
  label: string
  occurrenceCount: number
  reason: string
}

interface ReconciliationSuppressedGroup {
  reason: string
  count: number
  sample: string
}

interface ReconciliationPreviewPayload {
  fixture: string
  before: number
  after: number
  unresolvedClusters: ReconciliationCluster[]
  suppressed: ReconciliationSuppressedGroup[]
}

type ReconciliationState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; data: ReconciliationPreviewPayload }

interface Incident {
  incidentKey: string
  rootCause: string
  affectedScope: string
  occurrenceCount: number
  affectedJobs: string[]
  status: 'OPEN' | 'RECOVERED' | 'RECOVERY_UNKNOWN'
}

interface IncidentPreviewPayload {
  fixture: string
  live: boolean
  totalRawOccurrences: number
  incidents: Incident[]
  totalAccountedOccurrences: number
}

type IncidentState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; data: IncidentPreviewPayload }

type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: TodayPayload }

function SectionCard({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-black text-slate-800">
        {emoji} {title}
      </p>
      {children}
    </div>
  )
}

function ClientRow({
  name,
  count,
  unit,
  href,
}: {
  name: string
  count: number
  unit: string
  href: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-sm text-slate-600">{name}</span>
      <span className="flex items-center gap-3">
        <span className="text-sm font-bold text-slate-800">
          {count} {unit}
        </span>
        <Link
          href={href}
          className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700"
        >
          去处理
        </Link>
      </span>
    </div>
  )
}

const REASON_LABEL: Record<string, string> = {
  GENUINE_UNRESOLVED: '真实未解决',
  HUMAN_DECISION_REQUIRED: '需要人工决策',
  CHECK_FAILED_UNRESOLVED: '核实失败（保留可见）',
  INTENTIONAL_STATE: '系统故意状态（非问题）',
  NOT_YET_DUE: '太新，还不到检查时间',
  CONNECTOR_ALREADY_CONNECTED: '其实已连接（误报）',
  DUPLICATE_WORK_ITEM: '和别处重复计数',
  TERMINAL_COMPLETED: '已经结束，只是没摘下来',
  AUTO_EXECUTABLE_NOT_HUMAN_WORK: '系统能自己做，不该算人工活',
}

/**
 * #1169 WP1 — reconciliation preview. Runs on the FROZEN audited-280
 * fixture, not live data (see the route's own comment): this proves the
 * reconciliation logic before it is wired to the real counts above.
 */
function ReconciliationPreviewCard({ state }: { state: ReconciliationState }) {
  if (state.phase === 'loading') {
    return <div className="mb-6 text-xs text-slate-400">加载 Todo Reconciliation 预览…</div>
  }
  if (state.phase === 'error') {
    return null
  }

  const { data } = state
  const suppressedSorted = [...data.suppressed].sort((a, b) => b.count - a.count)
  const clustersSorted = [...data.unresolvedClusters].sort((a, b) => b.occurrenceCount - a.occurrenceCount)

  return (
    <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
      <p className="mb-1 text-sm font-black text-violet-900">
        🧮 Todo Reconciliation Gate 预览（#1169 WP1 · 基于冻结审计样本，非实时数据）
      </p>
      <p className="mb-3 text-xs text-violet-700">
        原始记录 <b>{data.before}</b> 条 → 去重合并后真正未解决 <b>{data.after}</b> 组
        （被抑制 {data.suppressed.reduce((s, g) => s + g.count, 0)} 条，每条都带原因码，不会静默消失）
      </p>

      <p className="mb-1 text-xs font-bold text-violet-800">未解决（{clustersSorted.length} 组）</p>
      <div className="mb-3 space-y-1">
        {clustersSorted.slice(0, 8).map((c) => (
          <div key={c.rootCauseKey} className="flex items-center justify-between text-xs text-slate-700">
            <span className="truncate">
              {c.clientName ? `${c.clientName} · ` : ''}
              {c.label}
              {c.occurrenceCount > 1 ? ` ×${c.occurrenceCount}` : ''}
            </span>
            <span className="ml-2 shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-violet-700">
              {REASON_LABEL[c.reason] ?? c.reason}
            </span>
          </div>
        ))}
        {clustersSorted.length > 8 && (
          <p className="text-[11px] text-violet-500">还有 {clustersSorted.length - 8} 组未展示…</p>
        )}
      </div>

      <p className="mb-1 text-xs font-bold text-violet-800">被抑制的原因分布</p>
      <div className="flex flex-wrap gap-1.5">
        {suppressedSorted.map((g) => (
          <span
            key={g.reason}
            title={g.sample}
            className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600"
          >
            {REASON_LABEL[g.reason] ?? g.reason} × {g.count}
          </span>
        ))}
      </div>
    </div>
  )
}

const INCIDENT_STATUS_LABEL: Record<Incident['status'], string> = {
  OPEN: '🔴 未恢复',
  RECOVERED: '✅ 已验证恢复',
  RECOVERY_UNKNOWN: '⚪ 恢复状态未知（本预览未接入恢复核验）',
}

/**
 * Small local presentation mapping for the seven job names this frozen
 * fixture is known to emit — PM-facing Chinese label first, raw technical id
 * kept as secondary text for anyone who needs to grep the actual cron job.
 * Not a generic i18n framework: any job name outside this fixture just shows
 * its raw id unchanged.
 */
const JOB_LABEL_ZH: Record<string, string> = {
  'social-comment-autoreply': '社媒评论自动回复',
  'meta-leads-sync': 'Meta 留资同步',
  'market-intel-daily': '市场情报日报',
  'winner-reel-sync-daily': '爆款短视频同步',
  'ad-readback-sweep': '广告回读巡检',
  'google-data-pullback-daily': 'Google 数据回拉',
  'cms-connection-retest': 'CMS 连接复测',
}

function jobLabel(jobName: string): string {
  const zh = JOB_LABEL_ZH[jobName]
  return zh ? `${zh}（${jobName}）` : jobName
}

/**
 * #1169 WP3 — incident aggregation preview. Runs on the FROZEN audited-77
 * cron-failure fixture, not live data: one card per root-cause × affected
 * scope instead of 77 raw run rows. No retry/fix button — this slice only
 * proves the incident truth, it does not execute or heal anything.
 */
function IncidentPreviewCard({ state }: { state: IncidentState }) {
  if (state.phase === 'loading') {
    return <div className="mb-6 text-xs text-slate-400">加载 Incident Aggregation 预览…</div>
  }
  if (state.phase === 'error') {
    return null
  }

  const { data } = state
  const incidentsSorted = [...data.incidents].sort((a, b) => b.occurrenceCount - a.occurrenceCount)

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-1 text-sm font-black text-amber-900">
        🧯 Incident Aggregation 预览（#1169 WP3 · 冻结审计样本 / 非实时数据）
      </p>
      <p className="mb-3 text-xs text-amber-700">
        原始失败记录 <b>{data.totalRawOccurrences}</b> 条 → 按根因×影响范围聚合成 <b>{data.incidents.length}</b> 个事件
        （每条记录都算了一次，共 {data.totalAccountedOccurrences} 条，不多不少）
      </p>

      <div className="space-y-2">
        {incidentsSorted.map((i) => (
          <div key={i.incidentKey} className="rounded-lg bg-white p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-bold text-slate-800">{i.rootCause}</p>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                {INCIDENT_STATUS_LABEL[i.status]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              影响范围：{i.affectedScope} · 发生 {i.occurrenceCount} 次 · 涉及任务：
              {i.affectedJobs.map(jobLabel).join('、')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TodayPage() {
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [reconciliation, setReconciliation] = useState<ReconciliationState>({ phase: 'loading' })
  const [incidents, setIncidents] = useState<IncidentState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as TodayPayload
      setState({ phase: 'ready', data })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  const loadReconciliation = useCallback(async () => {
    setReconciliation({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today/reconciliation-preview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ReconciliationPreviewPayload
      setReconciliation({ phase: 'ready', data })
    } catch {
      setReconciliation({ phase: 'error' })
    }
  }, [])

  const loadIncidents = useCallback(async () => {
    setIncidents({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today/incident-preview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as IncidentPreviewPayload
      setIncidents({ phase: 'ready', data })
    } catch {
      setIncidents({ phase: 'error' })
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadReconciliation() }, [loadReconciliation])
  useEffect(() => { loadIncidents() }, [loadIncidents])

  if (state.phase === 'loading') {
    return <div className="p-8 text-sm text-slate-400">加载今日待办...</div>
  }

  if (state.phase === 'error') {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-red-700">加载失败：{state.message}</p>
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
  const { counts } = data
  const totalDrafts = counts.draftsByClient.reduce((s, c) => s + (c.drafts ?? 0), 0)
  const totalFindings = counts.findingsByClient.reduce((s, c) => s + (c.findings ?? 0), 0)
  const totalCards = counts.recentCardsByClient.reduce((s, c) => s + (c.cards ?? 0), 0)
  const totalReels = (counts.reelsByClient ?? []).reduce((s, c) => s + (c.reels ?? 0), 0)
  const manualItems = counts.manualItems ?? []
  const setupTasks = counts.setupTasks ?? []
  const total =
    setupTasks.length + manualItems.length +
    totalDrafts + totalFindings + totalCards + totalReels + counts.cronFailures24h

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-black text-slate-900">
          📋 今日待办 · {data.weekday_label} {data.nz_date}
        </h1>
        {data.theme && (
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-bold text-slate-700">{data.theme.title}</span>
            {data.theme.hint ? ` — ${data.theme.hint}` : ''}
          </p>
        )}
      </div>

      <ReconciliationPreviewCard state={reconciliation} />
      <IncidentPreviewCard state={incidents} />

      {total === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-bold text-emerald-700">
          今天没有待办 ✅ 系统都在正常跑。
        </div>
      ) : (
        <div className="space-y-4">
          {setupTasks.length > 0 && (
            <SectionCard emoji="🔌" title="要你点一次的连接（做一次，以后不再出现）">
              {setupTasks.map((t) => (
                <div
                  key={`${t.id}-${t.href}`}
                  className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-700">{t.name}</span>
                    <span className="block text-xs leading-relaxed text-slate-500">{t.label}</span>
                  </span>
                  {/* 跳外部 Google 授权页：必须整页导航，不能走 next/link 的客户端路由 */}
                  <a
                    href={t.href}
                    className="mt-0.5 shrink-0 rounded-lg bg-cyan-700 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-800"
                  >
                    去连接
                  </a>
                </div>
              ))}
            </SectionCard>
          )}

          {manualItems.length > 0 && (
            <SectionCard emoji="🙋" title="需要你动手（系统做不了的）">
              {manualItems.map((m, i) => (
                <div key={`${m.kind}-${i}`} className="border-b border-slate-100 py-2 last:border-b-0">
                  <p className="text-sm text-slate-800">
                    <span className="font-bold">{m.client_name}</span>：{m.what}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>→ {m.how}</span>
                    {/* 🔴 没有 href = 这条现在**没有地方可点**（比如入口还没上线）。
                        这时绝不能照样渲染一个「去做这件事」按钮 —— 一个点了没反应
                        的按钮比没有按钮更糟：它让人以为事情已经能做了，
                        于是没人再去建真正的入口。宁可不给按钮，也不给假的。 */}
                    {m.href ? (
                      <a
                        href={m.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700"
                      >
                        去做这件事
                      </a>
                    ) : null}
                  </p>
                </div>
              ))}
            </SectionCard>
          )}

          {totalDrafts > 0 && (
            <SectionCard emoji="📝" title="Blog 草稿待审">
              {counts.draftsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.drafts ?? 0}
                  unit="篇"
                  href={`/dashboard/clients/${c.id}/blog`}
                />
              ))}
            </SectionCard>
          )}

          {totalFindings > 0 && (
            <SectionCard emoji="🔎" title="SEO 巡逻新发现">
              {counts.findingsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.findings ?? 0}
                  unit="条"
                  href={`/dashboard/clients/${c.id}/execution`}
                />
              ))}
            </SectionCard>
          )}

          {totalCards > 0 && (
            <SectionCard emoji="🗂" title="本周新建议卡待处理">
              {counts.recentCardsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.cards ?? 0}
                  unit="张"
                  href={`/dashboard/clients/${c.id}/execution`}
                />
              ))}
            </SectionCard>
          )}

          {totalReels > 0 && (
            <SectionCard emoji="🎬" title="社媒成片待审">
              {(counts.reelsByClient ?? []).map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.reels ?? 0}
                  unit="条"
                  href="/dashboard/factory"
                />
              ))}
            </SectionCard>
          )}

          {counts.cronFailures24h > 0 && (
            <SectionCard emoji="⚠️" title="系统有活儿没跑成">
              <ClientRow
                name="过去 24 小时"
                count={counts.cronFailures24h}
                unit="次失败"
                href="/dashboard/admin/cron-health"
              />
            </SectionCard>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        每个工作日早上这份清单也会发到你的邮箱。数字实时统计，办完自动消失。
      </p>
    </div>
  )
}
