'use client'

/**
 * ContentStudioDrawer — diagnosis-driven content workbench.
 *
 * Launched from an execution-kanban item. The drawer is the WHY → DO bridge:
 * the diagnosis produced this task, and the FDE generates the content that
 * solves it here, without bouncing to another page.
 *
 * Two modes:
 *   📝 SEO 文章  — StudioArticleTab (one-shot blog generation)
 *   🎬 社媒视频  — embedded ReelsStudio (prompts → frames → video → caption)
 *
 * Every generation auto-injects Master Brief + the active Campaign. On success
 * the drawer logs an `ai_assist` entry back to the execution item and bumps a
 * `pending` item to `in_progress`, closing the flywheel loop.
 */

import { useState, useEffect, useCallback } from 'react'
import type { ExecutionItem } from '@/types/diagnostic'
import { ReelsStudio } from '../../_components/ReelsStudio'
import { StudioArticleTab } from './StudioArticleTab'
import { SocialPlanSection } from './SocialPlanSection'

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

type StudioTab = 'article' | 'video'

interface ActiveCampaign {
  id: string
  name: string
}

interface Props {
  clientId: string
  item: ExecutionItem
  onClose: () => void
  /** Called after content is generated — parent silently refreshes the kanban. */
  onContentGenerated: () => void
}

/** Social-dimension items default to the video tab; everything else to article. */
function defaultTabFor(dimension: string): StudioTab {
  return dimension === 'social' ? 'video' : 'article'
}

export function ContentStudioDrawer({ clientId, item, onClose, onContentGenerated }: Props) {
  const [tab, setTab]               = useState<StudioTab>(defaultTabFor(item.dimension))
  const [campaign, setCampaign]     = useState<ActiveCampaign | null>(null)
  const [campaignLoaded, setCampaignLoaded] = useState(false)

  // Fetch the active campaign once — used both for the header assurance line
  // and as ReelsStudio's default-selected campaign.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
        if (res.ok) {
          const { campaigns } = await res.json() as { campaigns?: ActiveCampaign[] }
          if (!cancelled && campaigns?.[0]) {
            setCampaign({ id: campaigns[0].id, name: campaigns[0].name })
          }
        }
      } catch {
        /* non-fatal — generation still works on Master Brief alone */
      } finally {
        if (!cancelled) setCampaignLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  // Log generated content back to the execution item + bump status to in_progress.
  // Both calls are best-effort: a logging failure must never block content work.
  const linkContentToItem = useCallback((summary: string, blogPostId?: string) => {
    const content = blogPostId ? `${summary} [blog:${blogPostId}]` : summary
    fetch(`/api/clients/${clientId}/execution/${item.id}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ kind: 'ai_assist', author: 'luban', content }),
    }).catch(() => { /* non-blocking */ })

    if (item.status === 'pending') {
      fetch(`/api/clients/${clientId}/execution/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ status: 'in_progress' }),
      }).catch(() => { /* non-blocking */ })
    }

    onContentGenerated()
  }, [clientId, item.id, item.status, onContentGenerated])

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed right-0 top-0 h-full w-[78vw] min-w-[860px] max-w-[1500px] bg-gray-50 shadow-2xl z-50 flex flex-col">

        {/* Header — the WHY */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <span className="inline-block text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-0.5">
              📌 为这个诊断任务生成内容
            </span>
            <h2 className="text-base font-bold text-gray-900 mt-1.5 truncate">{item.title}</h2>
            {item.description && item.description !== item.title && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
            )}
            <p className="text-[11px] text-gray-400 mt-1.5">
              ✓ 自动注入 Master Brief（客户 DNA）
              {campaignLoaded && (
                campaign
                  ? <> · ✓ 当前 Campaign：<strong className="text-gray-600">{campaign.name}</strong></>
                  : <> · <span className="text-amber-600">⚠ 无活跃 Campaign（仅依据品牌 DNA）</span></>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none shrink-0"
            aria-label="关闭工作台"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
          {([['article', '📝 SEO 文章'], ['video', '🎬 社媒视频']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setTab(val)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === val
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!campaignLoaded ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'article' ? (
            <StudioArticleTab
              clientId={clientId}
              item={item}
              hasActiveCampaign={!!campaign}
              onGenerated={linkContentToItem}
            />
          ) : (
            <div className="space-y-2">
              <SocialPlanSection
                clientId={clientId}
                campaignId={campaign?.id}
                campaignName={campaign?.name}
              />
              <ReelsStudio
                clientId={clientId}
                defaultCampaignId={campaign?.id}
                onDraftGenerated={() =>
                  linkContentToItem('🤖 已在内容工作台生成社媒视频草稿（Reel）')
                }
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
