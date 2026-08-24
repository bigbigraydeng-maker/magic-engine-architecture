'use client'

import { useEffect, useState, useCallback } from 'react'

interface Props {
  clientId: string
  campaignId: string
}

interface DailyPlanResponse {
  success: boolean
  campaign: { id: string; title: string; offer: string | null; primary_cta: string | null } | null
  grounding: { status: 'OK' | 'NEEDS_BRIEF' | 'NEEDS_CAMPAIGN'; has_master_brief: boolean; has_campaign: boolean }
  days: Array<{ date: string; slots: { post: 'PLANNED' | 'NOT_PLANNED'; story: 'PLANNED' | 'NOT_PLANNED'; reel: 'PLANNED' | 'NOT_PLANNED' } }>
  current_bundle: {
    date: string
    post: { hook: string; body: string; cta: string } | null
    story: { frames: Array<{ order: number; copy: string }> } | null
    reel: { brief: string; script: string; caption: string; source_asset_ids: string[]; media_status: 'NO_MEDIA' | 'DRAFT_MEDIA' | 'READY' } | null
  } | null
  provenance: Array<{ id: string; storage_url: string; original_filename: string | null; source: string; ownership: string }>
  readiness: {
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

export function CampaignDailyPlanPanel({ clientId, campaignId }: Props) {
  const [data, setData] = useState<DailyPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan?campaign_id=${campaignId}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? '加载失败')
      setData(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [clientId, campaignId])

  useEffect(() => { load() }, [load])

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
        {/* 7-day grid */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">七日排期</p>
          <div className="grid grid-cols-7 gap-1.5">
            {data.days.map(day => (
              <div key={day.date} className="bg-me-ivory rounded-lg px-1.5 py-2 text-center">
                <p className="text-[10px] text-me-charcoal/55 mb-1">{day.date.slice(5)}</p>
                <div className="flex justify-center gap-0.5">
                  <SlotDot label="帖" planned={day.slots.post === 'PLANNED'} />
                  <SlotDot label="故" planned={day.slots.story === 'PLANNED'} />
                  <SlotDot label="片" planned={day.slots.reel === 'PLANNED'} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Current bundle */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
            当前 Bundle{data.current_bundle ? ` · ${data.current_bundle.date}` : ''}
          </p>
          {!data.current_bundle ? (
            <p className="text-xs text-me-charcoal/45 italic">暂无排定内容</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <BundleCard title="📝 Post">
                {data.current_bundle.post ? (
                  <>
                    <p className="text-xs font-medium text-me-charcoal/80">{data.current_bundle.post.hook}</p>
                    <p className="text-xs text-me-charcoal/60 mt-1 line-clamp-3">{data.current_bundle.post.body}</p>
                    <p className="text-xs text-me-ochre mt-1">CTA: {data.current_bundle.post.cta}</p>
                  </>
                ) : <EmptySlot />}
              </BundleCard>

              <BundleCard title="🎬 Story">
                {data.current_bundle.story ? (
                  <ol className="space-y-1">
                    {data.current_bundle.story.frames.map(f => (
                      <li key={f.order} className="text-xs text-me-charcoal/70">
                        <span className="text-me-charcoal/40">#{f.order}</span> {f.copy}
                      </li>
                    ))}
                  </ol>
                ) : <EmptySlot />}
              </BundleCard>

              <BundleCard title="🎥 Reel">
                {data.current_bundle.reel ? (
                  <>
                    <p className="text-xs text-me-charcoal/60 line-clamp-2">{data.current_bundle.reel.brief}</p>
                    <p className="text-xs text-me-charcoal/45 mt-1 line-clamp-2 italic">{data.current_bundle.reel.script}</p>
                    <p className="text-[11px] mt-1.5 font-medium">
                      {MEDIA_STATUS_LABEL[data.current_bundle.reel.media_status]}
                    </p>
                  </>
                ) : <EmptySlot />}
              </BundleCard>
            </div>
          )}
        </div>

        {/* Provenance */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">素材来源 / Provenance</p>
          {data.provenance.length === 0 ? (
            <p className="text-xs text-me-charcoal/45 italic">未引用素材，或素材归属未通过校验</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.provenance.map(a => (
                <div key={a.id} className="flex items-center gap-2 bg-me-ivory rounded-lg px-2 py-1.5 border border-black/[.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.storage_url} alt={a.original_filename ?? ''} className="w-8 h-8 rounded object-cover" />
                  <span className="text-[10px] text-me-charcoal/60">{a.source}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Readiness */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">就绪检查</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            <ReadinessRow label="Master Brief 已连接" ok={data.readiness.master_brief_grounding} />
            <ReadinessRow label="Campaign 已连接" ok={data.readiness.campaign_grounding} />
            <ReadinessRow label="证据 / Claim 支撑" ok={false} forceLabel="UNKNOWN" />
            <ReadinessRow label="素材归属校验" ok={data.readiness.client_asset_provenance} />
            <ReadinessRow label="Post 草稿完整" ok={data.readiness.format_completeness.post} />
            <ReadinessRow label="Story 草稿完整" ok={data.readiness.format_completeness.story} />
            <ReadinessRow label="Reel 草稿完整" ok={data.readiness.format_completeness.reel} />
            <ReadinessRow label="人工审核" ok={data.readiness.human_approval} />
            <ReadinessRow label="Provider 授权" ok={false} forceLabel="NOT_AUTHORIZED" />
            <ReadinessRow label="发布授权" ok={false} forceLabel="NOT_AUTHORIZED" />
            <ReadinessRow label="效果 / Outcome" ok={false} forceLabel="UNKNOWN" />
          </ul>
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

function SlotDot({ label, planned }: { label: string; planned: boolean }) {
  return (
    <span
      title={planned ? 'PLANNED' : 'NOT_PLANNED'}
      className={`w-4 h-4 rounded-full text-[9px] leading-4 font-medium ${
        planned ? 'bg-me-ochre text-white' : 'bg-black/[.06] text-me-charcoal/35'
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
