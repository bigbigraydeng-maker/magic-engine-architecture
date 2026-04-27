'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Client {
  id: string;
  name: string;
}

interface ContentPost {
  id: string;
  title: string;
  visual_brief?: string;
}

interface VisualAsset {
  id: string;
  asset_type: string;
  generation_status: string;
  storage_url?: string;
  cost_usd?: number;
  created_at: string;
  prompt_used?: string;
}

// HeyGen is available if key is non-empty; server-side only, so default false on client
const HEYGEN_KEY = false;

export default function VisualsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [vidPosts, setVidPosts] = useState<ContentPost[]>([]);
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);

  // Image form
  const [imgClientId, setImgClientId] = useState('');
  const [imgPostId, setImgPostId] = useState('');
  const [imgAspectRatio, setImgAspectRatio] = useState('1:1');
  const [imgStyle, setImgStyle] = useState('photorealistic');
  const [imgPrompt, setImgPrompt] = useState('');
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgError, setImgError] = useState('');
  const [imgResult, setImgResult] = useState<{ asset_id: string; status?: string; url?: string } | null>(null);

  // Video form
  const [vidClientId, setVidClientId] = useState('');
  const [vidPostId, setVidPostId] = useState('');
  const [vidDuration, setVidDuration] = useState('5');
  const [vidAspectRatio, setVidAspectRatio] = useState('9:16');
  const [vidGenerating, setVidGenerating] = useState(false);
  const [vidError, setVidError] = useState('');
  const [vidResult, setVidResult] = useState<{ asset_id: string; status?: string; url?: string } | null>(null);

  const heygenConfigured = HEYGEN_KEY;
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const vidPollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/visual/assets');
      const json = await res.json();
      setAssets(json.assets ?? []);
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list = d.clients ?? [];
      setClients(list);
      // Auto-select only if exactly 1 client (unambiguous)
      if (list.length === 1) {
        setImgClientId(list[0].id);
        setVidClientId(list[0].id);
      }
    });
    fetchAssets();
  }, [fetchAssets]);

  // Load posts when image client changes
  useEffect(() => {
    if (!imgClientId) return;
    fetch(`/api/clients/${imgClientId}/posts`).then(r => r.json()).then(d => setPosts(d.posts ?? []));
  }, [imgClientId]);

  // Load posts when video client changes
  useEffect(() => {
    if (!vidClientId) return;
    fetch(`/api/clients/${vidClientId}/posts`).then(r => r.json()).then(d => setVidPosts(d.posts ?? []));
  }, [vidClientId]);

  // Auto-fill prompt from selected post
  useEffect(() => {
    const post = posts.find(p => p.id === imgPostId);
    if (post?.visual_brief) {
      const stylePrefix = imgStyle === 'photorealistic' ? 'Photorealistic, ' : imgStyle === 'illustration' ? 'Illustration style, ' : 'Minimal design, ';
      setImgPrompt(`${stylePrefix}${post.visual_brief}, aspect ratio ${imgAspectRatio}, high quality`);
    }
  }, [imgPostId, imgStyle, imgAspectRatio, posts]);

  // Poll image status
  const pollImageStatus = useCallback(async (assetId: string) => {
    try {
      const res = await fetch(`/api/visual/status/${assetId}`);
      const json = await res.json();
      const status = json.asset?.generation_status ?? json.status;
      const url = json.asset?.storage_url ?? json.storage_url;
      if (status === 'ready' || status === 'failed') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setImgResult({ asset_id: assetId, status, url });
        setImgGenerating(false);
        fetchAssets();
      } else {
        setImgResult(prev => prev ? { ...prev, status } : null);
      }
    } catch {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setImgGenerating(false);
    }
  }, [fetchAssets]);

  const handleImageGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPostId) { setImgError('Select a content post first'); return; }
    setImgGenerating(true);
    setImgError('');
    setImgResult(null);

    try {
      const res = await fetch('/api/visual/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: imgPostId, client_id: imgClientId, variant: 1 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setImgResult({ asset_id: json.asset_id, status: 'generating' });

      // Start polling
      pollingRef.current = setInterval(() => pollImageStatus(json.asset_id), 3000);
    } catch (err: unknown) {
      setImgError(err instanceof Error ? err.message : 'Unknown error');
      setImgGenerating(false);
    }
  };

  const pollVideoStatus = useCallback(async (assetId: string) => {
    try {
      const res = await fetch(`/api/visual/status/${assetId}`);
      const json = await res.json();
      const status = json.asset?.generation_status ?? json.status;
      const url = json.asset?.storage_url ?? json.storage_url;
      if (status === 'ready' || status === 'failed') {
        if (vidPollingRef.current) clearInterval(vidPollingRef.current);
        setVidResult({ asset_id: assetId, status, url });
        setVidGenerating(false);
        fetchAssets();
      } else {
        setVidResult(prev => prev ? { ...prev, status } : null);
      }
    } catch {
      if (vidPollingRef.current) clearInterval(vidPollingRef.current);
      setVidGenerating(false);
    }
  }, [fetchAssets]);

  const handleVideoGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vidPostId) { setVidError('Select a content post first'); return; }
    setVidGenerating(true);
    setVidError('');
    setVidResult(null);
    try {
      const res = await fetch('/api/visual/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: vidPostId, client_id: vidClientId, duration: parseInt(vidDuration), aspect_ratio: vidAspectRatio }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setVidResult({ asset_id: json.asset_id, status: 'generating' });
      vidPollingRef.current = setInterval(() => pollVideoStatus(json.asset_id), 5000);
    } catch (err: unknown) {
      setVidError(err instanceof Error ? err.message : 'Unknown error');
      setVidGenerating(false);
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Visuals</h1>
        <p className="text-sm text-gray-500 mt-1">Generate images, videos & avatar videos</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 7A — Image Generation */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🖼️</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Image Generation</h2>
              <p className="text-xs text-gray-500">Atlas Cloud Flux-dev · Available ✅</p>
            </div>
          </div>
          <form onSubmit={handleImageGenerate} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">① Client</label>
              <select
                value={imgClientId}
                onChange={(e) => { setImgClientId(e.target.value); setImgPostId(''); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">— Select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                ② Content Post
                {posts.length > 0 && imgClientId && (
                  <span className="ml-2 text-indigo-600 font-semibold">{posts.length} available ↓</span>
                )}
              </label>
              <select
                value={imgPostId}
                onChange={(e) => setImgPostId(e.target.value)}
                disabled={!imgClientId}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Select post (loads Visual Brief)...</option>
                {posts.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Aspect Ratio</label>
                <select
                  value={imgAspectRatio}
                  onChange={(e) => setImgAspectRatio(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="1:1">1:1 Square</option>
                  <option value="4:5">4:5 Portrait</option>
                  <option value="16:9">16:9 Landscape</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                <select
                  value={imgStyle}
                  onChange={(e) => setImgStyle(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="photorealistic">Photorealistic</option>
                  <option value="illustration">Illustration</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPromptEdit(!showPromptEdit)}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {showPromptEdit ? '▼' : '▶'} ✏️ Edit Prompt
            </button>

            {showPromptEdit && (
              <textarea
                rows={3}
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            )}

            {imgError && <p className="text-xs text-red-600">{imgError}</p>}

            {imgResult && (
              <div className="bg-gray-50 rounded-lg p-3 text-xs">
                {imgResult.status === 'generating' && (
                  <div className="flex items-center gap-2 text-yellow-700">
                    <span className="animate-spin w-3 h-3 border-2 border-yellow-600 border-t-transparent rounded-full inline-block" />
                    Generating... please wait
                  </div>
                )}
                {imgResult.status === 'ready' && imgResult.url && (
                  <div className="space-y-2">
                    <p className="text-green-700 font-medium">✅ Image ready!</p>
                    <img src={imgResult.url} alt="Generated" className="rounded-lg w-full object-cover" />
                  </div>
                )}
                {imgResult.status === 'failed' && <p className="text-red-600">❌ Generation failed</p>}
              </div>
            )}

            <button
              type="submit"
              disabled={imgGenerating}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {imgGenerating ? (
                <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Generating...</>
              ) : 'Generate Image'}
            </button>
          </form>
        </div>

        {/* 7B — Video Generation */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎬</span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Video Generation</h2>
                <p className="text-xs text-gray-500">Seedance 2.0 via Atlas Cloud</p>
              </div>
            </div>
            <form onSubmit={handleVideoGenerate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">① Client</label>
                <select
                  value={vidClientId}
                  onChange={(e) => { setVidClientId(e.target.value); setVidPostId(''); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">② Content Post</label>
                <select
                  value={vidPostId}
                  onChange={(e) => setVidPostId(e.target.value)}
                  disabled={!vidClientId}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Select post...</option>
                  {vidPosts.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                  <select
                    value={vidDuration}
                    onChange={(e) => setVidDuration(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="5">5 seconds</option>
                    <option value="10">10 seconds</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Aspect Ratio</label>
                  <select
                    value={vidAspectRatio}
                    onChange={(e) => setVidAspectRatio(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="9:16">9:16 Vertical</option>
                    <option value="16:9">16:9 Horizontal</option>
                  </select>
                </div>
              </div>
              {vidError && <p className="text-xs text-red-600">{vidError}</p>}

              {vidResult && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs">
                  {(vidResult.status === 'generating' || vidResult.status === 'processing' || vidResult.status === 'pending') && (
                    <div className="flex items-center gap-2 text-yellow-700">
                      <span className="animate-spin w-3 h-3 border-2 border-yellow-600 border-t-transparent rounded-full inline-block" />
                      Generating video... this may take 1–3 minutes
                    </div>
                  )}
                  {vidResult.status === 'ready' && (
                    <div className="space-y-2">
                      <p className="text-green-700 font-medium">✅ Video ready!</p>
                      {vidResult.url && (
                        <a href={vidResult.url} target="_blank" rel="noreferrer" className="inline-block text-indigo-600 underline">▶ Watch video</a>
                      )}
                    </div>
                  )}
                  {vidResult.status === 'failed' && <p className="text-red-600">❌ Generation failed</p>}
                </div>
              )}

              <button
                type="submit"
                disabled={vidGenerating}
                className="w-full bg-gray-700 hover:bg-gray-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {vidGenerating ? (
                  <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Generating...</>
                ) : 'Generate Video'}
              </button>
            </form>
          </div>

          {/* 7C — HeyGen Avatar */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🤖</span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Avatar Video (HeyGen)</h2>
                <p className="text-xs text-gray-500">Digital human video</p>
              </div>
            </div>
            {heygenConfigured ? (
              <p className="text-sm text-gray-500">HeyGen configured. Avatar form coming soon.</p>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800 font-medium">⚠️ HeyGen API Key 未配置</p>
                <p className="text-xs text-yellow-700 mt-1">请在 .env 中设置 <code className="font-mono bg-yellow-100 px-1 rounded">HEYGEN_API_KEY</code></p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 7D — Generation History */}
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
                      {asset.generation_status === 'ready' && imgClientId && (
                        <button
                          onClick={async () => {
                            await fetch('/api/airtable/sync-visuals', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ client_id: imgClientId || vidClientId, asset_ids: [asset.id] }),
                            });
                            alert('Synced to Airtable ✓');
                          }}
                          className="text-xs border border-gray-300 text-gray-500 px-2 py-1 rounded hover:bg-gray-50 whitespace-nowrap"
                        >
                          ↑ Airtable
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
    </div>
  );
}
