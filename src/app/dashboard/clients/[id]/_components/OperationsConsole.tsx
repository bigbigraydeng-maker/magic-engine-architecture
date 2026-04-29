'use client'

import { type ReactNode, useState, useEffect, useCallback } from 'react'

interface OperationsConsoleProps {
  clientId: string
}

type Platform = 'facebook' | 'tiktok' | 'instagram'

interface PostResult {
  id?: string
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

interface RecentPost {
  id: string
  title: string
  route: string
  status: string
  platforms: string[]
  created_at: string
}

interface BriefSummary {
  id: string
  brand_name?: string | null
  status: string
}

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
]

const ROUTE_LABELS: Record<string, string> = {
  route_a: 'Route A',
  route_b: 'Route B',
  route_c: 'Route C',
}

const ROUTE_COLORS: Record<string, string> = {
  route_a: 'bg-blue-100 text-blue-700',
  route_b: 'bg-purple-100 text-purple-700',
  route_c: 'bg-green-100 text-green-700',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-100 text-red-700',
}

function PlatformSelector({
  value,
  onChange,
}: {
  value: Platform[]
  onChange: (v: Platform[]) => void
}) {
  return (
    <div className="flex gap-3 flex-wrap">
      {PLATFORMS.map(p => (
        <label key={p.id} className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.includes(p.id)}
            onChange={e => {
              if (e.target.checked) {
                onChange([...value, p.id])
              } else {
                onChange(value.filter(v => v !== p.id))
              }
            }}
            className="w-3.5 h-3.5 rounded border-gray-300"
          />
          <span className="text-xs text-gray-700">{p.label}</span>
        </label>
      ))}
    </div>
  )
}

function ResultCard({ post, index }: { post: PostResult; index: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span className="text-xs font-medium text-gray-900 truncate pr-4">
          V{index + 1}: {post.title}
        </span>
        <span className="text-gray-400 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Script</p>
            <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{post.script}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Caption</p>
            <p className="text-xs text-gray-800 leading-relaxed">{post.caption}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Hashtags</p>
            <p className="text-xs text-indigo-600">{post.hashtags?.join(' ')}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Visual Brief</p>
            <p className="text-xs text-gray-600 italic">{post.visual_brief}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function RouteCard({
  icon,
  title,
  description,
  accentClass,
  input,
  platforms,
  loading,
  result,
  error,
  onGenerate,
  onPlatformChange,
  children,
}: {
  icon: string
  title: string
  description: string
  accentClass: string
  input: string
  platforms: Platform[]
  loading: boolean
  result: PostResult[] | null
  error: string
  onGenerate: () => void
  onPlatformChange: (v: Platform[]) => void
  children: ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{icon}</span>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <p className="text-xs text-gray-500">{description}</p>
      </div>

      <div className="space-y-3">
        {children}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Platforms</label>
          <PlatformSelector value={platforms} onChange={onPlatformChange} />
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={loading || !input.trim()}
        className={`mt-auto w-full ${accentClass} disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2`}
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Generating…
          </>
        ) : (
          'Generate'
        )}
      </button>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">{error}</p>
      )}

      {result && result.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Results ({result.length} variants)
          </p>
          {result.map((post, i) => (
            <ResultCard key={i} post={post} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

export function OperationsConsole({ clientId }: OperationsConsoleProps) {
  const [brief, setBrief] = useState<BriefSummary | null>(null)
  const [briefLoading, setBriefLoading] = useState(true)

  // Route A
  const [aKeyword, setAKeyword] = useState('')
  const [aPlatforms, setAPlatforms] = useState<Platform[]>(['facebook', 'tiktok'])
  const [aLoading, setALoading] = useState(false)
  const [aResult, setAResult] = useState<PostResult[] | null>(null)
  const [aError, setAError] = useState('')

  // Route B
  const [bVideoUrl, setBVideoUrl] = useState('')
  const [bPlatforms, setBPlatforms] = useState<Platform[]>(['facebook', 'tiktok'])
  const [bLoading, setBLoading] = useState(false)
  const [bResult, setBResult] = useState<PostResult[] | null>(null)
  const [bError, setBError] = useState('')

  // Route C
  const [cTopic, setCTopic] = useState('')
  const [cPlatforms, setCPlatforms] = useState<Platform[]>(['facebook', 'tiktok'])
  const [cLoading, setCLoading] = useState(false)
  const [cResult, setCResult] = useState<PostResult[] | null>(null)
  const [cError, setCError] = useState('')

  // Recent posts
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([])
  const [postsLoading, setPostsLoading] = useState(true)

  const fetchBrief = useCallback(async () => {
    setBriefLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/brief`)
      if (res.ok) {
        const data = await res.json()
        setBrief(data.brief ?? null)
      }
    } finally {
      setBriefLoading(false)
    }
  }, [clientId])

  const fetchPosts = useCallback(async () => {
    setPostsLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/posts`)
      if (res.ok) {
        const data = await res.json()
        setRecentPosts((data.posts ?? []).slice(0, 12))
      }
    } finally {
      setPostsLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchBrief()
    fetchPosts()
  }, [fetchBrief, fetchPosts])

  const handleRouteA = async () => {
    if (!aKeyword.trim()) return
    setALoading(true)
    setAError('')
    setAResult(null)
    try {
      const res = await fetch('/api/content/route-a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          keyword: aKeyword.trim(),
          platforms: aPlatforms,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')
      setAResult(data.variants ?? [])
      void fetchPosts()
    } catch (err) {
      setAError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setALoading(false)
    }
  }

  const handleRouteB = async () => {
    if (!bVideoUrl.trim()) return
    setBLoading(true)
    setBError('')
    setBResult(null)
    try {
      const res = await fetch('/api/content/route-b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          video_url: bVideoUrl.trim(),
          platforms: bPlatforms,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')
      setBResult(data.variants ?? [])
      void fetchPosts()
    } catch (err) {
      setBError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBLoading(false)
    }
  }

  const handleRouteC = async () => {
    if (!cTopic.trim()) return
    setCLoading(true)
    setCError('')
    setCResult(null)
    try {
      const res = await fetch('/api/content/route-c', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          topic: cTopic.trim(),
          platforms: cPlatforms,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')
      setCResult(data.variants ?? data.posts ?? [])
      void fetchPosts()
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Brief status banner */}
      <div
        className={`rounded-xl border px-5 py-3 flex items-center gap-3 ${
          briefLoading
            ? 'bg-gray-50 border-gray-200'
            : brief
              ? 'bg-green-50 border-green-200'
              : 'bg-amber-50 border-amber-200'
        }`}
      >
        <span className="text-xl">
          {briefLoading ? '⏳' : brief ? '✅' : '⚠️'}
        </span>
        <div>
          {briefLoading && (
            <p className="text-sm text-gray-500">Checking Master Brief…</p>
          )}
          {!briefLoading && brief && (
            <p className="text-sm text-green-800">
              Active Master Brief:{' '}
              <span className="font-semibold">{brief.brand_name ?? 'Unnamed Brand'}</span>
              {' '}— all generation routes ready
            </p>
          )}
          {!briefLoading && !brief && (
            <p className="text-sm text-amber-800">
              No active Master Brief found. Switch to the{' '}
              <span className="font-semibold">✨ Master Brief</span> tab to generate one first.
            </p>
          )}
        </div>
      </div>

      {/* Generation cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Route A — Keyword */}
        <RouteCard
          icon="🔑"
          title="Route A — Keyword"
          description="SEO keyword → 2 brand-aligned social posts"
          accentClass="bg-indigo-600 hover:bg-indigo-700"
          input={aKeyword}
          platforms={aPlatforms}
          loading={aLoading}
          result={brief ? aResult : null}
          error={aError}
          onGenerate={handleRouteA}
          onPlatformChange={setAPlatforms}
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keyword</label>
            <input
              value={aKeyword}
              onChange={e => setAKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRouteA()}
              placeholder="e.g. 月子餐推荐"
              disabled={aLoading || !brief}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
        </RouteCard>

        {/* Route B — Video Remix */}
        <RouteCard
          icon="📹"
          title="Route B — Video Remix"
          description="Viral video URL → transcribe → brand rewrite"
          accentClass="bg-purple-600 hover:bg-purple-700"
          input={bVideoUrl}
          platforms={bPlatforms}
          loading={bLoading}
          result={brief ? bResult : null}
          error={bError}
          onGenerate={handleRouteB}
          onPlatformChange={setBPlatforms}
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Video URL</label>
            <input
              value={bVideoUrl}
              onChange={e => setBVideoUrl(e.target.value)}
              placeholder="TikTok / YouTube / Instagram URL"
              disabled={bLoading || !brief}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>
        </RouteCard>

        {/* Route C — Free Topic */}
        <RouteCard
          icon="💡"
          title="Route C — Free Topic"
          description="Any topic or idea → 2 on-brand post variants"
          accentClass="bg-emerald-600 hover:bg-emerald-700"
          input={cTopic}
          platforms={cPlatforms}
          loading={cLoading}
          result={brief ? cResult : null}
          error={cError}
          onGenerate={handleRouteC}
          onPlatformChange={setCPlatforms}
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Topic</label>
            <input
              value={cTopic}
              onChange={e => setCTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRouteC()}
              placeholder="e.g. 新年开工大吉"
              disabled={cLoading || !brief}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            />
          </div>
        </RouteCard>
      </div>

      {/* Recent generated posts */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Generated Posts</h2>
          <a href="/dashboard/content" className="text-xs text-indigo-600 hover:underline">
            View all content →
          </a>
        </div>
        {postsLoading ? (
          <div className="py-8 text-center">
            <div className="text-gray-400 text-sm animate-pulse">Loading posts…</div>
          </div>
        ) : recentPosts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-400 text-sm">No posts generated yet.</p>
            <p className="text-gray-400 text-xs mt-1">Use a generation route above to create your first content.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentPosts.map(post => (
              <div key={post.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{post.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        ROUTE_COLORS[post.route] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {ROUTE_LABELS[post.route] ?? post.route}
                    </span>
                    <span className="text-xs text-gray-400">
                      {post.platforms?.join(', ')}
                    </span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">
                      {new Date(post.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <span
                  className={`ml-3 flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {post.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
