'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Client { id: string; name: string }

interface ContentPost {
  id: string;
  title: string;
  visual_brief?: string;
  caption?: string;
  hashtags?: string;
  platforms?: string | string[];
  scheduled_at?: string;
  format?: string;
  ratio?: string;
}

interface VisualAsset {
  id: string;
  asset_type: string;
  generation_status: string;
  storage_url?: string;
  cost_usd?: number;
  created_at: string;
  prompt_used?: string;
  post_id?: string;
}

interface PublerAccount { id: string; provider: string; name: string; picture?: string }
interface PublerDraft {
  asset: VisualAsset;
  caption: string;
  hashtags: string;
  accounts: PublerAccount[];
}

interface PostState {
  generating: boolean;
  elapsed: number;
  promptOverride: string;
  showPromptEdit: boolean;
  result?: { asset_id: string; status: string; url?: string };
}

// ── helpers ────────────────────────────────────────────────────────────────

const VIDEO_FORMATS = ['reel', 'video'];
function assetTypeFromFormat(format?: string): 'image' | 'video' {
  return VIDEO_FORMATS.includes((format ?? '').toLowerCase()) ? 'video' : 'image';
}

const RATIO_DIMS: Record<string, { w: number; h: number }> = {
  '9:16': { w: 1024, h: 1792 },
  '4:5':  { w: 1024, h: 1280 },
  '1:1':  { w: 1024, h: 1024 },
  '16:9': { w: 1792, h: 1024 },
};

const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📷', tiktok: '🎵', linkedin: '💼', twitter: '🐦',
};

const FORMAT_COLORS: Record<string, string> = {
  reel:     'bg-purple-100 text-purple-700',
  video:    'bg-blue-100 text-blue-700',
  feed:     'bg-green-100 text-green-700',
  image:    'bg-orange-100 text-orange-700',
  story:    'bg-pink-100 text-pink-700',
  carousel: 'bg-yellow-100 text-yellow-700',
};

// ── sub-components ─────────────────────────────────────────────────────────

function GeneratingStatus({ elapsed, type }: { elapsed: number; type: 'image' | 'video' }) {
  const stages = type === 'image'
    ? [
        { until: 5,        icon: '📤', label: 'Submitting to AI...' },
        { until: 15,       icon: '🎨', label: 'AI is painting your image...' },
        { until: 30,       icon: '🖼️', label: 'Refining details...' },
        { until: 50,       icon: '⬆️', label: 'Uploading to storage...' },
        { until: Infinity, icon: '⏳', label: 'Almost done, hang tight...' },
      ]
    : [
        { until: 10,       icon: '📤', label: 'Submitting to AI...' },
        { until: 40,       icon: '🎬', label: 'AI is generating frames...' },
        { until: 80,       icon: '🎞️', label: 'Encoding video...' },
        { until: 120,      icon: '⬆️', label: 'Uploading to storage...' },
        { until: Infinity, icon: '⏳', label: 'Still working, please wait...' },
      ];

  const stage = stages.find(s => elapsed < s.until)!;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-yellow-800 text-xs font-medium">
          <span className="animate-spin w-3 h-3 border-2 border-yellow-600 border-t-transparent rounded-full inline-block" />
          {stage.icon} {stage.label}
        </div>
        <span className="text-xs text-yellow-600 font-mono tabular-nums">{timeStr}</span>
      </div>
      <div className="w-full bg-yellow-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all duration-1000"
          style={{ width: `${Math.min(95, (elapsed / (type === 'image' ? 50 : 120)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function WorkbenchCard({
  post,
  state,
  readyAsset,
  onGenerate,
  onOpenPubler,
  onStateChange,
}: {
  post: ContentPost;
  state: PostState;
  readyAsset?: VisualAsset;
  onGenerate: (post: ContentPost) => void;
  onOpenPubler: (asset: VisualAsset) => void;
  onStateChange: (patch: Partial<PostState>) => void;
}) {
  const assetType = assetTypeFromFormat(post.format);
  const platforms = Array.isArray(post.platforms)
    ? post.platforms
    : post.platforms ? [post.platforms] : [];
  const fmtKey = (post.format ?? '').toLowerCase();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{post.title}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {platforms.map(p => (
              <span key={p} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                {PLATFORM_ICONS[p.toLowerCase()] ?? '🌐'} {p}
              </span>
            ))}
            {post.format && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${FORMAT_COLORS[fmtKey] ?? 'bg-gray-100 text-gray-600'}`}>
                {post.format}
              </span>
            )}
            {post.ratio && <span className="text-xs text-gray-400">{post.ratio}</span>}
            {post.scheduled_at && (
              <span className="text-xs text-gray-400">
                📅 {new Date(post.scheduled_at).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 font-medium ${assetType === 'video' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
          {assetType === 'video' ? '🎬 Video' : '🖼️ Image'}
        </span>
      </div>

      {/* Caption */}
      {post.caption && (
        <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">{post.caption}</p>
      )}

      {/* Prompt / visual brief */}
      {post.visual_brief && (
        <div>
          {state.showPromptEdit ? (
            <div className="space-y-1.5">
              <textarea
                rows={3}
                value={state.promptOverride !== '' ? state.promptOverride : post.visual_brief}
                onChange={e => onStateChange({ promptOverride: e.target.value })}
                className="w-full border border-indigo-300 rounded-lg px-2 py-1.5 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={() => onStateChange({ showPromptEdit: false })}
                className="text-xs text-indigo-500 hover:text-indigo-700"
              >
                ▲ Collapse
              </button>
            </div>
          ) : (
            <button
              onClick={() => onStateChange({ showPromptEdit: true })}
              className="w-full text-left"
            >
              <p className="text-xs text-indigo-500 italic line-clamp-1 hover:line-clamp-none transition-all">
                🎨 {state.promptOverride || post.visual_brief}
              </p>
            </button>
          )}
        </div>
      )}

      {/* Generation progress */}
      {state.generating && <GeneratingStatus elapsed={state.elapsed} type={assetType} />}

      {/* Ready image preview */}
      {!state.generating && state.result?.status === 'ready' && state.result.url && assetType === 'image' && (
        <img src={state.result.url} alt="Generated" className="rounded-lg w-full object-cover max-h-52" />
      )}
      {!state.generating && state.result?.status === 'ready' && assetType === 'video' && (
        <p className="text-xs text-green-600 font-medium">✅ Video ready</p>
      )}
      {!state.generating && state.result?.status === 'failed' && (
        <p className="text-xs text-red-500">❌ Generation failed</p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        {readyAsset ? (
          <>
            <button
              onClick={() => onOpenPubler(readyAsset)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 rounded-lg font-medium"
            >
              📅 Schedule to Publer
            </button>
            <button
              onClick={() => onGenerate(post)}
              disabled={state.generating}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              ↺ Regen
            </button>
          </>
        ) : (
          <button
            onClick={() => onGenerate(post)}
            disabled={state.generating}
            className="flex-1 bg-gray-800 hover:bg-gray-900 text-white text-xs py-2 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {state.generating ? (
              <>
                <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                {state.elapsed}s
              </>
            ) : (
              assetType === 'video' ? '🎬 Generate Video' : '🖼️ Generate Image'
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

export default function VisualsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // Per-post state
  const [postStates, setPostStates] = useState<Record<string, PostState>>({});
  const pollingRefs = useRef<Record<string, NodeJS.Timeout>>({});
  const elapsedRefs = useRef<Record<string, NodeJS.Timeout>>({});

  // Airtable sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; updated: number; created: number } | null>(null);
  const [syncError, setSyncError] = useState('');

  // Publer modal
  const [publerDraft, setPublerDraft] = useState<PublerDraft | null>(null);
  const [publerAccountId, setPublerAccountId] = useState('');
  const [publerScheduledAt, setPublerScheduledAt] = useState('');
  const [publerCaption, setPublerCaption] = useState('');
  const [publerSending, setPublerSending] = useState(false);
  const [publerError, setPublerError] = useState('');
  const [publerSuccess, setPublerSuccess] = useState('');
  const [publerLoading, setPublerLoading] = useState(false);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/visual/assets');
      const json = await res.json();
      setAssets(json.assets ?? []);
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  const fetchPosts = useCallback(async (clientId: string) => {
    setLoadingPosts(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/posts`);
      const json = await res.json();
      setPosts(json.posts ?? []);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list = d.clients ?? [];
      setClients(list);
      if (list.length === 1) {
        setSelectedClientId(list[0].id);
      }
    });
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    if (!selectedClientId) return;
    fetchPosts(selectedClientId);
  }, [selectedClientId, fetchPosts]);

  // Helper: update one post's state
  const patchPostState = useCallback((postId: string, patch: Partial<PostState>) => {
    setPostStates(prev => ({
      ...prev,
      [postId]: { ...({ generating: false, elapsed: 0, promptOverride: '', showPromptEdit: false }), ...prev[postId], ...patch },
    }));
  }, []);

  // Poll a single post's asset status
  const pollPostStatus = useCallback(async (postId: string, assetId: string, type: 'image' | 'video') => {
    try {
      const res = await fetch(`/api/visual/status/${assetId}`);
      const json = await res.json();
      const status = json.asset?.generation_status ?? json.status;
      const url = json.asset?.storage_url ?? json.storage_url;

      if (status === 'ready' || status === 'failed') {
        clearInterval(pollingRefs.current[postId]);
        clearInterval(elapsedRefs.current[postId]);
        patchPostState(postId, { generating: false, result: { asset_id: assetId, status, url } });
        fetchAssets();
      } else {
        patchPostState(postId, { result: { asset_id: assetId, status } });
      }
    } catch {
      clearInterval(pollingRefs.current[postId]);
      clearInterval(elapsedRefs.current[postId]);
      patchPostState(postId, { generating: false });
    }
  }, [patchPostState, fetchAssets]);

  const handleGenerate = useCallback(async (post: ContentPost) => {
    const type = assetTypeFromFormat(post.format);
    const ratio = post.ratio ?? '1:1';
    const { w, h } = RATIO_DIMS[ratio] ?? { w: 1024, h: 1024 };
    const promptOverride = postStates[post.id]?.promptOverride || '';

    patchPostState(post.id, { generating: true, elapsed: 0, result: undefined });

    // Start elapsed counter
    if (elapsedRefs.current[post.id]) clearInterval(elapsedRefs.current[post.id]);
    elapsedRefs.current[post.id] = setInterval(() => {
      setPostStates(prev => ({
        ...prev,
        [post.id]: { ...prev[post.id], elapsed: (prev[post.id]?.elapsed ?? 0) + 1 },
      }));
    }, 1000);

    try {
      const endpoint = type === 'video' ? '/api/visual/video' : '/api/visual/image';
      const body = type === 'video'
        ? { post_id: post.id, client_id: selectedClientId, duration: 5, aspect_ratio: ratio }
        : { post_id: post.id, client_id: selectedClientId, variant: 1, prompt_override: promptOverride || undefined, aspect_ratio: ratio, width: w, height: h };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');

      const assetId = json.asset_id;
      patchPostState(post.id, { result: { asset_id: assetId, status: 'generating' } });

      if (pollingRefs.current[post.id]) clearInterval(pollingRefs.current[post.id]);
      const interval = type === 'video' ? 5000 : 3000;
      pollingRefs.current[post.id] = setInterval(() => pollPostStatus(post.id, assetId, type), interval);
    } catch (err: unknown) {
      clearInterval(elapsedRefs.current[post.id]);
      patchPostState(post.id, { generating: false, result: { asset_id: '', status: 'failed' } });
      console.error('Generate error:', err);
    }
  }, [postStates, selectedClientId, patchPostState, pollPostStatus]);

  // Airtable sync
  const handleSyncFromAirtable = async () => {
    if (!selectedClientId) { setSyncError('Select a client first'); return; }
    setSyncing(true); setSyncError(''); setSyncResult(null);
    try {
      const res = await fetch(`/api/airtable/pull-content?client_id=${selectedClientId}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Sync failed');
      setSyncResult({ total: json.total, updated: json.updated, created: json.created });
      fetchPosts(selectedClientId);
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncing(false);
    }
  };

  // Publer modal
  const openPublerModal = async (asset: VisualAsset) => {
    setPublerLoading(true); setPublerError(''); setPublerSuccess(''); setPublerDraft(null);
    try {
      const res = await fetch(`/api/publer/draft/${asset.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load Publer data');
      setPublerDraft({ asset, caption: json.caption ?? '', hashtags: json.hashtags ?? '', accounts: json.accounts ?? [] });
      const combined = [json.caption, json.hashtags].filter(Boolean).join('\n\n');
      setPublerCaption(combined);
      setPublerAccountId(json.accounts?.[0]?.id ?? '');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const offset = tomorrow.getTimezoneOffset();
      const local = new Date(tomorrow.getTime() - offset * 60000);
      setPublerScheduledAt(local.toISOString().slice(0, 16));
    } catch (err: unknown) {
      setPublerError(err instanceof Error ? err.message : 'Failed');
      setPublerDraft({ asset, caption: '', hashtags: '', accounts: [] });
    } finally {
      setPublerLoading(false);
    }
  };

  const handlePublerSubmit = async () => {
    if (!publerDraft || !publerAccountId || !publerScheduledAt) return;
    setPublerSending(true); setPublerError('');
    try {
      const res = await fetch('/api/publer/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: publerDraft.asset.id,
          account_id: publerAccountId,
          scheduled_at: new Date(publerScheduledAt).toISOString(),
          caption: publerCaption,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setPublerSuccess(`Scheduled! Publer job: ${json.job_id}`);
    } catch (err: unknown) {
      setPublerError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPublerSending(false);
    }
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      generating: 'bg-yellow-100 text-yellow-700',
      ready: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>;
  };

  // Find the most recent ready asset per post
  const readyAssetByPost = assets.reduce<Record<string, VisualAsset>>((acc, a) => {
    if (a.generation_status === 'ready' && a.post_id && !acc[a.post_id]) {
      acc[a.post_id] = a;
    }
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Visuals</h1>
          <p className="text-sm text-gray-500 mt-1">Content workbench — generate & schedule visuals</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleSyncFromAirtable}
            disabled={syncing || !selectedClientId}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {syncing
              ? <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Syncing...</>
              : '🔄 Sync from Airtable'}
          </button>
          {syncResult && (
            <p className="text-xs text-green-700">✅ {syncResult.total} records — {syncResult.updated} updated, {syncResult.created} new</p>
          )}
          {syncError && <p className="text-xs text-red-600">{syncError}</p>}
        </div>
      </div>

      {/* Client selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Client</label>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white min-w-[200px]"
        >
          <option value="">— Select client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {posts.length > 0 && (
          <span className="text-xs text-gray-500">{posts.length} posts ready</span>
        )}
      </div>

      {/* Content Workbench */}
      {selectedClientId && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Content Workbench</h2>
          {loadingPosts ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading posts...</div>
          ) : posts.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">
              No posts yet. Click &quot;Sync from Airtable&quot; to pull ready content.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {posts.map(post => (
                <WorkbenchCard
                  key={post.id}
                  post={post}
                  state={postStates[post.id] ?? { generating: false, elapsed: 0, promptOverride: '', showPromptEdit: false }}
                  readyAsset={readyAssetByPost[post.id]}
                  onGenerate={handleGenerate}
                  onOpenPubler={openPublerModal}
                  onStateChange={patch => patchPostState(post.id, patch)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generation History */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Generation History</h2>
        </div>
        {loadingAssets ? (
          <div className="py-10 text-center text-gray-400 text-sm">Loading...</div>
        ) : assets.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No visual assets yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Preview</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Cost</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Created</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assets.slice(0, 20).map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm capitalize text-gray-700">{asset.asset_type}</td>
                    <td className="px-5 py-3">
                      {asset.generation_status === 'ready' && asset.storage_url ? (
                        asset.asset_type === 'image'
                          ? <img src={asset.storage_url} alt="Visual" className="w-16 h-12 object-cover rounded" />
                          : <a href={asset.storage_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline">▶ View</a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">{statusBadge(asset.generation_status)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600 text-right">
                      {asset.cost_usd != null ? `$${asset.cost_usd.toFixed(3)}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400">
                      {new Date(asset.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      {asset.generation_status === 'ready' && (
                        <button
                          onClick={() => openPublerModal(asset)}
                          className="text-xs border border-blue-300 text-blue-600 px-2 py-1 rounded hover:bg-blue-50 whitespace-nowrap"
                        >
                          📅 Publer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Publer Schedule Modal */}
      {publerDraft && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📅</span>
                <h3 className="font-semibold text-gray-900">Schedule to Publer</h3>
              </div>
              <button onClick={() => setPublerDraft(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                {publerDraft.asset.asset_type === 'image' && publerDraft.asset.storage_url ? (
                  <img src={publerDraft.asset.storage_url} alt="" className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0 text-2xl">
                    {publerDraft.asset.asset_type === 'video' ? '🎬' : '🖼️'}
                  </div>
                )}
                <div className="text-xs text-gray-500 line-clamp-3">{publerDraft.asset.prompt_used ?? `${publerDraft.asset.asset_type} asset`}</div>
              </div>
              {publerLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <span className="animate-spin w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full inline-block" />
                  Loading accounts...
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">① Publer Account</label>
                    {publerDraft.accounts.length === 0 ? (
                      <p className="text-xs text-red-500">No Publer accounts found.</p>
                    ) : (
                      <select
                        value={publerAccountId}
                        onChange={e => setPublerAccountId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {publerDraft.accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.provider.charAt(0).toUpperCase() + acc.provider.slice(1)} — {acc.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">② Schedule Time (local)</label>
                    <input
                      type="datetime-local"
                      value={publerScheduledAt}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={e => setPublerScheduledAt(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">③ Caption</label>
                    <textarea
                      rows={5}
                      value={publerCaption}
                      onChange={e => setPublerCaption(e.target.value)}
                      placeholder="Caption auto-filled from content post..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </>
              )}
              {publerError && <p className="text-xs text-red-600">{publerError}</p>}
              {publerSuccess && <p className="text-xs text-green-600 font-medium">✅ {publerSuccess}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setPublerDraft(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              {!publerSuccess && (
                <button
                  onClick={handlePublerSubmit}
                  disabled={publerSending || publerLoading || !publerAccountId || !publerScheduledAt}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {publerSending
                    ? <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Uploading & Scheduling...</>
                    : 'Schedule Post'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
