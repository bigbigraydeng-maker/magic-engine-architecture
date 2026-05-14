'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { ExecutionItem, ExecutionItemStatus, ExecutionLog, PrescriptionStatus } from '@/types/diagnostic'
import { LubanChatDrawer } from './_components/LubanChatDrawer'

interface PrescriptionMeta {
  id: string
  status: PrescriptionStatus
  supplements_id: string | null
  supersedes_id: string | null
  generated_at: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

type ItemWithLogs = ExecutionItem & { logs: ExecutionLog[] }

const FIX_TYPE_META: Record<string, { icon: string; label: string; cls: string }> = {
  me_auto:     { icon: '🤖', label: 'ME 自动',  cls: 'bg-blue-100 text-blue-700' },
  fde_manual:  { icon: '👤', label: 'FDE 手动', cls: 'bg-purple-100 text-purple-700' },
  third_party: { icon: '🔗', label: '第三方',   cls: 'bg-gray-100 text-gray-600' },
}

const STATUS_META: Record<ExecutionItemStatus, { label: string; color: string }> = {
  pending:     { label: '待处理', color: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed:   { label: '已完成', color: 'bg-green-100 text-green-700' },
  skipped:     { label: '已跳过', color: 'bg-yellow-100 text-yellow-700' },
}

const PHASE_LABELS: Record<number, { name: string; color: string }> = {
  1: { name: 'Phase 1 — 即时修复',  color: 'bg-indigo-600' },
  2: { name: 'Phase 2 — 结构改善',  color: 'bg-purple-600' },
  3: { name: 'Phase 3 — 长期增长',  color: 'bg-teal-600'   },
}

// module → 工作台跳转
const MODULE_ROUTE: Record<string, { label: string; path: (clientId: string) => string }> = {
  seo_engine:       { label: 'SEO 引擎',  path: c => `/dashboard/clients/${c}/site-audit/pages` },
  social_matrix:    { label: '社媒矩阵',  path: c => `/dashboard/clients/${c}?tab=reels` },
  ads_intelligence: { label: '广告',      path: c => `/dashboard/clients/${c}?tab=campaigns` },
  insight_reports:  { label: '数据报告',  path: c => `/dashboard/clients/${c}` },
}

const LOG_KIND_META: Record<string, { icon: string; cls: string }> = {
  note:          { icon: '📝', cls: 'text-gray-600' },
  status_change: { icon: '🔄', cls: 'text-blue-600' },
  ai_assist:     { icon: '🤖', cls: 'text-indigo-600' },
  blocker:       { icon: '🚧', cls: 'text-red-600' },
  adjustment:    { icon: '🔧', cls: 'text-amber-600' },
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">整体执行进度</span>
          <span className="text-sm font-bold text-indigo-700">{pct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-right whitespace-nowrap">
        <span className="text-2xl font-bold text-indigo-700">{completed}</span>
        <span className="text-sm text-gray-400"> / {total}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 工作日志时间线
// ---------------------------------------------------------------------------

function WorklogTimeline({ logs }: { logs: ExecutionLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-gray-400 py-2">暂无工作记录</p>
  }
  return (
    <ul className="space-y-2">
      {logs.map(log => {
        const m = LOG_KIND_META[log.kind] ?? { icon: '·', cls: 'text-gray-500' }
        const when = new Date(log.created_at).toLocaleString('zh-CN', {
          timeZone: 'Pacific/Auckland', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
        const authorLabel = log.author === 'fde' ? 'FDE' : log.author === 'luban' ? '鲁班' : '系统'
        return (
          <li key={log.id} className="flex gap-2 text-xs">
            <span className="shrink-0">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <span className={`${m.cls} break-words`}>{log.content}</span>
              <span className="text-gray-300 ml-2 whitespace-nowrap">{authorLabel} · {when}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// FDE 元数据行（从 steps_json 读取华佗写入的字段）
// ---------------------------------------------------------------------------

function FdeMetaRow({ stepsJson }: { stepsJson: Record<string, unknown> | null }) {
  if (!stepsJson) return null
  const hours   = typeof stepsJson.estimated_hours === 'number' ? stepsJson.estimated_hours : null
  const skills  = Array.isArray(stepsJson.required_skills) ? stepsJson.required_skills as string[] : []
  const measure = typeof stepsJson.measurement_method === 'string' ? stepsJson.measurement_method : null
  const deps    = Array.isArray(stepsJson.dependencies) ? stepsJson.dependencies as string[] : []

  if (hours == null && skills.length === 0 && !measure && deps.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {hours != null && <span>⏱ 预计 <strong className="text-gray-700">{hours}h</strong></span>}
      {skills.length > 0 && <span>🛠 {skills.join(' / ')}</span>}
      {measure && <span>📏 {measure}</span>}
      {deps.length > 0 && <span className="text-amber-600">↳ 依赖 {deps.length} 项</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单个执行项（可展开）
// ---------------------------------------------------------------------------

function ExecutionItemRow({
  item,
  onStatusChange,
  onAddLog,
  onOpenChat,
}: {
  item: ItemWithLogs
  onStatusChange: (id: string, status: ExecutionItemStatus) => void
  onAddLog: (id: string, content: string, kind: 'note' | 'blocker') => Promise<void>
  onOpenChat: (item: ItemWithLogs) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingLog, setAddingLog] = useState(false)

  const stepsJson = item.steps_json as Record<string, unknown> | null
  const fixMeta   = FIX_TYPE_META[item.fix_type] ?? { icon: '❓', label: item.fix_type, cls: 'bg-gray-100 text-gray-600' }
  const statusM   = STATUS_META[item.status]
  const moduleKey = typeof stepsJson?.module === 'string' ? stepsJson.module : null
  const moduleRoute = moduleKey ? MODULE_ROUTE[moduleKey] : null
  const isDone    = item.status === 'completed' || item.status === 'skipped'

  const submitNote = async (kind: 'note' | 'blocker') => {
    if (!noteText.trim()) return
    setAddingLog(true)
    try {
      await onAddLog(item.id, noteText.trim(), kind)
      setNoteText('')
    } finally {
      setAddingLog(false)
    }
  }

  return (
    <div className={`rounded-lg border bg-white ${isDone ? 'opacity-70' : ''}`}>
      {/* 头部行 */}
      <div className="p-4 flex items-start gap-3">
        <span className="text-xl mt-0.5" title={fixMeta.label}>{fixMeta.icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                {item.title}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusM.color}`}>
              {statusM.label}
            </span>
          </div>

          {/* FDE 元数据 */}
          <div className="mt-2">
            <FdeMetaRow stepsJson={stepsJson} />
          </div>

          {/* 标签行 + 展开按钮 */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${fixMeta.cls}`}>
              {fixMeta.label}
            </span>
            {moduleRoute && (
              <Link
                href={moduleRoute.path(item.client_id)}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                在 {moduleRoute.label} 中执行 →
              </Link>
            )}
            {item.logs.length > 0 && (
              <span className="text-[11px] text-gray-400">{item.logs.length} 条工作记录</span>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-gray-500 hover:text-gray-800 ml-auto"
            >
              {expanded ? '收起 ▲' : '展开详情 ▼'}
            </button>
          </div>
        </div>
      </div>

      {/* 展开区：鲁班对话入口 + 状态流转 + 工作日志 */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
          {/* 鲁班对话入口 — 醒目 */}
          <button
            onClick={() => onOpenChat(item)}
            className="w-full flex items-center gap-2.5 rounded-lg border-2 border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
          >
            <span className="text-base">🔨</span>
            <span className="flex-1 text-left">与鲁班对话 — 让 AI 帮你起草内容、分析卡点、拆解下一步</span>
            <span className="text-indigo-400">→</span>
          </button>

          {/* 状态流转按钮 */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">状态</p>
            <div className="flex flex-wrap gap-2">
              {(['pending', 'in_progress', 'completed', 'skipped'] as ExecutionItemStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => item.status !== s && onStatusChange(item.id, s)}
                  disabled={item.status === s}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    item.status === s
                      ? `${STATUS_META[s].color} ring-1 ring-inset ring-gray-300 cursor-default`
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* 工作日志时间线 */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              工作记录时间线
            </p>
            <WorklogTimeline logs={item.logs} />
          </div>

          {/* 加记录输入框 */}
          {!isDone && (
            <div className="flex items-start gap-2">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                placeholder="记录执行进度，或标记卡点…"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  onClick={() => void submitNote('note')}
                  disabled={addingLog || !noteText.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  📝 记录
                </button>
                <button
                  onClick={() => void submitNote('blocker')}
                  disabled={addingLog || !noteText.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  🚧 卡点
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 折叠态的快捷"标记完成" */}
      {!expanded && !isDone && (
        <div className="px-4 pb-3 -mt-1 flex justify-end">
          <button
            onClick={() => onStatusChange(item.id, 'completed')}
            className="rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
          >
            ✓ 标记完成
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase 折叠卡
// ---------------------------------------------------------------------------

function PhaseAccordion({
  phase,
  items,
  defaultOpen,
  onStatusChange,
  onAddLog,
  onOpenChat,
}: {
  phase: number
  items: ItemWithLogs[]
  defaultOpen: boolean
  onStatusChange: (id: string, status: ExecutionItemStatus) => void
  onAddLog: (id: string, content: string, kind: 'note' | 'blocker') => Promise<void>
  onOpenChat: (item: ItemWithLogs) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const meta      = PHASE_LABELS[phase] ?? { name: `Phase ${phase}`, color: 'bg-gray-600' }
  const completed = items.filter(i => i.status === 'completed').length

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-white hover:bg-gray-50 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${meta.color}`} />
        <span className="font-semibold text-gray-900 flex-1 text-left">{meta.name}</span>
        <span className="text-xs text-gray-400">{completed}/{items.length} 完成</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-gray-50 border-t border-gray-100 p-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">此阶段暂无执行项</p>
          ) : (
            items.map(item => (
              <ExecutionItemRow
                key={item.id}
                item={item}
                onStatusChange={onStatusChange}
                onAddLog={onAddLog}
                onOpenChat={onOpenChat}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PrescriptionGroup — 一个处方的执行项分组（P8.10.S5）
// ---------------------------------------------------------------------------

interface GroupData {
  pid: string
  items: ItemWithLogs[]
  meta?: PrescriptionMeta
  label: string
  weight: number
  archived: boolean
  derivable: boolean   // 是否可派生（补充/修订）—— 仅 approved 且非归档
}

function PrescriptionGroup({
  clientId,
  group,
  defaultOpen,
  onStatusChange,
  onAddLog,
  onOpenChat,
}: {
  clientId: string
  group: GroupData
  defaultOpen: boolean
  onStatusChange: (id: string, status: ExecutionItemStatus) => void
  onAddLog: (id: string, content: string, kind: 'note' | 'blocker') => Promise<void>
  onOpenChat: (item: ItemWithLogs) => void
}) {
  const { items, label, archived, derivable, pid, meta } = group

  // 该处方内按 phase 分组
  const byPhase: Record<number, ItemWithLogs[]> = {}
  for (const it of items) {
    ;(byPhase[it.phase ?? 1] ??= []).push(it)
  }
  const completed = items.filter(i => i.status === 'completed').length
  const genDate = meta?.generated_at
    ? new Date(meta.generated_at).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
    : null

  const labelCls =
    label === '原处方'   ? 'bg-indigo-100 text-indigo-700' :
    label === '补充处方' ? 'bg-blue-100 text-blue-700' :
    label === '修订版'   ? 'bg-amber-100 text-amber-700' :
                           'bg-gray-200 text-gray-500'

  return (
    <div className={`rounded-xl border ${archived ? 'border-gray-200 opacity-75' : 'border-gray-300'} bg-white overflow-hidden`}>
      {/* 处方组头 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${labelCls}`}>
          {label}
        </span>
        {genDate && <span className="text-xs text-gray-400">生成于 {genDate}</span>}
        <span className="text-xs text-gray-400">{completed}/{items.length} 完成</span>

        {/* 派生按钮 — 仅已批准的活跃处方 */}
        {derivable && (
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/dashboard/clients/${clientId}/prescription/new?supplement_of=${pid}`}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              title="为这份处方生成增量动作，原处方不动"
            >
              🧩 补充处方
            </Link>
            <Link
              href={`/dashboard/clients/${clientId}/prescription/new?revise=${pid}`}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              title="生成修订版 v2，批准后这份处方归档"
            >
              ↻ 修订处方
            </Link>
          </div>
        )}
        {archived && (
          <span className="ml-auto text-xs text-gray-400">此处方已被修订版取代，仅供存档参考</span>
        )}
      </div>

      {/* 该处方的 3 个 phase */}
      <div className="p-4 space-y-3 bg-gray-50">
        {[1, 2, 3].map(phase => {
          const phaseItems = byPhase[phase] ?? []
          if (phaseItems.length === 0) return null
          return (
            <PhaseAccordion
              key={phase}
              phase={phase}
              items={phaseItems}
              defaultOpen={defaultOpen && phase === 1}
              onStatusChange={onStatusChange}
              onAddLog={onAddLog}
              onOpenChat={onOpenChat}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutionPage() {
  const params         = useParams()
  const searchParams   = useSearchParams()
  const clientId       = params.id as string
  const prescriptionId = searchParams.get('prescription_id') ?? undefined

  const [items, setItems]     = useState<ItemWithLogs[]>([])
  const [prescriptions, setPrescriptions] = useState<PrescriptionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)       // 页面加载错误（整页）
  const [opError, setOpError] = useState<string | null>(null)       // 操作错误（内联横幅）
  // 当前打开鲁班对话的执行项（null = 抽屉关闭）
  const [chatItem, setChatItem] = useState<ItemWithLogs | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = prescriptionId ? `?prescription_id=${prescriptionId}` : ''
      const res = await fetch(`/api/clients/${clientId}/execution${qs}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { items: ItemWithLogs[]; prescriptions?: PrescriptionMeta[] }
      setItems(data.items ?? [])
      setPrescriptions(data.prescriptions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, prescriptionId])

  useEffect(() => { void fetchItems() }, [fetchItems])

  // 状态变更 — 乐观更新（点击立即变）+ 失败回滚并报错
  const handleStatusChange = useCallback(async (itemId: string, status: ExecutionItemStatus) => {
    // 1. 乐观更新：立即把 UI 改成新状态
    setItems(cur => cur.map(i => i.id === itemId ? { ...i, status } : i))
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify({ status }),
        cache:   'no-store',
      })
      if (!res.ok) {
        setOpError(`状态更新失败（HTTP ${res.status}）`)
        await fetchItems()   // 回滚到服务器真实状态
        return
      }
      // 成功 — 重新拉取拿到新的 status_change 日志
      await fetchItems()
    } catch {
      setOpError('状态更新失败，请重试')
      await fetchItems()     // 回滚
    }
  }, [clientId, fetchItems])

  // 加工作日志 — 失败可见
  const handleAddLog = useCallback(async (itemId: string, content: string, kind: 'note' | 'blocker') => {
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}/log`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify({ content, kind }),
        cache:   'no-store',
      })
      if (!res.ok) {
        setOpError(`工作记录保存失败（HTTP ${res.status}）`)
        return
      }
      const data = await res.json() as { log: ExecutionLog }
      // 把新 log 追加到对应 item
      setItems(prev => prev.map(it =>
        it.id === itemId ? { ...it, logs: [...it.logs, data.log] } : it
      ))
    } catch {
      setOpError('工作记录保存失败，请重试')
    }
  }, [clientId])

  const completedCount = items.filter(i => i.status === 'completed').length

  // ── 按处方分组（P8.10.S5）──────────────────────────────────────────────
  const presMap = new Map(prescriptions.map(p => [p.id, p]))

  // items 先按 prescription_id 分组
  const itemsByPrescription: Record<string, ItemWithLogs[]> = {}
  for (const item of items) {
    ;(itemsByPrescription[item.prescription_id] ??= []).push(item)
  }

  // 每个处方组：label + 排序权重 + 是否可派生（补充/修订）
  const prescriptionGroups = Object.entries(itemsByPrescription)
    .map(([pid, groupItems]) => {
      const meta = presMap.get(pid)
      let label = '处方'; let weight = 5; let archived = false; let derivable = false
      if (meta) {
        if (meta.status === 'superseded') { label = '已归档 · 被修订取代'; weight = 9; archived = true }
        else if (meta.supersedes_id)      { label = '修订版';   weight = 2; derivable = meta.status === 'approved' }
        else if (meta.supplements_id)     { label = '补充处方'; weight = 3; derivable = meta.status === 'approved' }
        else                              { label = '原处方';   weight = 1; derivable = meta.status === 'approved' }
      }
      return { pid, items: groupItems, meta, label, weight, archived, derivable }
    })
    .sort((a, b) =>
      a.weight - b.weight ||
      (a.meta?.generated_at ?? '').localeCompare(b.meta?.generated_at ?? ''),
    )

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="h-7 w-56 bg-gray-200 rounded" />
          <div className="h-14 bg-gray-200 rounded-xl" />
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    )
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-3">
            <p className="text-4xl">📋</p>
            <h2 className="font-semibold text-gray-900">暂无执行计划</h2>
            <p className="text-sm text-gray-500">
              请先生成并批准一份处方，系统将自动创建执行计划。
            </p>
            <Link
              href={`/dashboard/clients/${clientId}/prescription/new`}
              className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              生成处方
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">执行看板</h1>
            <p className="text-xs text-gray-400 mt-0.5">鲁班执行代理 · 按阶段跟踪处方落地进度</p>
          </div>
          <Link
            href={`/dashboard/clients/${clientId}/prescription/new`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
          >
            ＋ 新处方
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        {/* 操作错误提示（状态变更 / 加日志失败时） */}
        {opError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3 text-sm text-red-700">
            <span>{opError}</span>
            <button onClick={() => setOpError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        <ProgressBar completed={completedCount} total={items.length} />

        {/* 按处方分组 — 原处方 / 补充 / 修订 / 已归档 各成一组 */}
        {prescriptionGroups.map((group, gi) => (
          <PrescriptionGroup
            key={group.pid}
            clientId={clientId}
            group={group}
            defaultOpen={gi === 0}
            onStatusChange={handleStatusChange}
            onAddLog={handleAddLog}
            onOpenChat={setChatItem}
          />
        ))}
      </div>

      {/* 鲁班对话抽屉 */}
      {chatItem && (
        <LubanChatDrawer
          clientId={clientId}
          itemId={chatItem.id}
          itemTitle={chatItem.title}
          isOpen={true}
          onClose={() => setChatItem(null)}
          onLogSaved={() => void fetchItems()}
        />
      )}
    </div>
  )
}
