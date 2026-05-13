'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { DiagnosticRun, PrescriptionContent, PrescriptionIntake, DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

const URGENCY_OPTIONS: Array<{ value: PrescriptionIntake['timeline_urgency']; label: string }> = [
  { value: 'immediate',   label: '⚡ 即刻（1–2 周内启动）' },
  { value: 'short_term',  label: '📅 短期（1–3 个月）' },
  { value: 'long_term',   label: '🗓️ 长期（3–6 个月）' },
]

const DIMENSION_OPTIONS: Array<{ value: DiagnosticDimension; label: string }> = [
  { value: 'seo',           label: 'SEO' },
  { value: 'ai_visibility', label: 'AI 可见度' },
  { value: 'social',        label: '社媒' },
  { value: 'reputation',    label: '口碑' },
  { value: 'competitor',    label: '竞品' },
  { value: 'ads',           label: '广告' },
]

type Step = 1 | 2 | 3 | 4

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: '选择快照' },
    { n: 2, label: '填写意向' },
    { n: 3, label: '生成处方' },
    { n: 4, label: '审阅批准' },
  ]
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            current === s.n ? 'bg-indigo-600 text-white' :
            current > s.n  ? 'bg-green-100 text-green-700' :
                             'bg-gray-100 text-gray-500'
          }`}>
            {current > s.n ? '✓' : s.n}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-0.5 ${current > s.n ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewPrescriptionPage() {
  const params   = useParams()
  const router   = useRouter()
  const clientId = params.id as string

  const [step, setStep]             = useState<Step>(1)
  const [runs, setRuns]             = useState<DiagnosticRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [isLoadingRuns, setIsLoadingRuns] = useState(true)

  // Intake form state
  const [businessGoal, setBusinessGoal]   = useState('')
  const [urgency, setUrgency]             = useState<PrescriptionIntake['timeline_urgency']>('short_term')
  const [budget, setBudget]               = useState<number>(3000)
  const [priorityDims, setPriorityDims]   = useState<DiagnosticDimension[]>([])
  const [notes, setNotes]                 = useState('')

  // Generation state
  const [isGenerating, setIsGenerating]   = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null)
  const [content, setContent]             = useState<PrescriptionContent | null>(null)

  // Approval state
  const [isApproving, setIsApproving]     = useState(false)
  const [approveError, setApproveError]   = useState<string | null>(null)

  // ── Step 1: Load completed diagnostic runs ────────────────────────────────
  useEffect(() => {
    void fetchRuns()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const fetchRuns = useCallback(async () => {
    setIsLoadingRuns(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/diagnostic/runs?status=completed`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (!res.ok) return
      const data = await res.json() as { runs: DiagnosticRun[] }
      const completed = data.runs ?? []
      setRuns(completed)
      if (completed.length > 0) setSelectedRunId(completed[0].id)
    } finally {
      setIsLoadingRuns(false)
    }
  }, [clientId])

  // ── Step 3: Generate prescription ────────────────────────────────────────
  const handleGenerate = async () => {
    setIsGenerating(true)
    setGenerateError(null)
    try {
      const intake: PrescriptionIntake = {
        business_goal:       businessGoal,
        timeline_urgency:    urgency,
        monthly_budget_aud:  budget,
        priority_dimensions: priorityDims,
        notes:               notes || null,
      }
      const res = await fetch(`/api/clients/${clientId}/prescription/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify({ run_id: selectedRunId, intake }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { prescription_id: string; content: PrescriptionContent }
      setPrescriptionId(data.prescription_id)
      setContent(data.content)
      setStep(4)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : '处方生成失败')
    } finally {
      setIsGenerating(false)
    }
  }

  // ── Step 4: Approve prescription ─────────────────────────────────────────
  const handleApprove = async () => {
    if (!prescriptionId) return
    setIsApproving(true)
    setApproveError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify({ status: 'approved' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push(`/dashboard/clients/${clientId}/execution`)
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : '批准失败')
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    if (!prescriptionId) return
    await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body:    JSON.stringify({ status: 'rejected', rejection_note: '用户要求重新生成' }),
    })
    setStep(2)
    setContent(null)
    setPrescriptionId(null)
  }

  const toggleDimension = (dim: DiagnosticDimension) => {
    setPriorityDims(prev =>
      prev.includes(dim) ? prev.filter(d => d !== dim) : [...prev, dim]
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-lg font-semibold text-gray-900">生成处方</h1>
          <p className="text-xs text-gray-400 mt-0.5">基于诊断结果，由 Strategy Engine 生成三阶段营销处方</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <StepIndicator current={step} />

        {/* ── Step 1: 选择诊断快照 ──────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">选择诊断快照</h2>
            <p className="text-sm text-gray-500">选择用于生成处方的诊断运行记录（默认使用最新完成的运行）。</p>

            {isLoadingRuns ? (
              <div className="animate-pulse space-y-2">
                {[1, 2].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                尚无完成的诊断运行。请先在
                <a href={`/dashboard/clients/${clientId}/diagnostic`} className="underline mx-1">诊断页面</a>
                运行诊断。
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map(run => (
                  <label
                    key={run.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedRunId === run.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="run_id"
                      value={run.id}
                      checked={selectedRunId === run.id}
                      onChange={() => setSelectedRunId(run.id)}
                      className="text-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        综合得分：{run.overall_score ?? '—'}/100
                      </div>
                      <div className="text-xs text-gray-400">
                        {run.completed_at
                          ? new Date(run.completed_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })
                          : '时间未知'}
                        &nbsp;·&nbsp;{run.findings_count} 条发现
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                      已完成
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!selectedRunId}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Intake Form ───────────────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="font-semibold text-gray-900">填写业务意向</h2>

            {/* Business goal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                业务目标 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={businessGoal}
                onChange={e => setBusinessGoal(e.target.value)}
                rows={3}
                placeholder="例：在 6 个月内将新西兰新客户增长 30%，主攻 SEO 和 AI 可见度"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Timeline urgency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                时间紧迫度 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {URGENCY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors ${
                      urgency === opt.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Monthly budget */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                月度预算（AUD）<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">AUD $</span>
                <input
                  type="number"
                  min={500}
                  max={50000}
                  step={500}
                  value={budget}
                  onChange={e => setBudget(Number(e.target.value))}
                  className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-xs text-gray-400">/月</span>
              </div>
            </div>

            {/* Priority dimensions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                优先维度（可多选，留空表示全部）
              </label>
              <div className="flex flex-wrap gap-2">
                {DIMENSION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDimension(opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      priorityDims.includes(opt.value)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                补充说明（可选）
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="例：目前已有博客团队，希望处方聚焦自动化工具"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← 返回
              </button>
              <button
                onClick={() => { setStep(3); void handleGenerate() }}
                disabled={!businessGoal.trim() || budget <= 0}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                生成处方
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: 生成中 ────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
            <div className="animate-spin w-10 h-10 border-4 border-indigo-400 border-t-transparent rounded-full mx-auto" />
            <h2 className="font-semibold text-gray-900">Strategy Engine 正在分析…</h2>
            <p className="text-sm text-gray-500">
              正在基于诊断数据和业务目标，生成个性化三阶段处方。通常需要 15–30 秒。
            </p>
            {generateError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {generateError}
                <button onClick={() => setStep(2)} className="ml-2 underline">返回修改</button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: 处方审阅 ──────────────────────────────────────────── */}
        {step === 4 && content && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">处方摘要</h2>
              <p className="text-sm text-gray-600">{content.summary}</p>
            </div>

            {/* Budget allocation */}
            {content.budget_allocation.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">预算分配</h3>
                <div className="space-y-2">
                  {content.budget_allocation.map(b => (
                    <div key={b.dimension} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-gray-500">{b.dimension}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full"
                          style={{ width: `${b.percentage}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-20 text-right">
                        AUD ${b.amount_aud} ({b.percentage}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Phases */}
            {content.phases.map(phase => (
              <div key={phase.phase_number} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                    {phase.phase_number}
                  </span>
                  <div>
                    <h3 className="font-semibold text-gray-900">{phase.name}</h3>
                    <p className="text-xs text-gray-400">{phase.duration_weeks} 周</p>
                  </div>
                </div>
                <div className="space-y-2 pl-10">
                  {phase.actions.map(action => (
                    <div key={action.id} className="flex items-start gap-2">
                      <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-medium ${
                        action.fix_type === 'me_auto'     ? 'bg-blue-100 text-blue-700' :
                        action.fix_type === 'fde_manual'  ? 'bg-purple-100 text-purple-700' :
                                                            'bg-gray-100 text-gray-600'
                      }`}>
                        {action.fix_type === 'me_auto' ? 'ME' : action.fix_type === 'fde_manual' ? 'FDE' : '第三方'}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{action.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{action.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* KPI targets */}
            {content.kpi_targets.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">KPI 目标</h3>
                <div className="space-y-2">
                  {content.kpi_targets.map((kpi, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{kpi.metric}</span>
                      <span className="font-medium text-indigo-700">
                        {kpi.current_value != null ? `${kpi.current_value} → ` : ''}{kpi.target_value} {kpi.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approval buttons */}
            {approveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {approveError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => void handleReject()}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                要求修改
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={isApproving}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isApproving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    处理中…
                  </span>
                ) : '✓ 批准并生成执行计划'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
