'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CampaignBrief } from '@/types/magic-engine'

interface GeneratedPost {
  id: string
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
  status: string
}

interface Props {
  clientId: string
  open: boolean
  onClose: () => void
}

type RouteId = 'route_a' | 'route_b' | 'route_c'
type ContentMode = 'brand' | 'campaign'

const ROUTES: { id: RouteId; label: string; icon: string; inputLabel: string; inputPlaceholder: string }[] = [
  { id: 'route_a', label: '关键词', icon: '🔑', inputLabel: '目标关键词', inputPlaceholder: '例：新西兰团队游' },
  { id: 'route_b', label: '视频混剪', icon: '📹', inputLabel: '视频链接', inputPlaceholder: 'https://tiktok.com/…' },
  { id: 'route_c', label: '自由话题', icon: '💡', inputLabel: '内容话题', inputPlaceholder: '例：为什么选择新西兰旅游' },
]

const PLATFORMS = ['facebook', 'tiktok', 'instagram']

const CAMPAIGN_BORDER_COLORS = [
  'border-l-blue-500', 'border-l-emerald-500', 'border-l-purple-500',
  'border-l-amber-500', 'border-l-rose-500',
]

export function GenerationDrawer({ clientId, open, onClose }: Props) {
  const [route, setRoute] = useState<RouteId>('route_a')
  const [mode, setMode] = useState<ContentMode>('brand')
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'tiktok'])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<GeneratedPost[] | null>(null)
  const [approving, setApproving] = useState<Record<string, boolean>>({})
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [rejected, setRejected] = useState<Record<string, boolean>>({})

  // Data
  const [hasBrief, setHasBrief] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])

  const loadData = useCallback(async () => {
    const [briefRes, campRes] = await Promise.allSettled([
      fetch(`/api/clients/${clientId}/brief?status=active`),
      fetch(`/api/clients/${clientId}/campaign?status=active`),
    ])
    if (briefRes.status === 'fulfilled' && briefRes.value.ok) {
      const j = await briefRes.value.json()
      setHasBrief(!!j.brief)
    }
    if (campRes.status === 'fulfilled' && campRes.value.ok) {
      const j = await campRes.value.json()
      setCampaigns(j.campaigns ?? [])
    }
  }, [clientId])

  useEffect(() => {
    if (open) {
      loadData()
      setResults(null)
      setError('')
    }
  }, [open, loadData])

  // When switching route, reset input
  const handleRouteChange = (r: RouteId) => {
    setRoute(r)
    setInput('')
    setResults(null)
    setError('')
  }

  // When switching to brand mode, deselect campaign
  const handleModeChange = (m: ContentMode) => {
    setMode(m)
    if (m === 'brand') setSelectedCampaignId(null)
    setResults(null)
    setError('')
  }

  const togglePlatform = (p: string) => {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  const handleGenerate = async () => {
    if (!input.trim()) { setError('请填写输入内容'); return }
    if (platforms.length === 0) { setError('请至少选择一个发布平台'); return }
    if (mode === 'campaign' && !selectedCampaignId) { setError('请选择推广活动'); return }

    setGenerating(true)
    setError('')
    setResults(null)
    setApproved({})
    setRejected({})

    const endpoint = route === 'route_a'
      ? '/api/content/route-a'
      : route === 'route_b'
        ? '/api/content/route-b'
        : '/api/content/route-c'

    const bodyKey = route === 'route_a' ? 'keyword'
      : route === 'route_b' ? 'video_url'
        : 'topic'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          [bodyKey]: input.trim(),
          platforms,
          campaign_id: selectedCampaignId ?? undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      // Route A returns `variants`, Route B returns `saved_posts`, Route C returns `variants`
      const posts: GeneratedPost[] = json.posts ?? json.saved_posts ?? json.variants ?? []
      setResults(posts)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const handleApprove = async (postId: string) => {
    setApproving(prev => ({ ...prev, [postId]: true }))
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      if (res.ok) setApproved(prev => ({ ...prev, [postId]: true }))
    } finally {
      setApproving(prev => ({ ...prev, [postId]: false }))
    }
  }

  const handleReject = async (postId: string) => {
    setApproving(prev => ({ ...prev, [postId]: true }))
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      if (res.ok) setRejected(prev => ({ ...prev, [postId]: true }))
    } finally {
      setApproving(prev => ({ ...prev, [postId]: false }))
    }
  }

  if (!open) return null

  const activeRoute = ROUTES.find(r => r.id === route)!
  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">生成内容</h2>
            {hasBrief === false && (
              <p className="text-xs text-amber-600 mt-0.5">⚠️ 尚无 Master Brief，生成将缺少品牌上下文</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Step 1: Route */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">1 · 生成路线</p>
            <div className="grid grid-cols-3 gap-2">
              {ROUTES.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleRouteChange(r.id)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-colors text-center ${
                    route === r.id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="text-xl mb-1">{r.icon}</span>
                  <span className="text-xs font-medium">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Content Mode */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">2 · 内容模式</p>
            <div className="space-y-2">
              {(['brand', 'campaign'] as ContentMode[]).map(m => (
                <label
                  key={m}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    mode === m ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    checked={mode === m}
                    onChange={() => handleModeChange(m)}
                    className="mt-0.5 accent-indigo-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {m === 'brand' ? '品牌内容' : '推广活动内容'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {m === 'brand'
                        ? '仅读取 Master Brief，适合长期品牌内容'
                        : '读取 MB + 推广活动，适合当下产品推广'}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Campaign selector */}
            {mode === 'campaign' && (
              <div className="mt-3">
                {campaigns.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    当前无进行中的活动。请先在「推广活动」tab 中创建活动。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {campaigns.map((c, i) => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors border-l-4 ${
                          CAMPAIGN_BORDER_COLORS[i % CAMPAIGN_BORDER_COLORS.length]
                        } ${
                          selectedCampaignId === c.id
                            ? 'border-indigo-600 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          checked={selectedCampaignId === c.id}
                          onChange={() => setSelectedCampaignId(c.id)}
                          className="accent-indigo-600"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.title}</p>
                          {c.valid_from && (
                            <p className="text-xs text-gray-400">{c.valid_from} → {c.valid_until ?? '—'}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Input */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              3 · {activeRoute.inputLabel}
            </p>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !generating && handleGenerate()}
              placeholder={activeRoute.inputPlaceholder}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
            />
          </div>

          {/* Step 4: Platforms */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">4 · 发布平台</p>
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors capitalize ${
                    platforms.includes(p)
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Results */}
          {results && results.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                ══ 生成结果 ══
              </p>
              <div className="space-y-4">
                {results.map((post, idx) => {
                  const isApproved = approved[post.id]
                  const isRejected = rejected[post.id]
                  const isLoading = approving[post.id]
                  const isDone = isApproved || isRejected

                  return (
                    <div
                      key={post.id}
                      className={`rounded-xl border-2 overflow-hidden transition-all ${
                        isApproved ? 'border-green-400 bg-green-50'
                          : isRejected ? 'border-gray-200 bg-gray-50 opacity-60'
                            : 'border-gray-200'
                      }`}
                    >
                      <div className="px-4 py-3 bg-white border-b border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-600">V{idx + 1}</span>
                          {mode === 'campaign' && selectedCampaign && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {selectedCampaign.title}
                            </span>
                          )}
                          {isApproved && <span className="text-xs text-green-600 font-medium ml-auto">✓ 已批准，进入日历</span>}
                          {isRejected && <span className="text-xs text-gray-400 ml-auto">已拒绝</span>}
                        </div>
                        <p className="text-sm font-semibold text-gray-900 mt-1 leading-snug">{post.title}</p>
                      </div>

                      <div className="px-4 py-3 space-y-2">
                        {post.caption && (
                          <p className="text-xs text-gray-600 line-clamp-3">{post.caption}</p>
                        )}
                        {post.hashtags && post.hashtags.length > 0 && (
                          <p className="text-xs text-indigo-500">{post.hashtags.slice(0, 6).join(' ')}</p>
                        )}
                        {post.script && (
                          <details className="text-xs">
                            <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Script 展开</summary>
                            <p className="text-gray-600 mt-2 whitespace-pre-wrap bg-gray-50 rounded p-2">{post.script}</p>
                          </details>
                        )}
                      </div>

                      {!isDone && post.id && (
                        <div className="px-4 pb-4 flex gap-2">
                          <button
                            onClick={() => handleReject(post.id)}
                            disabled={isLoading}
                            className="flex-1 py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            ✕ 拒绝
                          </button>
                          <button
                            onClick={() => handleApprove(post.id)}
                            disabled={isLoading}
                            className="flex-[2] py-2 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                          >
                            {isLoading ? '处理中…' : '✓ 批准发布'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — generate button */}
        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
          {results ? (
            <button
              onClick={() => { setResults(null); setInput(''); setApproved({}); setRejected({}) }}
              className="w-full py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              再生成一组
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating || !input.trim() || platforms.length === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  生成中…
                </span>
              ) : '生成 V1 + V2'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
