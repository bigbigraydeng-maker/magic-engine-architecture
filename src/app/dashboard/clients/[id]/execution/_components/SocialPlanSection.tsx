'use client'

/**
 * SocialPlanSection — Phase A Social Plan generator, embedded in ContentStudioDrawer.
 *
 * Shows inside the "社媒视频" tab, above ReelsStudio.
 * Calls POST /api/clients/[id]/social-plan and renders:
 *   • Strategy card (theme + tone + campaign focus)
 *   • Sub-tabs: Reels (3) | Posts (5) | Stories (3)
 *
 * Requires an active campaign (campaign_brief_id); shows a warning if none.
 */

import { useState, useCallback } from 'react'
import type { SocialPlanOutput, ReelsScript, Post, Story } from '@/lib/social/social-plan-templates'

interface Props {
  clientId: string
  campaignId: string | undefined
  campaignName: string | undefined
}

type PlanTab = 'reels' | 'posts' | 'stories'

export function SocialPlanSection({ clientId, campaignId, campaignName }: Props) {
  const [loading, setLoading]   = useState(false)
  const [plan, setPlan]         = useState<SocialPlanOutput | null>(null)
  const [planId, setPlanId]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [planTab, setPlanTab]   = useState<PlanTab>('reels')

  async function generate() {
    if (!campaignId) return
    setLoading(true)
    setError(null)
    setPlan(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/social-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_brief_id: campaignId }),
      })
      const json = await res.json() as { success: boolean; plan?: SocialPlanOutput; plan_id?: string; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Generation failed')
      setPlan(json.plan!)
      setPlanId(json.plan_id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <div>
          <h3 className="text-sm font-bold text-indigo-900">📋 Social Plan Studio</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Strategy → 3 Reels · 5 Posts · 3 Stories · 一键生成
          </p>
        </div>
        {campaignId ? (
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                生成中…（约 40s）
              </>
            ) : (
              <>✦ 生成 Social Plan</>
            )}
          </button>
        ) : (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            ⚠ 请先设置活跃 Campaign
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 text-xs text-red-700 bg-red-50 border-b border-red-100">
          ⚠ {error}
        </div>
      )}

      {/* Loading placeholder */}
      {loading && !plan && (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Claude 正在制定策略，GPT-4o-mini 生成内容中…
        </div>
      )}

      {/* Results */}
      {plan && (
        <div className="px-5 py-4 space-y-4">

          {/* Strategy card */}
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 uppercase tracking-wide">
              <span>🎯 Strategy</span>
              {planId && (
                <span className="ml-auto font-normal text-indigo-400 normal-case">
                  plan_id: {planId.slice(0, 8)}…
                </span>
              )}
            </div>
            <p className="text-sm text-gray-800 font-medium leading-snug">{plan.strategy.theme}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {plan.strategy.content_pillars.map((p, i) => (
                <span key={i} className="text-[11px] bg-white border border-indigo-200 text-indigo-700 rounded-full px-2.5 py-0.5">
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              <strong>Tone:</strong> {plan.strategy.tone_guidance}
            </p>
            {campaignName && (
              <p className="text-[11px] text-gray-500">
                <strong>Campaign:</strong> {campaignName}
              </p>
            )}
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 border-b border-gray-200 -mx-5 px-5">
            {([
              ['reels',   `🎬 Reels (${plan.reels.length})`],
              ['posts',   `📝 Posts (${plan.posts.length})`],
              ['stories', `⚡ Stories (${plan.stories.length})`],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPlanTab(val)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  planTab === val
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Reels */}
          {planTab === 'reels' && (
            <div className="space-y-3">
              {plan.reels.map((reel, i) => (
                <ReelCard key={i} index={i} reel={reel} />
              ))}
            </div>
          )}

          {/* Posts */}
          {planTab === 'posts' && (
            <div className="space-y-3">
              {plan.posts.map((post, i) => (
                <PostCard key={i} post={post} />
              ))}
            </div>
          )}

          {/* Stories */}
          {planTab === 'stories' && (
            <div className="space-y-2">
              {plan.stories.map((story, i) => (
                <StoryCard key={i} index={i} story={story} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !plan && !error && campaignId && (
        <div className="px-5 py-6 text-center text-xs text-gray-400">
          点击"生成 Social Plan"一键产出本月 Facebook 内容策略
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** One-click copy helper shown next to each field label. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* silent */ })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium ml-1 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function ReelCard({ index, reel }: { index: number; reel: ReelsScript }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800 truncate">{reel.title}</p>
          <p className="text-[11px] text-gray-500 truncate">🎣 {reel.hook}</p>
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded: ReelsStudio-compatible fields */}
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-100 bg-white">

          {/* Opening frame prompt */}
          <div>
            <div className="flex items-center mb-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase">🖼️ Opening Frame Prompt</p>
              <CopyButton text={reel.opening_frame_prompt} />
            </div>
            <p className="text-[11px] text-gray-700 leading-relaxed bg-gray-50 rounded p-2 italic">
              {reel.opening_frame_prompt}
            </p>
          </div>

          {/* Closing frame prompt */}
          <div>
            <div className="flex items-center mb-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase">🖼️ Closing Frame Prompt</p>
              <CopyButton text={reel.closing_frame_prompt} />
            </div>
            <p className="text-[11px] text-gray-700 leading-relaxed bg-gray-50 rounded p-2 italic">
              {reel.closing_frame_prompt}
            </p>
          </div>

          {/* i2v video prompt */}
          <div>
            <div className="flex items-center mb-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase">🎬 Video Prompt (I2V)</p>
              <CopyButton text={reel.i2v_video_prompt} />
            </div>
            <p className="text-[11px] text-gray-700 leading-relaxed bg-indigo-50 rounded p-2">
              {reel.i2v_video_prompt}
            </p>
          </div>

          {/* Caption */}
          <div>
            <div className="flex items-center mb-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase">📝 Caption</p>
              <CopyButton text={reel.caption} />
            </div>
            <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line line-clamp-5">
              {reel.caption}
            </p>
          </div>

          {/* Hashtags */}
          <div className="flex flex-wrap gap-1">
            {reel.hashtags.map((h, hi) => (
              <span key={hi} className="text-[10px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const POST_TYPE_COLOR: Record<string, string> = {
  educational:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  promotional:  'bg-amber-50 text-amber-700 border-amber-200',
  storytelling: 'bg-purple-50 text-purple-700 border-purple-200',
  engagement:   'bg-blue-50 text-blue-700 border-blue-200',
}

function PostCard({ post }: { post: Post }) {
  const [open, setOpen] = useState(false)
  const colorClass = POST_TYPE_COLOR[post.content_type] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 shrink-0 ${colorClass}`}>
          {post.content_type}
        </span>
        <p className="flex-1 text-xs text-gray-700 truncate">{post.copy.slice(0, 80)}…</p>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2.5 border-t border-gray-100 bg-white">
          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{post.copy}</p>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Image Prompt</p>
            <p className="text-[11px] text-gray-500 italic leading-relaxed">{post.image_prompt}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {post.hashtags.map((h, hi) => (
              <span key={hi} className="text-[10px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StoryCard({ index, story }: { index: number; story: Story }) {
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex gap-3">
      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-semibold text-gray-800">{story.copy}</p>
        <p className="text-[11px] text-indigo-600 font-medium">→ {story.cta}</p>
        <p className="text-[11px] text-gray-400 italic truncate">{story.visual_prompt}</p>
      </div>
    </div>
  )
}
