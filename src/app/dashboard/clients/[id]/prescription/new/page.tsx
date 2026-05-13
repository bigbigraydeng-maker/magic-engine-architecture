'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PrescriptionContent, PrescriptionIntake, DiagnosticDimension, PrescriptionAction } from '@/types/diagnostic'
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types'
import type { SelfGrade, HuatuoGenerationMeta, TrendSummaryLite } from '@/lib/huatuo/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

const URGENCY_OPTIONS: Array<{ value: PrescriptionIntake['timeline_urgency']; label: string; desc: string }> = [
  { value: 'immediate',  label: '⚡ 即刻',   desc: '1–2 周内启动' },
  { value: 'short_term', label: '📅 短期',   desc: '1–3 个月' },
  { value: 'long_term',  label: '🗓️ 长期',  desc: '3–6 个月' },
]

const DIMENSION_OPTIONS: Array<{ value: DiagnosticDimension; label: string }> = [
  { value: 'seo',           label: 'SEO' },
  { value: 'ai_visibility', label: 'AI 可见度' },
  { value: 'social',        label: '社媒' },
  { value: 'reputation',    label: '口碑' },
  { value: 'competitor',    label: '竞品' },
  { value: 'ads',           label: '广告' },
]

const CRISIS_COLOR: Record<string, string> = {
  'TYPE_E 声誉陷阱': 'bg-red-50 border-red-200 text-red-800',
  'TYPE_D 数字缺失': 'bg-orange-50 border-orange-200 text-orange-800',
  'TYPE_B 社媒空洞': 'bg-yellow-50 border-yellow-200 text-yellow-800',
  'TYPE_A AI不可见': 'bg-purple-50 border-purple-200 text-purple-800',
}

type Step = 1 | 2 | 3

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: '填写意向' },
    { n: 2, label: '生成处方' },
    { n: 3, label: '审阅批准' },
  ]
  return (
    <div className="flex items-center gap-0 mb-6">
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

function ScoreChip({ label, value }: { label: string; value: number }) {
  const color = value >= 60 ? 'bg-green-100 text-green-700' :
                value >= 40 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {label} {value}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewPrescriptionPage() {
  const params   = useParams()
  const router   = useRouter()
  const clientId = params.id as string

  // Discovery source (Zhangqian)
  const [discovery, setDiscovery]             = useState<ClientDiscoveryRow | null>(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryId, setDiscoveryId]         = useState<string | null>(null)

  const [step, setStep] = useState<Step>(1)

  // Intake form state
  const [businessGoal, setBusinessGoal]     = useState('')
  const [urgency, setUrgency]               = useState<PrescriptionIntake['timeline_urgency']>('short_term')
  const [budget, setBudget]                 = useState<number>(3000)
  const [priorityDims, setPriorityDims]     = useState<DiagnosticDimension[]>([])
  const [notes, setNotes]                   = useState('')

  // Generation state
  const [isGenerating, setIsGenerating]       = useState(false)
  const [generateError, setGenerateError]     = useState<string | null>(null)
  const [prescriptionId, setPrescriptionId]   = useState<string | null>(null)
  const [content, setContent]                 = useState<PrescriptionContent | null>(null)
  const [selfGrade, setSelfGrade]             = useState<SelfGrade | null>(null)
  const [genMeta, setGenMeta]                 = useState<HuatuoGenerationMeta | null>(null)
  const [trendSummary, setTrendSummary]       = useState<TrendSummaryLite | null>(null)

  // Approval state
  const [isApproving, setIsApproving]   = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  // Refine state (P8.10.S3 让华佗精修)
  const [isRefining, setIsRefining]     = useState(false)
  const [refineError, setRefineError]   = useState<string | null>(null)

  // ── Load Zhangqian discovery on mount ─────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setDiscoveryLoading(true)
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        })
        if (!res.ok) return
        const data = await res.json() as { success: boolean; discovery: ClientDiscoveryRow }
        if (data.success && data.discovery?.confirmed_at) {
          setDiscovery(data.discovery)
          setDiscoveryId(data.discovery.id)
          // Pre-fill crisis type as a note hint
          const crisis = data.discovery.payload?.diagnosis?.crisis_type
          if (crisis) {
            setNotes(`诊断危机类型：${crisis}`)
          }
        }
      } finally {
        setDiscoveryLoading(false)
      }
    })()
  }, [clientId])

  // ── Generate prescription ─────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
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
      const body = discoveryId
        ? { discovery_id: discoveryId, intake }
        : { intake }          // fallback (no source — will 400, but shouldn't reach here)

      const res = await fetch(`/api/clients/${clientId}/prescription/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        // 把后端真实错误消息显示出来
        let errText = `HTTP ${res.status}`
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody?.error) errText = `${errText} — ${errBody.error}`
        } catch {/* response 不是 JSON 时忽略 */}
        throw new Error(errText)
      }
      const data = await res.json() as {
        prescription_id: string
        content: PrescriptionContent
        self_grade?: SelfGrade
        meta?: HuatuoGenerationMeta
        trend_summary?: TrendSummaryLite | null
      }
      setPrescriptionId(data.prescription_id)
      setContent(data.content)
      setSelfGrade(data.self_grade ?? null)
      setGenMeta(data.meta ?? null)
      setTrendSummary(data.trend_summary ?? null)
      setStep(3)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : '处方生成失败')
      setStep(1) // back to form on error
    } finally {
      setIsGenerating(false)
    }
  }, [businessGoal, urgency, budget, priorityDims, notes, discoveryId, clientId])

  // ── Approve prescription ──────────────────────────────────────────────────
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

  const handleRefine = async () => {
    if (!prescriptionId) return
    setIsRefining(true)
    setRefineError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        let errText = `HTTP ${res.status}`
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody?.error) errText = `${errText} — ${errBody.error}`
        } catch {/* ignore */}
        throw new Error(errText)
      }
      const data = await res.json() as {
        content: PrescriptionContent
        self_grade?: SelfGrade
        meta?: HuatuoGenerationMeta
        trend_summary?: TrendSummaryLite | null
      }
      // 用新结果替换本地状态
      setContent(data.content)
      setSelfGrade(data.self_grade ?? null)
      setGenMeta(data.meta ?? null)
      if (data.trend_summary !== undefined) setTrendSummary(data.trend_summary ?? null)
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : '精修失败')
    } finally {
      setIsRefining(false)
    }
  }

  const handleReject = async () => {
    if (!prescriptionId) return
    await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body:    JSON.stringify({ status: 'rejected', rejection_note: '用户要求重新生成' }),
    })
    setStep(1)
    setContent(null)
    setPrescriptionId(null)
  }

  const toggleDimension = (dim: DiagnosticDimension) => {
    setPriorityDims(prev =>
      prev.includes(dim) ? prev.filter(d => d !== dim) : [...prev, dim]
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">生成处方</h1>
            <p className="text-xs text-gray-400 mt-0.5">基于品牌健康发现，由 Strategy Engine 生成三阶段营销方案</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <StepIndicator current={step} />

        {/* ── Discovery Context Card (always visible when confirmed) ────── */}
        {!discoveryLoading && discovery && (
          <DiscoveryContextCard discovery={discovery} />
        )}

        {/* ── No discovery warning ──────────────────────────────────────── */}
        {!discoveryLoading && !discovery && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">⚠️ 尚无确认的发现报告</p>
            <p className="text-xs">
              建议先运行
              <Link href={`/dashboard/clients/${clientId}/zhangqian`} className="underline mx-1">
                张骞发现
              </Link>
              再生成处方，以获得最精准的诊断依据。
            </p>
          </div>
        )}

        {/* ── Step 1: Intent Form ────────────────────────────────────────── */}
        {step === 1 && (
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
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      urgency === opt.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
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

            {generateError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {generateError}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => { setStep(2); void handleGenerate() }}
                disabled={!businessGoal.trim() || budget <= 0}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                生成处方 →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: 生成中 ──────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
            <div className="animate-spin w-10 h-10 border-4 border-indigo-400 border-t-transparent rounded-full mx-auto" />
            <h2 className="font-semibold text-gray-900">Strategy Engine 正在分析…</h2>
            <p className="text-sm text-gray-500">
              正在基于品牌健康数据和业务目标，生成个性化三阶段处方。通常需要 15–30 秒。
            </p>
            {isGenerating && (
              <p className="text-xs text-gray-400">请勿关闭此页面</p>
            )}
          </div>
        )}

        {/* ── Step 3: 处方审阅 ─────────────────────────────────────────────── */}
        {step === 3 && content && (
          <div className="space-y-4">
            {/* 华佗自评卡 — 仅当存在 self_grade 时显示 */}
            {selfGrade && genMeta && (
              <HuatuoMetaCard
                selfGrade={selfGrade}
                meta={genMeta}
                onRefine={selfGrade.weaknesses.length > 0 ? handleRefine : undefined}
                isRefining={isRefining}
                refineError={refineError}
              />
            )}

            {/* 历史趋势卡 — 让用户看到 target_value 是基于真实历史锚定 */}
            {trendSummary && trendSummary.has_data && (
              <TrendCard summary={trendSummary} />
            )}

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
                      <span className="text-xs font-medium text-gray-700 w-24 text-right">
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
                <div className="space-y-3 pl-10">
                  {phase.actions.map(action => (
                    <ActionRow key={action.id} action={action} />
                  ))}
                </div>
              </div>
            ))}

            {/* KPI targets — 含 realism_confidence 和 timeframe */}
            {content.kpi_targets.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  KPI 目标
                  <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
                    （绿/黄/红 = 现实性置信度）
                  </span>
                </h3>
                <div className="space-y-2.5">
                  {content.kpi_targets.map((kpi, i) => {
                    const conf = kpi.realism_confidence
                    const confDot =
                      conf == null ? 'bg-gray-300' :
                      conf >= 0.7  ? 'bg-green-400' :
                      conf >= 0.4  ? 'bg-yellow-400' :
                                     'bg-red-400'
                    return (
                      <div key={i} className="flex items-start gap-2.5">
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${confDot}`}
                          title={conf != null ? `现实性置信度 ${(conf * 100).toFixed(0)}%` : '无置信度数据'}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm text-gray-800">{kpi.metric}</span>
                            <span className="text-sm font-medium text-indigo-700 shrink-0 tabular-nums">
                              {kpi.current_value != null ? `${kpi.current_value} → ` : ''}
                              <strong>{kpi.target_value}</strong> {kpi.unit}
                            </span>
                          </div>
                          {kpi.timeframe && (
                            <p className="text-xs text-gray-400 mt-0.5">⏱ {kpi.timeframe}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
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

// ---------------------------------------------------------------------------
// 华佗 自评卡 — 显示在审阅页顶部，让 FDE 一眼看到处方质量
// ---------------------------------------------------------------------------

const GRADE_LABELS: Record<keyof SelfGrade['dimensions'], string> = {
  realism:          '现实性',
  completeness:     '完整性',
  fde_actionability:'FDE可执行性',
  roi_alignment:    'ROI合理性',
  prioritization:   '优先级',
  resource_match:   '资源匹配',
  innovation:       '创新性',
}

function HuatuoMetaCard({
  selfGrade,
  meta,
  onRefine,
  isRefining,
  refineError,
}: {
  selfGrade: SelfGrade
  meta: HuatuoGenerationMeta
  onRefine?: () => void
  isRefining?: boolean
  refineError?: string | null
}) {
  const overall = selfGrade.overall
  const gradeColor =
    overall >= 8 ? 'text-green-700 bg-green-50 border-green-200' :
    overall >= 6 ? 'text-amber-700 bg-amber-50 border-amber-200' :
                   'text-red-700 bg-red-50 border-red-200'
  const gradeLabel =
    overall >= 8 ? '高质量' :
    overall >= 6 ? '可接受' :
                   '需注意'

  // 已经精修过（passes >= 2）就不再显示精修按钮
  const canRefine = Boolean(onRefine) && meta.passes < 2 && overall < 9

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`px-3 py-1.5 rounded-lg border font-bold text-lg tabular-nums shrink-0 ${gradeColor}`}>
            {overall.toFixed(1)} / 10
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              华佗自评：{gradeLabel}
              {meta.passes >= 2 && (
                <span className="ml-2 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  ✓ 已精修
                </span>
              )}
            </p>
            <p className="text-xs text-gray-400">
              {meta.passes === 1 ? '一次过关' : `经过 ${meta.passes} 轮精修`}
              {' · '}
              ${meta.cost_usd.toFixed(3)}
              {' · '}
              {(meta.duration_ms / 1000).toFixed(1)}s
              {meta.industry_category_used && ` · 行业 ${meta.industry_category_used}`}
            </p>
          </div>
        </div>

        {/* 精修按钮 — 仅当有 onRefine 回调、未精修过、分数未满 9 时显示 */}
        {canRefine && (
          <button
            onClick={onRefine}
            disabled={isRefining}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="基于华佗自检指出的薄弱点，让华佗针对性修改处方（约 90s）"
          >
            {isRefining ? (
              <>
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-indigo-300 border-t-transparent rounded-full" />
                精修中…
              </>
            ) : (
              <>🔄 让华佗精修一次</>
            )}
          </button>
        )}
      </div>

      {refineError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          精修失败：{refineError}
        </div>
      )}

      {/* 7 维评分网格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
        {(Object.keys(GRADE_LABELS) as Array<keyof typeof GRADE_LABELS>).map(key => {
          const v = selfGrade.dimensions[key] ?? 0
          const color =
            v >= 8 ? 'bg-green-100 text-green-700' :
            v >= 6 ? 'bg-amber-100 text-amber-700' :
                     'bg-red-100 text-red-700'
          return (
            <div key={key} className={`rounded-md px-2 py-1.5 text-center ${color}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-75">{GRADE_LABELS[key]}</div>
              <div className="text-sm font-bold tabular-nums">{v}</div>
            </div>
          )
        })}
      </div>

      {/* 薄弱点 */}
      {selfGrade.weaknesses && selfGrade.weaknesses.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            华佗指出的薄弱点
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            {selfGrade.weaknesses.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-amber-500 shrink-0">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 精修说明 */}
      {selfGrade.improvements_made && selfGrade.improvements_made.length > 0 && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            本轮针对性修复
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            {selfGrade.improvements_made.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-green-500 shrink-0">✓</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TrendCard — SEMrush 12 月历史趋势（华佗 P8.10.S3.2 真实数据锚点）
// ---------------------------------------------------------------------------

const TRAJECTORY_STYLE: Record<TrendSummaryLite['trajectory'], { icon: string; label: string; cls: string }> = {
  rising:    { icon: '📈', label: '上升',  cls: 'bg-green-50 border-green-200 text-green-800' },
  flat:      { icon: '➡️', label: '平稳',  cls: 'bg-gray-50 border-gray-200 text-gray-700' },
  declining: { icon: '📉', label: '下降',  cls: 'bg-red-50 border-red-200 text-red-800' },
  no_data:   { icon: '—',  label: '无数据', cls: 'bg-gray-50 border-gray-200 text-gray-500' },
}

function TrendCard({ summary }: { summary: TrendSummaryLite }) {
  const tj = TRAJECTORY_STYLE[summary.trajectory]
  const growthCells: Array<{ label: string; value: number | null }> = [
    { label: '近 3 月',  value: summary.growth_pct_3m },
    { label: '近 6 月',  value: summary.growth_pct_6m },
    { label: '12 月首尾', value: summary.growth_pct_12m },
  ]

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            SEMrush 历史流量趋势
          </p>
          <p className="text-xs text-gray-400">
            过去 {summary.data_points} 个月 · 华佗已用作 KPI 锚点
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold border rounded-full px-2.5 py-1 ${tj.cls}`}>
          {tj.icon} {tj.label}
        </span>
      </div>

      {/* 关键指标行 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <MetricCell
          label={`最近月（${summary.latest?.month ?? ''}）`}
          value={summary.latest?.organic_traffic.toLocaleString() ?? '—'}
          unit="次/月有机流量"
        />
        <MetricCell
          label="月均流量"
          value={summary.monthly_avg_traffic?.toLocaleString() ?? '—'}
          unit="次/月"
        />
        <MetricCell
          label={`最早月（${summary.earliest?.month ?? ''}）`}
          value={summary.earliest?.organic_traffic.toLocaleString() ?? '—'}
          unit="次/月"
        />
        <MetricCell
          label="最近关键词数"
          value={summary.latest?.organic_keywords.toLocaleString() ?? '—'}
          unit="个"
        />
      </div>

      {/* 增长率 chip 行 */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-500">实际增长率：</span>
        {growthCells.map(c => {
          const v = c.value
          const cls =
            v == null  ? 'bg-gray-100 text-gray-500' :
            v >= 10    ? 'bg-green-100 text-green-700' :
            v <= -10   ? 'bg-red-100 text-red-700' :
                         'bg-amber-100 text-amber-700'
          return (
            <span key={c.label} className={`text-xs font-medium rounded-full px-2.5 py-0.5 tabular-nums ${cls}`}>
              {c.label} {v == null ? '数据不足' : `${v >= 0 ? '+' : ''}${v}%`}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function MetricCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</div>
      <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{unit}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionRow — 一个 action 的丰富展示（含 FDE 字段）
// ---------------------------------------------------------------------------

const MODULE_LABEL: Record<string, string> = {
  seo_engine:        'SEO引擎',
  social_matrix:     '社媒矩阵',
  ads_intelligence:  '广告',
  insight_reports:   '数据报告',
  manual:            '手工执行',
}

function ActionRow({ action }: { action: PrescriptionAction }) {
  const fixTypeBadge =
    action.fix_type === 'me_auto'    ? { label: 'ME', cls: 'bg-blue-100 text-blue-700' } :
    action.fix_type === 'fde_manual' ? { label: 'FDE', cls: 'bg-purple-100 text-purple-700' } :
                                       { label: '第三方', cls: 'bg-gray-100 text-gray-600' }

  const impactDot =
    action.impact === 'high'   ? 'bg-green-500' :
    action.impact === 'medium' ? 'bg-amber-500' :
                                 'bg-gray-300'

  return (
    <div className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-medium shrink-0 ${fixTypeBadge.cls}`}>
          {fixTypeBadge.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900">{action.title}</p>
            <span className={`w-1.5 h-1.5 rounded-full ${impactDot}`} title={`影响：${action.impact}`} />
            {action.module && (
              <span className="text-[10px] uppercase tracking-wide text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                {MODULE_LABEL[action.module] ?? action.module}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{action.description}</p>
        </div>
      </div>

      {/* FDE 元数据行 */}
      {(action.estimated_hours != null || action.required_skills?.length || action.measurement_method) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 pl-8 pt-1.5 border-t border-gray-50">
          {action.estimated_hours != null && (
            <span>⏱ <strong className="text-gray-700">{action.estimated_hours}h</strong></span>
          )}
          {action.required_skills && action.required_skills.length > 0 && (
            <span>🛠 {action.required_skills.join(' / ')}</span>
          )}
          {action.measurement_method && (
            <span title={action.measurement_method} className="truncate max-w-[300px]">
              📏 {action.measurement_method}
            </span>
          )}
          {action.dependencies && action.dependencies.length > 0 && (
            <span className="text-amber-600">↳ 依赖 {action.dependencies.length} 项</span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discovery Context Card (shown above the form when Zhangqian data exists)
// ---------------------------------------------------------------------------

function DiscoveryContextCard({ discovery }: { discovery: ClientDiscoveryRow }) {
  const diag = discovery.payload?.diagnosis
  const scores = diag?.scores
  const crisisType = diag?.crisis_type ?? null
  const crisisCls = crisisType ? CRISIS_COLOR[crisisType] : null

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">诊断依据 — 张骞发现</p>
          <p className="text-sm text-gray-700 font-medium">{discovery.payload?.business?.name ?? discovery.domain}</p>
          {diag?.key_finding && (
            <p className="text-xs text-gray-500 mt-0.5">{diag.key_finding}</p>
          )}
        </div>
        {crisisType && crisisCls && (
          <span className={`shrink-0 text-xs font-semibold border rounded-full px-2.5 py-1 ${crisisCls}`}>
            {crisisType.split(' ')[1] ?? crisisType}
          </span>
        )}
      </div>
      {scores && (
        <div className="flex flex-wrap gap-1.5">
          <ScoreChip label="SEO" value={scores.seo} />
          <ScoreChip label="社媒" value={scores.social} />
          <ScoreChip label="口碑" value={scores.reputation} />
          <ScoreChip label="AI可见" value={scores.ai_visibility} />
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-700">
            综合 {scores.overall}
          </span>
        </div>
      )}
    </div>
  )
}
