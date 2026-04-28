'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Post {
  id: string
  title: string
  status: string
  platforms: string[]
  caption: string | null
  hashtags: string[] | null
  visual_brief: string | null
  scheduled_at: string | null
  format: string | null
  ratio: string | null
  created_at: string
}

interface VisualAsset {
  id: string
  post_id: string
  asset_type: string
  generation_status: string
  storage_url: string | null
  provider_job_id: string | null
  created_at: string
}

interface GenState {
  generating: boolean
  elapsed: number
  assetId?: string
  genStatus?: string
}

interface Client {
  id: string
  name: string
}

interface PublerAccount {
  id: string
  provider: string
  name: string
}

interface PubModal {
  assetId: string
  postId: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VIDEO_FORMATS = ['reel', 'video']

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: '📷', facebook: '📘', tiktok: '🎵', linkedin: '💼', twitter: '🐦',
}

const FORMAT_STYLE: Record<string, string> = {
  reel:     'bg-purple-100 text-purple-700',
  video:    'bg-purple-100 text-purple-700',
  feed:     'bg-sky-100 text-sky-700',
  image:    'bg-sky-100 text-sky-700',
  story:    'bg-pink-100 text-pink-700',
  carousel: 'bg-amber-100 text-amber-700',
}

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-500',
  approved:  'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-600',
  published: 'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-600',
}

const STATUSES = ['draft', 'approved', 'scheduled', 'published', 'rejected']
const STAGES   = ['Initialising…', 'Generating concept…', 'Rendering pixels…', 'Finalising…']

// ── Helpers ───────────────────────────────────────────────────────────────────

function assetTypeFromFormat(format?: string | null): 'image' | 'video' {
  return VIDEO_FORMATS.includes((format ?? '').toLowerCase()) ? 'video' : 'image'
}

function fmtDateNZ(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function toDatetimeLocal(iso: string): string {
  return new Date(iso)
    .toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' })
    .replace(' ', 'T')
    .slice(0, 16)
}

function fromDatetimeLocal(s: string): string {
  return new Date(s).toISOString()
}

// ── Editable cells ─────────────────────────────────────────────────────────────

function EditableText({
  value, onSave, placeholder = '—',
}: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        className="w-full text-sm px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-400 outline-none bg-white text-gray-900 placeholder:text-gray-500"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title={value ?? ''}
      className="cursor-text min-h-[22px] text-sm text-gray-900 px-1 py-0.5 rounded hover:bg-blue-50 truncate"
    >
      {value || <span className="text-gray-300 italic text-xs">{placeholder}</span>}
    </div>
  )
}

function EditableTextarea({
  value, onSave, placeholder = '—',
}: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-400 outline-none resize-y min-h-[64px] bg-white text-gray-900 placeholder:text-gray-500"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title={value ?? ''}
      className="cursor-text min-h-[22px] text-xs text-gray-900 px-1 py-0.5 rounded hover:bg-blue-50 line-clamp-2 overflow-hidden"
    >
      {value || <span className="text-gray-300 italic">{placeholder}</span>}
    </div>
  )
}

function EditableDatetime({
  value, onSave,
}: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ? toDatetimeLocal(value) : '')

  const commit = (v: string) => {
    setEditing(false)
    if (v) onSave(fromDatetimeLocal(v))
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="datetime-local"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        className="text-xs px-1 py-0.5 border border-blue-400 rounded outline-none w-36 bg-white text-gray-900"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ? toDatetimeLocal(value) : ''); setEditing(true) }}
      className="cursor-text min-h-[22px] text-xs text-gray-900 px-1 py-0.5 rounded hover:bg-blue-50 whitespace-nowrap"
    >
      {fmtDateNZ(value)}
    </div>
  )
}

function EditableHashtags({
  value, onSave,
}: { value: string[] | null; onSave: (v: string[]) => void }) {
  const str = value?.join(' ') ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(str)

  const commit = () => {
    setEditing(false)
    onSave(draft.split(/\s+/).map(s => s.trim()).filter(Boolean))
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="#tag1 #tag2"
        className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-400 outline-none bg-white text-gray-900 placeholder:text-gray-500"
      />
    )
  }

  const tags = value ?? []
  const displayTags = tags.slice(0, 2)
  const hiddenCount = Math.max(0, tags.length - 2)

  return (
    <div
      onClick={() => { setDraft(str); setEditing(true) }}
      title={str}
      className="cursor-text min-h-[22px] text-xs px-1 py-0.5 rounded hover:bg-blue-50 text-blue-500 flex items-center gap-1 flex-wrap"
    >
      {tags.length > 0 ? (
        <>
          {displayTags.map((tag, idx) => (
            <span key={idx} className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">
              {tag}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="text-gray-400 text-[10px]">+{hiddenCount}</span>
          )}
        </>
      ) : (
        <span className="text-gray-300 italic">—</span>
      )}
    </div>
  )
}

function EditableStatus({
  value, onSave,
}: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => { onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-blue-400 rounded px-1 outline-none bg-white w-full text-gray-900"
      >
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_STYLE[value] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {value}
    </span>
  )
}

function EditableFormat({
  value, onSave,
}: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const formats = Object.keys(FORMAT_STYLE)

  if (editing) {
    return (
      <select
        autoFocus
        value={value ?? ''}
        onChange={e => { onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-blue-400 rounded px-1 outline-none bg-white w-full text-gray-900"
      >
        <option value="">—</option>
        {formats.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer text-xs px-1.5 py-0.5 rounded font-medium capitalize ${value ? FORMAT_STYLE[value.toLowerCase()] ?? 'bg-gray-100 text-gray-600' : 'text-gray-300'}`}
    >
      {value || '—'}
    </span>
  )
}

function EditablePlatforms({
  value, onSave,
}: { value: string[] | null; onSave: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((value ?? []).join(' '))
  const platforms = Object.keys(PLATFORM_EMOJI)

  const commit = () => {
    setEditing(false)
    const arr = draft.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(p => platforms.includes(p))
    onSave(arr)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="instagram facebook tiktok…"
        className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-400 outline-none bg-white text-gray-900 placeholder:text-gray-500"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft((value ?? []).join(' ')); setEditing(true) }}
      className="cursor-text flex gap-0.5 flex-wrap min-h-[22px] px-1 py-0.5 rounded hover:bg-blue-50"
    >
      {(value ?? []).length > 0 ? (
        (value ?? []).map(p => (
          <span key={p} title={p} className="text-base leading-none">
            {PLATFORM_EMOJI[p.toLowerCase()] ?? p.slice(0, 2).toUpperCase()}
          </span>
        ))
      ) : (
        <span className="text-gray-300 italic text-xs">—</span>
      )}
    </div>
  )
}

// ── Asset cell ─────────────────────────────────────────────────────────────────

function AssetCell({
  post, genState, readyAsset, onGenerate, onSchedule,
}: {
  post: Post
  genState?: GenState
  readyAsset?: VisualAsset
  onGenerate: () => void
  onSchedule: (assetId: string) => void
}) {
  if (genState?.generating) {
    const stage = STAGES[Math.floor(genState.elapsed / 30) % STAGES.length]
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] text-blue-500 font-medium">{genState.elapsed}s</span>
        <span className="text-[10px] text-gray-400 text-center leading-tight max-w-[80px]">{stage}</span>
      </div>
    )
  }

  if (readyAsset?.storage_url) {
    return (
      <div className="flex flex-col items-center gap-1">
        <img
          src={readyAsset.storage_url}
          alt=""
          className="w-14 h-14 object-cover rounded cursor-pointer ring-1 ring-gray-200 hover:ring-blue-400 transition-all"
          onClick={() => window.open(readyAsset.storage_url!, '_blank')}
        />
        <div className="flex gap-1 text-[10px]">
          <button
            onClick={() => onSchedule(readyAsset.id)}
            className="px-1.5 py-0.5 bg-green-500 text-white rounded hover:bg-green-600 whitespace-nowrap"
          >
            → Publer
          </button>
          <button
            onClick={onGenerate}
            title="Regenerate with different settings"
            className="px-1.5 py-0.5 bg-gray-400 text-white rounded hover:bg-gray-500 whitespace-nowrap"
          >
            ↻ Retry
          </button>
        </div>
      </div>
    )
  }

  const type = assetTypeFromFormat(post.format)
  return (
    <button
      onClick={onGenerate}
      className="text-xs px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 whitespace-nowrap"
    >
      {type === 'video' ? '▶ Video' : '🖼 Image'}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VisualsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [assets, setAssets] = useState<VisualAsset[]>([])
  const [genStates, setGenStates] = useState<Record<string, GenState>>({})
  const [syncing, setSyncing] = useState(false)
  const [pubModal, setPubModal] = useState<PubModal | null>(null)
  const [publerAccounts, setPublerAccounts] = useState<PublerAccount[]>([])
  const [scheduleForm, setScheduleForm] = useState({ account_id: '', scheduled_at: '', caption: '' })
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const pollingRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const elapsedRefs = useRef<Record<string, NodeJS.Timeout>>({})

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchClients = useCallback(async () => {
    const res = await fetch('/api/clients')
    const d = await res.json()
    const list: Client[] = d.clients ?? []
    setClients(list)
    if (list.length && !selectedClientId) setSelectedClientId(list[0].id)
  }, [selectedClientId])

  const fetchPosts = useCallback(async (clientId: string) => {
    const res = await fetch(`/api/clients/${clientId}/posts`)
    const d = await res.json()
    setPosts(d.posts ?? [])
  }, [])

  const fetchAssets = useCallback(async (clientId: string) => {
    const res = await fetch(`/api/visual/assets?client_id=${clientId}`)
    const d = await res.json()
    setAssets(d.assets ?? [])
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => {
    if (selectedClientId) {
      fetchPosts(selectedClientId)
      fetchAssets(selectedClientId)
    }
  }, [selectedClientId, fetchPosts, fetchAssets])
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // ── Patch post ─────────────────────────────────────────────────────────────

  const patchPost = useCallback(async (postId: string, fields: Record<string, unknown>) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...fields } as Post : p))
    await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }, [])

  // ── Generation ─────────────────────────────────────────────────────────────

  const patchGen = useCallback((postId: string, patch: Partial<GenState>) => {
    setGenStates(prev => ({
      ...prev,
      [postId]: { ...({ generating: false, elapsed: 0 }), ...prev[postId], ...patch },
    }))
  }, [])

  const stopTimers = useCallback((postId: string) => {
    clearInterval(pollingRefs.current[postId])
    clearInterval(elapsedRefs.current[postId])
    delete pollingRefs.current[postId]
    delete elapsedRefs.current[postId]
  }, [])

  const pollStatus = useCallback(async (postId: string, assetId: string) => {
    try {
      const res = await fetch(`/api/visual/status/${assetId}`)
      const d = await res.json()
      if (d.status === 'ready') {
        stopTimers(postId)
        patchGen(postId, { generating: false, genStatus: 'ready' })
        if (selectedClientId) fetchAssets(selectedClientId)
      } else if (d.status === 'failed') {
        stopTimers(postId)
        patchGen(postId, { generating: false, genStatus: 'failed' })
      }
    } catch { /* ignore transient errors */ }
  }, [stopTimers, patchGen, selectedClientId, fetchAssets])

  const handleGenerate = useCallback(async (post: Post) => {
    const assetType = assetTypeFromFormat(post.format)
    const apiPath = assetType === 'video' ? '/api/visual/video' : '/api/visual/image'

    patchGen(post.id, { generating: true, elapsed: 0 })

    let elapsed = 0
    elapsedRefs.current[post.id] = setInterval(() => {
      elapsed++
      patchGen(post.id, { elapsed })
    }, 1000)

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: post.id,
          client_id: selectedClientId,
          variant: 1,
          aspect_ratio: post.ratio ?? '1:1',
        }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      patchGen(post.id, { assetId: d.asset_id })
      pollingRefs.current[post.id] = setInterval(() => pollStatus(post.id, d.asset_id), 5000)
    } catch (e) {
      stopTimers(post.id)
      patchGen(post.id, { generating: false, genStatus: 'failed' })
      setToast({ type: 'error', message: `Generation failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [selectedClientId, patchGen, stopTimers, pollStatus])

  // ── Publer ─────────────────────────────────────────────────────────────────

  const openPubModal = useCallback(async (assetId: string, postId: string) => {
    setPubModal({ assetId, postId })
    const res = await fetch(`/api/publer/draft/${assetId}`)
    const d = await res.json()
    setPublerAccounts(d.accounts ?? [])
    const post = posts.find(p => p.id === postId)
    setScheduleForm({
      account_id: '',
      scheduled_at: post?.scheduled_at ? toDatetimeLocal(post.scheduled_at) : '',
      caption: d.caption ?? post?.caption ?? '',
    })
  }, [posts])

  const handleSchedule = useCallback(async () => {
    if (!pubModal || !scheduleForm.account_id) return
    setScheduleLoading(true)
    try {
      const res = await fetch('/api/publer/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: pubModal.assetId,
          account_id: scheduleForm.account_id,
          scheduled_at: fromDatetimeLocal(scheduleForm.scheduled_at),
          caption: scheduleForm.caption,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setToast({ type: 'success', message: 'Scheduled! Job: ' + d.job_id })
        setPubModal(null)
      } else {
        setToast({ type: 'error', message: 'Error: ' + d.error })
      }
    } finally {
      setScheduleLoading(false)
    }
  }, [pubModal, scheduleForm])

  // ── Sync ───────────────────────────────────────────────────────────────────

  const handleSync = useCallback(async () => {
    if (!selectedClientId) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/airtable/pull-content?client_id=${selectedClientId}`)
      const d = await res.json()
      if (d.success) {
        await fetchPosts(selectedClientId)
        setToast({ type: 'success', message: `Synced: +${d.created} new, ~${d.updated} updated` })
      } else {
        setToast({ type: 'error', message: 'Sync failed: ' + d.error })
      }
    } finally { setSyncing(false) }
  }, [selectedClientId, fetchPosts])

  // ── Derived ────────────────────────────────────────────────────────────────

  const readyAssetByPost = assets.reduce<Record<string, VisualAsset>>((acc, a) => {
    if (a.generation_status === 'ready' && a.post_id && !acc[a.post_id]) acc[a.post_id] = a
    return acc
  }, {})

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <h1 className="text-sm font-semibold text-gray-700 mr-1">Content Workbench</h1>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
        >
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={handleSync}
          disabled={!selectedClientId || syncing}
          className="text-sm px-3 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : '↓ Sync Airtable'}
        </button>
        <span className="text-xs text-gray-400 ml-auto hidden md:block">
          {posts.length} posts · Click any cell to edit · Auto-saves to Supabase + Airtable
        </span>
      </div>

      {/* Table */}
      {selectedClientId ? (
        <div className="flex-1 overflow-auto">
          <table className="border-collapse bg-white text-sm" style={{ minWidth: 1280, width: '100%' }}>
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="text-xs text-gray-500 uppercase tracking-wide">
                <th className="w-9 px-2 py-2 text-left font-medium border-b border-r border-gray-200">#</th>
                <th className="w-24 px-2 py-2 text-left font-medium border-b border-r border-gray-200">Status</th>
                <th className="w-[90px] px-2 py-2 text-left font-medium border-b border-r border-gray-200">Format</th>
                <th className="w-16 px-2 py-2 text-left font-medium border-b border-r border-gray-200">Platform</th>
                <th className="w-36 px-2 py-2 text-left font-medium border-b border-r border-gray-200">Date (NZT)</th>
                <th className="min-w-[160px] px-2 py-2 text-left font-medium border-b border-r border-gray-200">Headline</th>
                <th className="min-w-[200px] px-2 py-2 text-left font-medium border-b border-r border-gray-200">Caption</th>
                <th className="min-w-[200px] px-2 py-2 text-left font-medium border-b border-r border-gray-200">Prompt</th>
                <th className="min-w-[140px] px-2 py-2 text-left font-medium border-b border-r border-gray-200">Hashtags</th>
                <th className="w-24 px-2 py-2 text-center font-medium border-b border-gray-200">Asset</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post, idx) => (
                <tr key={post.id} className="border-b border-gray-100 hover:bg-gray-50/70 align-top group">

                  {/* # */}
                  <td className="px-2 py-1.5 text-gray-400 text-xs border-r border-gray-100">{idx + 1}</td>

                  {/* Status */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableStatus value={post.status} onSave={v => patchPost(post.id, { status: v })} />
                  </td>

                  {/* Format */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableFormat
                      value={post.format}
                      onSave={v => patchPost(post.id, { format: v })}
                    />
                    {post.ratio && <div className="text-[10px] text-gray-400 mt-0.5">{post.ratio}</div>}
                  </td>

                  {/* Platform */}
                  <td className="px-2 py-1.5 border-r border-gray-100 relative">
                    <EditablePlatforms
                      value={post.platforms}
                      onSave={v => patchPost(post.id, { platforms: v })}
                    />
                  </td>

                  {/* Date */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableDatetime
                      value={post.scheduled_at}
                      onSave={v => patchPost(post.id, { scheduled_at: v })}
                    />
                  </td>

                  {/* Headline */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableText
                      value={post.title}
                      onSave={v => patchPost(post.id, { title: v })}
                      placeholder="Headline…"
                    />
                  </td>

                  {/* Caption */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableTextarea
                      value={post.caption}
                      onSave={v => patchPost(post.id, { caption: v })}
                      placeholder="Caption…"
                    />
                  </td>

                  {/* Prompt */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableTextarea
                      value={post.visual_brief}
                      onSave={v => patchPost(post.id, { visual_brief: v })}
                      placeholder="Image / video prompt…"
                    />
                  </td>

                  {/* Hashtags */}
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <EditableHashtags
                      value={post.hashtags}
                      onSave={v => patchPost(post.id, { hashtags: v })}
                    />
                  </td>

                  {/* Asset */}
                  <td className="px-2 py-1.5 text-center">
                    <AssetCell
                      post={post}
                      genState={genStates[post.id]}
                      readyAsset={readyAssetByPost[post.id]}
                      onGenerate={() => handleGenerate(post)}
                      onSchedule={assetId => openPubModal(assetId, post.id)}
                    />
                  </td>
                </tr>
              ))}

              {posts.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-20 text-gray-400 text-sm">
                    No posts found — sync from Airtable to get started
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          Select a client to view their content
        </div>
      )}

      {/* Publer modal */}
      {pubModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-base font-semibold mb-4">Schedule to Publer</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Account</label>
                <select
                  value={scheduleForm.account_id}
                  onChange={e => setScheduleForm(f => ({ ...f, account_id: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Select account…</option>
                  {publerAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Schedule Time (NZT)</label>
                <input
                  type="datetime-local"
                  value={scheduleForm.scheduled_at}
                  onChange={e => setScheduleForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Caption</label>
                <textarea
                  value={scheduleForm.caption}
                  onChange={e => setScheduleForm(f => ({ ...f, caption: e.target.value }))}
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setPubModal(null)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!scheduleForm.account_id || scheduleLoading}
                className="px-3 py-1.5 text-sm bg-green-500 text-white rounded disabled:opacity-50 hover:bg-green-600 flex items-center gap-2"
              >
                {scheduleLoading ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  'Schedule'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-40 animate-in fade-in-0 slide-in-from-bottom-4 ${
          toast.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          <span className="text-sm">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-current hover:opacity-70"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
