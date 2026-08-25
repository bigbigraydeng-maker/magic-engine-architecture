'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

interface Props {
  clientId: string
  campaignId: string
}

interface AssetRef {
  id: string
  storage_url: string
  original_filename: string | null
  source: string
  ownership: string
}

interface BundleReadiness {
  master_brief_grounding: boolean
  campaign_grounding: boolean
  evidence_grounding: 'UNKNOWN'
  client_asset_provenance: boolean
  format_completeness: { post: boolean; story: boolean; reel: boolean }
  human_approval: boolean
  provider_authorization: false
  publishing_authorization: false
  performance_outcome: 'UNKNOWN'
}

interface PostImage {
  id: string
  preview_url: string
  filename: string | null
  source: string
  ownership: string
}

interface DailyBundle {
  date: string
  post: { hook: string; body: string; cta: string; image_asset_id?: string; cta_url?: string } | null
  story: { frames: Array<{ order: number; copy: string }> } | null
  reel: { brief: string; script: string; caption: string; source_asset_ids: string[]; media_status: 'NO_MEDIA' | 'DRAFT_MEDIA' | 'READY' } | null
  readiness: BundleReadiness
  provenance: AssetRef[]
  post_image: PostImage | null
}

interface DailyPlanResponse {
  success: boolean
  campaign: { id: string; title: string; offer: string | null; primary_cta: string | null } | null
  grounding: { status: 'OK' | 'NEEDS_BRIEF' | 'NEEDS_CAMPAIGN'; has_master_brief: boolean; has_campaign: boolean }
  days: Array<{ date: string; slots: { post: 'PLANNED' | 'NOT_PLANNED'; story: 'PLANNED' | 'NOT_PLANNED'; reel: 'PLANNED' | 'NOT_PLANNED' } }>
  bundles: DailyBundle[]
  publishing_plan: { destination: string | null; status: 'NOT_AUTHORIZED' }
  ad_candidate: { creative_ref: string | null; goal: string; audience: string; destination: string; budget: string; status: 'NOT_AUTHORIZED' } | null
}

const GROUNDING_LABEL: Record<DailyPlanResponse['grounding']['status'], string> = {
  OK: '✅ 已连接 Master Brief',
  NEEDS_BRIEF: '⚠️ 缺少 Master Brief（NEEDS_BRIEF）',
  NEEDS_CAMPAIGN: '⚠️ 未选定推广活动（NEEDS_CAMPAIGN）',
}

const MEDIA_STATUS_LABEL: Record<string, string> = {
  NO_MEDIA: '⬜ 暂无成片（NO_MEDIA）',
  DRAFT_MEDIA: '🟡 草稿素材（DRAFT_MEDIA）',
  READY: '✅ 可用成片（READY）',
}

function isDaySelectable(day: DailyPlanResponse['days'][number], bundleDates: Set<string>): boolean {
  return (
    day.slots.post === 'PLANNED' ||
    day.slots.story === 'PLANNED' ||
    day.slots.reel === 'PLANNED' ||
    bundleDates.has(day.date)
  )
}

export function CampaignDailyPlanPanel({ clientId, campaignId }: Props) {
  const [data, setData] = useState<DailyPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [postExpanded, setPostExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan?campaign_id=${campaignId}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? '加载失败')
      setData(json)
      // Default to the first selectable day so Ray always lands on real content when it exists.
      const bundleDates = new Set((json.bundles as DailyBundle[] | undefined)?.map(b => b.date) ?? [])
      const firstSelectable = (json.days as DailyPlanResponse['days'])?.find(day => isDaySelectable(day, bundleDates))
      setSelectedDate(firstSelectable?.date ?? json.days?.[0]?.date ?? null)
      setPostExpanded(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [clientId, campaignId])

  useEffect(() => { load() }, [load])

  const selectedBundle = useMemo(
    () => data?.bundles.find(b => b.date === selectedDate) ?? null,
    [data, selectedDate]
  )
  const bundleDates = useMemo(() => new Set(data?.bundles.map(b => b.date) ?? []), [data])

  if (loading) {
    return <p className="text-xs text-me-charcoal/45 animate-pulse py-3">加载每日计划…</p>
  }
  if (error) {
    return <p className="text-xs text-[#C2453A] py-3">✗ {error}</p>
  }
  if (!data) return null

  return (
    <div className="border border-black/[.06] rounded-xl overflow-hidden">
      <div className="bg-me-ivory px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold text-me-charcoal/75 uppercase tracking-wide">每日计划（Daily Plan）</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          data.grounding.status === 'OK' ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]' : 'bg-me-gold/20 text-me-ochre'
        }`}>
          {GROUNDING_LABEL[data.grounding.status]}
        </span>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* 7-day grid — every day with content is selectable */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">七日排期</p>
          <div className="grid grid-cols-7 gap-1.5">
            {data.days.map(day => {
              const selectable = isDaySelectable(day, bundleDates)
              const isSelected = day.date === selectedDate
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={!selectable}
                  onClick={() => { setSelectedDate(day.date); setPostExpanded(false) }}
                  className={`rounded-lg px-1.5 py-2 text-center transition-colors ${
                    isSelected
                      ? 'bg-me-ochre text-white'
                      : selectable
                        ? 'bg-me-ivory hover:bg-me-ochre/15 cursor-pointer'
                        : 'bg-me-ivory/60 cursor-not-allowed'
                  }`}
                >
                  <p className={`text-[10px] mb-1 ${isSelected ? 'text-white/85' : 'text-me-charcoal/55'}`}>{day.date.slice(5)}</p>
                  <div className="flex justify-center gap-0.5">
                    <SlotDot label="帖" planned={day.slots.post === 'PLANNED'} selected={isSelected} />
                    <SlotDot label="故" planned={day.slots.story === 'PLANNED'} selected={isSelected} />
                    <SlotDot label="片" planned={day.slots.reel === 'PLANNED'} selected={isSelected} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected day's bundle */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
            当前 Bundle{selectedDate ? ` · ${selectedDate}` : ''}
          </p>
          {!selectedBundle ? (
            <p className="text-xs text-me-charcoal/45 italic">该日暂无排定内容（NOT_PLANNED）</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <BundleCard title="📝 Post">
                {selectedBundle.post ? (
                  <>
                    {selectedBundle.post_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedBundle.post_image.preview_url}
                        alt={selectedBundle.post_image.filename ?? 'Post image'}
                        className="w-full h-32 object-cover rounded mb-2"
                      />
                    ) : (
                      <div className="w-full h-32 rounded mb-2 bg-me-ivory flex items-center justify-center">
                        <span className="text-[10px] text-me-charcoal/40 italic">未绑定 Post 图片</span>
                      </div>
                    )}
                    {selectedBundle.post_image && (
                      <p className="text-[10px] text-me-charcoal/50 mb-1 truncate">
                        {selectedBundle.post_image.filename ?? selectedBundle.post_image.id}
                        <span className="text-me-charcoal/35"> · {selectedBundle.post_image.source}</span>
                      </p>
                    )}
                    <p className="text-xs font-medium text-me-charcoal/80">{selectedBundle.post.hook}</p>
                    <p className={`text-xs text-me-charcoal/60 mt-1 ${postExpanded ? '' : 'line-clamp-3'}`}>
                      {selectedBundle.post.body}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPostExpanded(v => !v)}
                      className="text-[11px] text-me-ochre hover:underline mt-1"
                    >
                      {postExpanded ? '收起' : '展开全文'}
                    </button>
                    {selectedBundle.post.cta_url ? (
                      <a
                        href={selectedBundle.post.cta_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-me-ochre mt-1 hover:underline break-all"
                      >
                        {selectedBundle.post.cta} →{' '}
                        <span className="text-me-charcoal/45">{selectedBundle.post.cta_url}</span>
                      </a>
                    ) : (
                      <p className="text-xs text-me-charcoal/45 mt-1 italic">CTA: {selectedBundle.post.cta}（未绑定链接）</p>
                    )}
                  </>
                ) : <EmptySlot />}
              </BundleCard>

              <BundleCard title="🎬 Story">
                {selectedBundle.story ? (
                  <ol className="space-y-1">
                    {selectedBundle.story.frames.map(f => (
                      <li key={f.order} className="text-xs text-me-charcoal/70">
                        <span className="text-me-charcoal/40">#{f.order}</span> {f.copy}
                      </li>
                    ))}
                  </ol>
                ) : <EmptySlot />}
              </BundleCard>

              <BundleCard title="🎥 Reel">
                {selectedBundle.reel ? (
                  <>
                    <p className="text-xs text-me-charcoal/60 line-clamp-2">{selectedBundle.reel.brief}</p>
                    <p className="text-xs text-me-charcoal/45 mt-1 line-clamp-2 italic">{selectedBundle.reel.script}</p>
                    <p className="text-[11px] mt-1.5 font-medium">
                      {MEDIA_STATUS_LABEL[selectedBundle.reel.media_status]}
                    </p>
                  </>
                ) : <EmptySlot />}
              </BundleCard>
            </div>
          )}
        </div>

        {/* Provenance — for the selected day only */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">素材来源 / Provenance</p>
          {!selectedBundle || selectedBundle.provenance.length === 0 ? (
            <p className="text-xs text-me-charcoal/45 italic">未引用素材，或素材归属未通过校验</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedBundle.provenance.map(a => (
                <div key={a.id} className="flex items-center gap-2 bg-me-ivory rounded-lg px-2 py-1.5 border border-black/[.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.storage_url} alt={a.original_filename ?? ''} className="w-8 h-8 rounded object-cover" />
                  <span className="text-[10px] text-me-charcoal/60">{a.source}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Readiness — for the selected day only */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">就绪检查</p>
          {!selectedBundle ? (
            <p className="text-xs text-me-charcoal/45 italic">该日暂无排定内容，无就绪状态可显示</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              <ReadinessRow label="Master Brief 已连接" ok={selectedBundle.readiness.master_brief_grounding} />
              <ReadinessRow label="Campaign 已连接" ok={selectedBundle.readiness.campaign_grounding} />
              <ReadinessRow label="证据 / Claim 支撑" ok={false} forceLabel="UNKNOWN" />
              <ReadinessRow label="素材归属校验" ok={selectedBundle.readiness.client_asset_provenance} />
              <ReadinessRow label="Post 草稿完整" ok={selectedBundle.readiness.format_completeness.post} />
              <ReadinessRow label="Story 草稿完整" ok={selectedBundle.readiness.format_completeness.story} />
              <ReadinessRow label="Reel 草稿完整" ok={selectedBundle.readiness.format_completeness.reel} />
              <ReadinessRow label="人工审核" ok={selectedBundle.readiness.human_approval} />
              <ReadinessRow label="Provider 授权" ok={false} forceLabel="NOT_AUTHORIZED" />
              <ReadinessRow label="发布授权" ok={false} forceLabel="NOT_AUTHORIZED" />
              <ReadinessRow label="效果 / Outcome" ok={false} forceLabel="UNKNOWN" />
            </ul>
          )}
        </div>

        {/* Publishing + Ad preview */}
        <div className="border-t border-black/[.06] pt-3">
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">发布计划 / 广告预览</p>
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-me-charcoal/60">目的地：{data.publishing_plan.destination ?? 'UNKNOWN'}</span>
            <span className="bg-me-charcoal/10 text-me-charcoal/60 px-2 py-0.5 rounded-full font-medium">
              {data.publishing_plan.status}
            </span>
          </div>
          {data.ad_candidate && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-me-charcoal/55">
              <span>目标：{data.ad_candidate.goal}</span>
              <span>受众：{data.ad_candidate.audience}</span>
              <span>预算：{data.ad_candidate.budget}</span>
              <span className="bg-me-charcoal/10 text-me-charcoal/60 px-2 py-0.5 rounded-full font-medium">
                {data.ad_candidate.status}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotDot({ label, planned, selected }: { label: string; planned: boolean; selected: boolean }) {
  return (
    <span
      title={planned ? 'PLANNED' : 'NOT_PLANNED'}
      className={`w-4 h-4 rounded-full text-[9px] leading-4 font-medium ${
        planned
          ? selected ? 'bg-white text-me-ochre' : 'bg-me-ochre text-white'
          : selected ? 'bg-white/25 text-white/70' : 'bg-black/[.06] text-me-charcoal/35'
      }`}
    >
      {label}
    </span>
  )
}

function BundleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-black/[.06] rounded-lg p-3">
      <p className="text-xs font-semibold text-me-charcoal/70 mb-1.5">{title}</p>
      {children}
    </div>
  )
}

function EmptySlot() {
  return <p className="text-xs text-me-charcoal/40 italic">NOT_PLANNED</p>
}

function ReadinessRow({ label, ok, forceLabel }: { label: string; ok: boolean; forceLabel?: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-me-charcoal/65">
      <span>{ok ? '✅' : '⬜'}</span>
      <span>{label}</span>
      {forceLabel && <span className="text-me-charcoal/40">({forceLabel})</span>}
    </li>
  )
}
