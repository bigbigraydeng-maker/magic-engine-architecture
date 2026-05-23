'use client'

import { useState, useMemo, useEffect } from 'react'

// ─── Types (subset of ViralReference used by this panel) ─────────────────────

type ContentGoal = 'brand' | 'sales' | 'ugc' | 'education'

interface StyleScores {
  energy: number
  luxury: number
  authenticity: number
  emotional: number
  humor: number
  urgency: number
  offer_signal: number
}

export interface ViralReferenceForInsights {
  id: string
  industry: string
  content_goal: ContentGoal
  is_our_video: boolean
  is_learnable: boolean
  analysis_status: string
  style_scores: StyleScores | null
  style_tags: string[] | null
  style_description: string | null
  persona_fit: string[] | null
  key_techniques: string[] | null
  view_count: number | null
  video_title: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function freqMap(items: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1)
  return m
}

function sortedEntries(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const SCORE_LABELS: Record<keyof StyleScores, string> = {
  energy:       'Energy 能量感',
  luxury:       'Luxury 高端感',
  authenticity: 'Authentic 真实感',
  emotional:    'Emotional 情感',
  humor:        'Humor 趣味',
  urgency:      'Urgency 紧迫感',
  offer_signal: 'Offer 产品感',
}

const SCORE_COLORS: Record<keyof StyleScores, string> = {
  energy:       'bg-orange-500',
  luxury:       'bg-purple-500',
  authenticity: 'bg-green-500',
  emotional:    'bg-pink-500',
  humor:        'bg-yellow-500',
  urgency:      'bg-red-500',
  offer_signal: 'bg-blue-500',
}

const GOAL_META: Record<ContentGoal, { label: string; emoji: string }> = {
  brand:     { label: 'Brand',     emoji: '🎨' },
  sales:     { label: 'Sales',     emoji: '💰' },
  ugc:       { label: 'UGC',       emoji: '📱' },
  education: { label: 'Education', emoji: '🎓' },
}

const DIM_ZH: Record<keyof StyleScores, string> = {
  energy:       '高能量剪辑',
  luxury:       '高端制作感',
  authenticity: '真实感/UGC风',
  emotional:    '情感共鸣',
  humor:        '轻松幽默',
  urgency:      '紧迫感/限时',
  offer_signal: '产品/服务展示',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ dim, value }: { dim: keyof StyleScores; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-36 shrink-0">{SCORE_LABELS[dim]}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
        <div
          className={`${SCORE_COLORS[dim]} h-1.5 rounded-full transition-all`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-xs text-gray-300 w-6 text-right font-mono">{value.toFixed(1)}</span>
    </div>
  )
}

// ─── Narrative builder ────────────────────────────────────────────────────────

function buildNarrative(
  pool: ViralReferenceForInsights[],
  avg: StyleScores,
  topTechs: [string, number][],
  topPersonas: [string, number][],
  industry: string,
): string {
  const n = pool.length
  const industryLabel = industry === 'travel' ? '旅游' : industry === 'flooring' ? '地板' : industry

  const withViews = pool.filter(r => r.view_count)
  const avgViews = withViews.length
    ? Math.round(withViews.reduce((s, r) => s + (r.view_count ?? 0), 0) / withViews.length)
    : 0

  const sortedDims = (Object.entries(avg) as [keyof StyleScores, number][])
    .sort((a, b) => b[1] - a[1])
  const top1 = sortedDims[0]
  const top2 = sortedDims[1]

  let text = `分析了 ${n} 条${industryLabel}行业爆款视频`
  if (avgViews > 0) text += `（平均播放 ${fmtViews(avgViews)}）`
  text += `：`

  text += `核心风格特征是「${DIM_ZH[top1[0]]}」（均分 ${top1[1].toFixed(1)}/10）`
  if (top2[1] >= 5.0) {
    text += ` 搭配「${DIM_ZH[top2[0]]}」（均分 ${top2[1].toFixed(1)}/10）`
  }
  text += `。`

  if (topTechs.length > 0) {
    const techStr = topTechs.slice(0, 3).map(([t]) => t).join('、')
    text += ` 最高频拍摄技法：${techStr}。`
  }

  if (topPersonas.length > 0) {
    text += ` 主要面向「${topPersonas[0][0]}」受众群体。`
  }

  text += ` 以上规律已自动融入 Reel 生成引擎，每次生成内容时系统会匹配最相关的爆款风格。`
  return text
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  // Accepts full ViralReference objects — TypeScript structural typing handles the superset
  refs: ViralReferenceForInsights[]
}

export function InsightsPanel({ refs }: Props) {
  const industries = useMemo(() => {
    const s = new Set(
      refs
        .filter(r => r.analysis_status === 'done' && r.is_learnable && !r.is_our_video)
        .map(r => r.industry)
    )
    return [...s]
  }, [refs])

  const [industry, setIndustry] = useState<string>('travel')
  const [open, setOpen] = useState(true)

  // Sync to first available industry when data loads
  useEffect(() => {
    if (industries.length > 0 && !industries.includes(industry)) {
      setIndustry(industries[0])
    }
  }, [industries, industry])

  const pool = useMemo(() =>
    refs
      .filter(r =>
        r.analysis_status === 'done' &&
        r.is_learnable &&
        !r.is_our_video &&
        r.style_scores &&
        r.industry === industry
      )
      .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)),
    [refs, industry]
  )

  const insights = useMemo(() => {
    if (pool.length < 2) return null

    // Average style scores
    const sum: StyleScores = { energy: 0, luxury: 0, authenticity: 0, emotional: 0, humor: 0, urgency: 0, offer_signal: 0 }
    for (const r of pool) {
      const s = r.style_scores!
      for (const k of Object.keys(sum) as (keyof StyleScores)[]) sum[k] += s[k]
    }
    const n = pool.length
    const avg: StyleScores = {
      energy:       sum.energy       / n,
      luxury:       sum.luxury       / n,
      authenticity: sum.authenticity / n,
      emotional:    sum.emotional    / n,
      humor:        sum.humor        / n,
      urgency:      sum.urgency      / n,
      offer_signal: sum.offer_signal / n,
    }

    // Frequency maps
    const techFreq    = freqMap(pool.flatMap(r => r.key_techniques ?? []))
    const tagFreq     = freqMap(pool.flatMap(r => r.style_tags ?? []))
    const goalFreq    = freqMap(pool.map(r => r.content_goal))
    const personaFreq = freqMap(pool.flatMap(r => r.persona_fit ?? []))

    const topTechs     = sortedEntries(techFreq).slice(0, 6)
    const topTags      = sortedEntries(tagFreq).slice(0, 12)
    const topPersonas  = sortedEntries(personaFreq).slice(0, 4)
    const goalDist     = sortedEntries(goalFreq)
    const topPerformers = pool.filter(r => r.view_count).slice(0, 3)

    const narrative = buildNarrative(pool, avg, topTechs, topPersonas, industry)

    return { avg, topTechs, topTags, topPersonas, goalDist, topPerformers, narrative }
  }, [pool, industry])

  if (industries.length === 0) return null

  const industryLabel = (ind: string) =>
    ind === 'travel' ? '✈️ Travel' : ind === 'flooring' ? '🪵 Flooring' : ind

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity"
        >
          <span className="text-base">📊</span>
          <div>
            <p className="text-sm font-semibold text-white">AI 洞察报告</p>
            <p className="text-xs text-gray-400">
              爆款规律分析 · 可向客户展示
              {insights && <span className="text-indigo-400"> · 基于 {pool.length} 条视频</span>}
            </p>
          </div>
          <span className="text-gray-500 text-xs ml-2">{open ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {/* Industry toggle */}
        {industries.length > 1 && (
          <div className="flex gap-1.5 shrink-0 ml-4">
            {industries.map(ind => (
              <button
                key={ind}
                onClick={() => setIndustry(ind)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  industry === ind
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                {industryLabel(ind)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-gray-700 p-5 space-y-6">
          {!insights ? (
            <p className="text-sm text-gray-500 text-center py-4">
              需要至少 2 条已分析的可学习视频才能生成洞察报告
            </p>
          ) : (
            <>
              {/* Narrative summary */}
              <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-lg p-4">
                <p className="text-[11px] font-semibold text-indigo-300 uppercase tracking-widest mb-2">
                  💡 核心洞察
                </p>
                <p className="text-sm text-gray-100 leading-relaxed">{insights.narrative}</p>
              </div>

              {/* Viral DNA + Techniques */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Left: 7-dim DNA */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    🧬 爆款视频风格 DNA
                  </p>
                  <div className="space-y-2.5">
                    {(Object.keys(insights.avg) as (keyof StyleScores)[]).map(dim => (
                      <ScoreBar key={dim} dim={dim} value={insights.avg[dim]} />
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-600 mt-3">
                    {pool.length} 条视频平均分 · 最高 10 分
                  </p>
                </div>

                {/* Right: Techniques + Tags */}
                <div className="space-y-5">
                  {insights.topTechs.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                        🎬 高频拍摄技法
                      </p>
                      <div className="space-y-1.5">
                        {insights.topTechs.map(([tech, count]) => (
                          <div key={tech} className="flex items-center gap-2">
                            <span className="flex-1 text-xs text-gray-300">{tech}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div
                                className="h-1.5 bg-indigo-500 rounded-full"
                                style={{ width: `${Math.round((count / insights.topTechs[0][1]) * 52)}px` }}
                              />
                              <span className="text-[10px] text-gray-500 w-3 text-right">{count}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {insights.topTags.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                        🏷️ 风格标签
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {insights.topTags.map(([tag, count]) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 cursor-default"
                            title={`出现在 ${count} 条视频`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Goal distribution + Persona */}
              <div className="grid grid-cols-2 gap-6">

                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    🎯 内容类型分布
                  </p>
                  <div className="space-y-2">
                    {insights.goalDist.map(([goal, count]) => {
                      const meta = GOAL_META[goal as ContentGoal]
                      const pct  = Math.round((count / pool.length) * 100)
                      return (
                        <div key={goal} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-24 shrink-0">
                            {meta?.emoji} {meta?.label}
                          </span>
                          <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                            <div
                              className="bg-indigo-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-8 text-right font-mono">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    👥 目标受众画像
                  </p>
                  <div className="space-y-2">
                    {insights.topPersonas.map(([persona, count]) => {
                      const pct = Math.round((count / pool.length) * 100)
                      return (
                        <div key={persona} className="flex items-center gap-2">
                          <span
                            className="text-xs text-gray-300 flex-1 truncate leading-snug"
                            title={persona}
                          >
                            {persona}
                          </span>
                          <span className="text-xs text-emerald-400 font-mono shrink-0">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Top performers */}
              {insights.topPerformers.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    🏆 播放量最高的参考视频
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {insights.topPerformers.map((r, i) => (
                      <div
                        key={r.id}
                        className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{['🥇', '🥈', '🥉'][i]}</span>
                          <span className="text-yellow-300 text-xs font-bold">
                            {fmtViews(r.view_count!)} views
                          </span>
                        </div>
                        {r.video_title && (
                          <p className="text-xs text-gray-200 line-clamp-2 leading-relaxed">
                            {r.video_title}
                          </p>
                        )}
                        {r.style_description && (
                          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                            {r.style_description}
                          </p>
                        )}
                        {r.key_techniques && r.key_techniques.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.key_techniques.slice(0, 2).map(t => (
                              <span
                                key={t}
                                className="text-[10px] px-1.5 py-0.5 bg-indigo-900/50 text-indigo-300 rounded"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
