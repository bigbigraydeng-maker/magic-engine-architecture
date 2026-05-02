'use client'

/**
 * Reels Studio Tab — two-column layout
 *
 * Left  (7 cols): draft list + active draft editor (4 editable fields + frame uploads + video)
 * Right (5 cols): AI chat panel for field-level refinement
 *
 * Reference: ROADMAP.md P8.R.6
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReeelsDraft {
  id: string
  status: 'draft' | 'images_ready' | 'video_generating' | 'video_ready'
  opening_frame_prompt: string | null
  closing_frame_prompt: string | null
  i2v_video_prompt: string | null
  fb_caption: string | null
  opening_frame_url: string | null
  closing_frame_url: string | null
  video_url: string | null
  chat_history: Array<{ role: 'user' | 'assistant'; content: string }>
  campaign_brief_id: string | null
  created_at: string
}

interface CampaignBrief {
  id: string
  name: string
  status: string
}

interface Props {
  clientId: string
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ReeelsDraft['status'], string> = {
  draft: 'Draft',
  images_ready: 'Frames Ready',
  video_generating: 'Generating…',
  video_ready: 'Video Ready ✓',
}

const STATUS_COLORS: Record<ReeelsDraft['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  images_ready: 'bg-blue-100 text-blue-700',
  video_generating: 'bg-amber-100 text-amber-700',
  video_ready: 'bg-green-100 text-green-700',
}

// ─── Field labels ──────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  opening_frame_prompt: '🖼️ Opening Frame Prompt',
  closing_frame_prompt: '🖼️ Closing Frame Prompt',
  i2v_video_prompt: '🎬 Video Prompt (I2V)',
  fb_caption: '📝 Facebook Caption',
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ReelsStudio({ clientId }: Props) {
  const [drafts, setDrafts] = useState<ReeelsDraft[]>([])
  const [activeDraft, setActiveDraft] = useState<ReeelsDraft | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')

  const [generating, setGenerating] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null)

  // Chat state
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Frame upload state
  const [uploadingFrame, setUploadingFrame] = useState<'opening' | 'closing' | null>(null)
  const openingFileRef = useRef<HTMLInputElement>(null)
  const closingFileRef = useRef<HTMLInputElement>(null)

  // Video generation
  const [generatingVideo, setGeneratingVideo] = useState(false)
  const [pollingVideo, setPollingVideo] = useState(false)

  // ─── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchDrafts = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/reels`)
    if (res.ok) {
      const { drafts: list } = await res.json()
      setDrafts(list ?? [])
    }
  }, [clientId])

  const fetchCampaigns = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
    if (res.ok) {
      const { campaigns: list } = await res.json()
      setCampaigns(list ?? [])
    }
  }, [clientId])

  useEffect(() => {
    fetchDrafts()
    fetchCampaigns()
  }, [fetchDrafts, fetchCampaigns])

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeDraft?.chat_history])

  // Poll video status while generating
  useEffect(() => {
    if (!activeDraft || activeDraft.status !== 'video_generating' || pollingVideo) return

    setPollingVideo(true)

    const interval = setInterval(async () => {
      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/video-status`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'completed' && data.video_url) {
          clearInterval(interval)
          setPollingVideo(false)
          setActiveDraft(prev =>
            prev ? { ...prev, status: 'video_ready', video_url: data.video_url } : prev
          )
          setDrafts(prev =>
            prev.map(d =>
              d.id === activeDraft.id
                ? { ...d, status: 'video_ready', video_url: data.video_url }
                : d
            )
          )
        } else if (data.status === 'failed') {
          clearInterval(interval)
          setPollingVideo(false)
          setActiveDraft(prev => prev ? { ...prev, status: 'images_ready' } : prev)
        }
      }
    }, 8000)

    return () => clearInterval(interval)
  }, [activeDraft?.status, activeDraft?.id, clientId, pollingVideo])

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/reels/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_brief_id: selectedCampaignId || undefined }),
      })
      let data: { success: boolean; draft?: ReeelsDraft; error?: string }
      try {
        data = await res.json()
      } catch {
        alert(`Server error (${res.status}): the API returned a non-JSON response. Check server logs.`)
        return
      }
      if (data.success && data.draft) {
        setDrafts(prev => [data.draft!, ...prev])
        setActiveDraft(data.draft!)
      } else {
        alert(data.error ?? 'Generation failed')
      }
    } catch (err) {
      alert(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleFieldSave = async (field: string, value: string) => {
    if (!activeDraft) return
    setSavingField(field)
    try {
      const res = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await res.json()
      if (data.success) {
        setActiveDraft(data.draft)
        setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft : d))
      }
    } finally {
      setSavingField(null)
    }
  }

  const handleChat = async () => {
    if (!activeDraft || !chatInput.trim() || chatLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatLoading(true)

    // Optimistic: append user message immediately
    setActiveDraft(prev => prev ? {
      ...prev,
      chat_history: [...(prev.chat_history ?? []), { role: 'user', content: msg }],
    } : prev)

    try {
      const res = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      let data: { success: boolean; draft?: ReeelsDraft; error?: string }
      try {
        data = await res.json()
      } catch {
        alert(`Server error (${res.status}): non-JSON response from refine API.`)
        return
      }
      if (data.success && data.draft) {
        setActiveDraft(data.draft)
        setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft! : d))
      } else {
        alert(data.error ?? 'Refinement failed')
      }
    } catch (err) {
      alert(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChatLoading(false)
    }
  }

  const handleFrameUpload = async (frameType: 'opening' | 'closing', file: File) => {
    if (!activeDraft) return
    setUploadingFrame(frameType)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('frame_type', frameType)

      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/upload-frame`,
        { method: 'POST', body: formData }
      )
      const data = await res.json()
      if (data.success) {
        // Reload draft to get updated URL + status
        const draftRes = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}`)
        if (draftRes.ok) {
          const { draft } = await draftRes.json()
          setActiveDraft(draft)
          setDrafts(prev => prev.map(d => d.id === activeDraft.id ? draft : d))
        }
      } else {
        alert(data.error ?? 'Upload failed')
      }
    } finally {
      setUploadingFrame(null)
    }
  }

  const handleGenerateVideo = async () => {
    if (!activeDraft) return
    setGeneratingVideo(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/generate-video`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (data.success) {
        setActiveDraft(prev => prev ? { ...prev, status: 'video_generating' } : prev)
        setDrafts(prev =>
          prev.map(d => d.id === activeDraft?.id ? { ...d, status: 'video_generating' } : d)
        )
      } else {
        alert(data.error ?? 'Video generation failed')
      }
    } finally {
      setGeneratingVideo(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header: campaign selector + generate button */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-900">🎬 Reels Studio</p>
          <p className="text-xs text-gray-500 mt-0.5">
            AI-generated Reels prompts → reference frames → Video Studio
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {campaigns.length > 0 && (
            <select
              value={selectedCampaignId}
              onChange={e => setSelectedCampaignId(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">No campaign (brief only)</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {generating ? (
              <>
                <span className="animate-spin text-base">⏳</span> Generating…
              </>
            ) : (
              '✨ Generate New Reel'
            )}
          </button>
        </div>
      </div>

      {drafts.length === 0 && !generating ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 py-16 flex flex-col items-center gap-3">
          <p className="text-3xl">🎬</p>
          <p className="text-sm font-medium text-gray-700">No Reels yet</p>
          <p className="text-xs text-gray-400">Click &ldquo;Generate New Reel&rdquo; to get started</p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Draft list — narrow sidebar */}
          <div className="w-56 flex-shrink-0 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
              Drafts
            </p>
            {drafts.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDraft(d)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  activeDraft?.id === d.id
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-indigo-200'
                }`}
              >
                <p className="text-xs font-medium text-gray-800 truncate">
                  {d.fb_caption
                    ? d.fb_caption.slice(0, 40) + '…'
                    : `Reel ${new Date(d.created_at).toLocaleDateString()}`}
                </p>
                <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[d.status]}`}>
                  {STATUS_LABELS[d.status]}
                </span>
              </button>
            ))}
          </div>

          {/* Main editor + chat */}
          {activeDraft ? (
            <div className="flex-1 min-w-0 flex gap-4">
              {/* Left: editable fields + frames + video */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Four editable fields */}
                {(
                  [
                    'opening_frame_prompt',
                    'closing_frame_prompt',
                    'i2v_video_prompt',
                    'fb_caption',
                  ] as const
                ).map(field => (
                  <EditableField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={activeDraft[field] ?? ''}
                    saving={savingField === field}
                    rows={field === 'fb_caption' ? 5 : field === 'i2v_video_prompt' ? 4 : 3}
                    onSave={val => handleFieldSave(field, val)}
                  />
                ))}

                {/* Reference frame uploads */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Reference Frames
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      Upload images generated in Loveart
                    </span>
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {(['opening', 'closing'] as const).map(type => {
                      const url = type === 'opening'
                        ? activeDraft.opening_frame_url
                        : activeDraft.closing_frame_url
                      const fileRef = type === 'opening' ? openingFileRef : closingFileRef

                      return (
                        <div key={type} className="space-y-2">
                          <p className="text-xs font-medium text-gray-600 capitalize">
                            {type} Frame
                          </p>
                          {url ? (
                            <div className="relative group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={`${type} frame`}
                                className="w-full aspect-[9/16] object-cover rounded-lg border border-gray-200"
                              />
                              <button
                                onClick={() => fileRef.current?.click()}
                                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center text-white text-xs font-medium"
                              >
                                Replace
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => fileRef.current?.click()}
                              disabled={uploadingFrame === type}
                              className="w-full aspect-[9/16] border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-indigo-400 transition-colors disabled:opacity-50"
                            >
                              {uploadingFrame === type ? (
                                <span className="text-xs text-gray-400 animate-pulse">Uploading…</span>
                              ) : (
                                <>
                                  <span className="text-2xl">📸</span>
                                  <span className="text-xs text-gray-400">Upload frame</span>
                                </>
                              )}
                            </button>
                          )}
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handleFrameUpload(type, file)
                              e.target.value = ''
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Video section */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">Video Studio</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[activeDraft.status]}`}>
                      {STATUS_LABELS[activeDraft.status]}
                    </span>
                  </div>

                  {activeDraft.status === 'video_ready' && activeDraft.video_url ? (
                    <div className="space-y-3">
                      <video
                        src={activeDraft.video_url}
                        controls
                        className="w-full max-w-xs rounded-lg border border-gray-200"
                      />
                      <a
                        href={activeDraft.video_url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        ↓ Download video
                      </a>
                    </div>
                  ) : activeDraft.status === 'video_generating' ? (
                    <div className="flex items-center gap-2 text-amber-600">
                      <span className="animate-spin text-base">⏳</span>
                      <span className="text-sm">Video Studio is generating your Reel…</span>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerateVideo}
                      disabled={
                        generatingVideo ||
                        !activeDraft.opening_frame_url ||
                        !activeDraft.closing_frame_url ||
                        !activeDraft.i2v_video_prompt
                      }
                      className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {generatingVideo ? 'Starting…' : '🎬 Generate Video'}
                    </button>
                  )}

                  {(!activeDraft.opening_frame_url || !activeDraft.closing_frame_url) && (
                    <p className="text-xs text-gray-400 mt-2">
                      Upload both reference frames to enable video generation.
                    </p>
                  )}
                </div>
              </div>

              {/* Right: chat panel */}
              <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">✏️ AI Refinement</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Ask Strategy Engine to change any field
                  </p>
                </div>

                {/* Chat history */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 max-h-[600px]">
                  {(!activeDraft.chat_history || activeDraft.chat_history.length === 0) ? (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-2">💬</p>
                      <p className="text-xs text-gray-400">
                        e.g. &ldquo;Change opening frame to show a Great Wall sunrise&rdquo;
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        &ldquo;Make the caption more playful&rdquo;
                      </p>
                    </div>
                  ) : (
                    activeDraft.chat_history.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 text-gray-400 text-xs rounded-xl px-3 py-2 animate-pulse">
                        Strategy Engine is thinking…
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div className="px-4 py-3 border-t border-gray-100">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleChat()
                        }
                      }}
                      placeholder="Change something…"
                      disabled={chatLoading}
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <button
                      onClick={handleChat}
                      disabled={chatLoading || !chatInput.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                    >
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-20 text-gray-400 text-sm">
              Select a draft to edit, or generate a new Reel ↑
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Editable field ────────────────────────────────────────────────────────────

interface EditableFieldProps {
  label: string
  value: string
  saving: boolean
  rows: number
  onSave: (value: string) => void
}

function EditableField({ label, value, saving, rows, onSave }: EditableFieldProps) {
  const [localValue, setLocalValue] = useState(value)
  const [dirty, setDirty] = useState(false)

  // Sync external updates (from chat refinement)
  useEffect(() => {
    setLocalValue(value)
    setDirty(false)
  }, [value])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-gray-700">{label}</label>
        {dirty && (
          <button
            onClick={() => { onSave(localValue); setDirty(false) }}
            disabled={saving}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <textarea
        value={localValue}
        rows={rows}
        onChange={e => {
          setLocalValue(e.target.value)
          setDirty(e.target.value !== value)
        }}
        onBlur={() => {
          if (dirty) {
            onSave(localValue)
            setDirty(false)
          }
        }}
        className="w-full text-xs text-gray-700 border-none outline-none resize-none leading-relaxed placeholder-gray-300"
        placeholder={`Enter ${label.toLowerCase()}…`}
      />
    </div>
  )
}
