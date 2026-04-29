'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
}

interface ContentPost {
  id: string;
  client_id: string;
  title: string;
  route: string;
  platforms: string[];
  status: string;
  caption?: string;
  script?: string;
  hashtags?: string[];
  visual_brief?: string;
  created_at: string;
  clients?: { name: string } | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-800',
};

const routeColors: Record<string, string> = {
  route_a: 'bg-purple-100 text-purple-700',
  route_b: 'bg-orange-100 text-orange-700',
  route_c: 'bg-teal-100 text-teal-700',
};

const routeLabels: Record<string, string> = {
  route_a: 'Route A',
  route_b: 'Route B',
  route_c: 'Route C',
};

const RATIO_OPTIONS = [
  { value: '1:1',  label: '方形 1:1 (通用)' },
  { value: '4:5',  label: '竖版 4:5 (Instagram 动态)' },
  { value: '9:16', label: '故事 9:16 (TikTok / Reels / Story)' },
  { value: '16:9', label: '横版 16:9 (YouTube / FB 横版)' },
];

function isNewPost(created_at: string) {
  return Date.now() - new Date(created_at).getTime() < 60 * 60 * 1000;
}

function suggestRatio(platforms: string[]): string {
  if (platforms.includes('tiktok')) return '9:16';
  if (platforms.includes('youtube')) return '16:9';
  if (platforms.includes('twitter')) return '16:9';
  if (platforms.includes('instagram')) return '4:5';
  if (platforms.includes('facebook')) return '4:5';
  return '1:1';
}

export default function ContentBoardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('draft');
  const [modalPost, setModalPost] = useState<ContentPost | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');

  // Modal edit state
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editVisualBrief, setEditVisualBrief] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Modal image preview state
  const [previewRatio, setPreviewRatio] = useState('1:1');
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'generating' | 'done' | 'failed'>('idle');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => setClients(d.clients ?? []));
  }, []);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    setBatchMsg('');
    try {
      const params = new URLSearchParams();
      if (selectedClient) params.set('client_id', selectedClient);
      if (selectedStatus) params.set('status', selectedStatus);
      const res = await fetch(`/api/content/posts?${params}`);
      const json = await res.json();
      setPosts(json.posts ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, selectedStatus]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // ─── Modal helpers ───────────────────────────────────────────────────────────

  const openModal = (post: ContentPost) => {
    setModalPost(post);
    setEditMode(false);
    setEditTitle(post.title);
    setEditScript(post.script ?? '');
    setEditCaption(post.caption ?? '');
    setEditHashtags((post.hashtags ?? []).join(' '));
    setEditVisualBrief(post.visual_brief ?? '');
    setSaveMsg('');
    setPreviewRatio(suggestRatio(post.platforms));
    setPreviewStatus('idle');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const closeModal = () => {
    setModalPost(null);
    setEditMode(false);
    setSaveMsg('');
    setPreviewStatus('idle');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  // ─── Save edits ──────────────────────────────────────────────────────────────

  const handleSaveEdit = async () => {
    if (!modalPost) return;
    setSavingEdit(true);
    setSaveMsg('');
    try {
      const body = {
        title: editTitle,
        script: editScript,
        caption: editCaption,
        hashtags: editHashtags.split(/\s+/).filter(Boolean),
        visual_brief: editVisualBrief,
      };
      const res = await fetch(`/api/posts/${modalPost.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const updated: ContentPost = {
        ...modalPost,
        title: editTitle,
        script: editScript || undefined,
        caption: editCaption || undefined,
        hashtags: editHashtags.split(/\s+/).filter(Boolean),
        visual_brief: editVisualBrief || undefined,
      };
      setModalPost(updated);
      setPosts(prev => prev.map(p => p.id === updated.id ? updated : p));
      setSaveMsg('✓ 已保存');
      setEditMode(false);
    } catch (err) {
      setSaveMsg(`✗ ${(err as Error).message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // ─── Image preview generation ────────────────────────────────────────────────

  const handleGeneratePreview = async () => {
    if (!modalPost) return;
    if (!modalPost.visual_brief && !editVisualBrief) {
      setPreviewError('请先填写 Visual Brief 再生成图片');
      return;
    }
    setPreviewStatus('generating');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);

    try {
      const res = await fetch('/api/visual/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: modalPost.id,
          client_id: modalPost.client_id,
          aspect_ratio: previewRatio,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const assetId: string = json.asset_id;

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/visual/status/${assetId}`);
          const pollJson = await pollRes.json();
          const asset = pollJson.asset;
          if (asset?.generation_status === 'ready') {
            clearInterval(pollRef.current!);
            setPreviewStatus('done');
            setPreviewImageUrl(asset.storage_url || asset.provider_url || null);
          } else if (asset?.generation_status === 'failed') {
            clearInterval(pollRef.current!);
            setPreviewStatus('failed');
            setPreviewError(asset.error_message || '生成失败，请重试');
          }
        } catch {
          // Transient poll error — keep polling
        }
      }, 5000);
    } catch (err) {
      setPreviewStatus('failed');
      setPreviewError((err as Error).message);
    }
  };

  // ─── Selection helpers ───────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === posts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(posts.map(p => p.id)));
    }
  };

  const batchUpdate = async (ids: string[], status: 'approved' | 'rejected') => {
    if (ids.length === 0) return;
    setBatching(true);
    setBatchMsg('');
    try {
      const res = await fetch('/api/posts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: ids, status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setBatchMsg(`✓ 已${status === 'approved' ? '批准' : '拒绝'} ${json.updated} 条`);
      await fetchPosts();
    } catch (err) {
      setBatchMsg(`✗ ${(err as Error).message}`);
    } finally {
      setBatching(false);
    }
  };

  const handleBatchUpdate = (status: 'approved' | 'rejected') =>
    batchUpdate(Array.from(selectedIds), status);

  const handleSyncAirtable = async (post: ContentPost) => {
    setSyncing(post.id);
    try {
      await fetch('/api/airtable/sync-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: post.clients?.name ? selectedClient : '', post_ids: [post.id] }),
      });
    } finally {
      setSyncing(null);
    }
  };

  const allSelected = posts.length > 0 && selectedIds.size === posts.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">内容板</h1>
          <p className="text-sm text-gray-500 mt-1">{posts.length} 条内容</p>
        </div>
        <Link
          href="/dashboard/content/generate"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + 生成内容
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">全部客户</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="draft">草稿（待审批）</option>
          <option value="approved,scheduled">日历（已批准 + 已排期）</option>
          <option value="approved">已批准</option>
          <option value="scheduled">已排期</option>
          <option value="published">已发布</option>
          <option value="">全部</option>
          <option value="rejected">已拒绝</option>
        </select>
      </div>

      {/* Batch feedback — always visible so it persists after selection clears */}
      {batchMsg && (
        <p className={`text-sm px-1 ${batchMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {batchMsg}
        </p>
      )}

      {/* Batch action bar — visible while items are selected */}
      {someSelected && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">
            已选 {selectedIds.size} 条
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => handleBatchUpdate('approved')}
              disabled={batching}
              className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors font-medium"
            >
              {batching ? '处理中…' : `✓ 批准 (${selectedIds.size})`}
            </button>
            <button
              onClick={() => handleBatchUpdate('rejected')}
              disabled={batching}
              className="bg-red-500 hover:bg-red-600 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors font-medium"
            >
              ✕ 拒绝
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Content Cards */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">加载中…</div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg mb-2">暂无内容</p>
          {selectedStatus === 'draft' && (
            <p className="text-sm text-gray-400">
              前往客户推广活动，批量生成内容草稿
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Select all row */}
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs text-gray-500">
              {allSelected ? '取消全选' : `全选 (${posts.length})`}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {posts.map((post) => (
              <div
                key={post.id}
                className={`bg-white rounded-xl border p-5 hover:shadow-md transition-shadow cursor-pointer ${
                  selectedIds.has(post.id)
                    ? 'border-indigo-400 ring-2 ring-indigo-100'
                    : 'border-gray-200'
                }`}
                onClick={() => toggleSelect(post.id)}
              >
                {/* Card Header */}
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(post.id)}
                    onChange={() => toggleSelect(post.id)}
                    onClick={e => e.stopPropagation()}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 leading-snug">{post.title}</h3>
                        {isNewPost(post.created_at) && (
                          <span className="flex-shrink-0 text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold tracking-wide">
                            NEW
                          </span>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusColors[post.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {post.status === 'draft' ? '草稿' :
                         post.status === 'approved' ? '已批准' :
                         post.status === 'scheduled' ? '已排期' :
                         post.status === 'published' ? '已发布' :
                         post.status === 'rejected' ? '已拒绝' : post.status}
                      </span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${routeColors[post.route] ?? 'bg-gray-100 text-gray-600'}`}>
                        {routeLabels[post.route] ?? post.route}
                      </span>
                      {post.platforms?.map((p) => (
                        <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">{p}</span>
                      ))}
                    </div>

                    {/* Caption Preview */}
                    {post.caption && (
                      <p className="text-xs text-gray-500 mt-3 line-clamp-2">{post.caption}</p>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                      <span className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => openModal(post)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          查看详情
                        </button>
                        <span className="text-gray-300">·</span>
                        <button
                          onClick={() => handleSyncAirtable(post)}
                          disabled={syncing === post.id}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50"
                        >
                          {syncing === post.id ? '同步中…' : '↑ Airtable'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {modalPost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 truncate">{modalPost.title}</h2>
                  {isNewPost(modalPost.created_at) && (
                    <span className="text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0">NEW</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(modalPost.created_at).toLocaleString()} · {modalPost.clients?.name ?? ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!editMode ? (
                  <button
                    onClick={() => setEditMode(true)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    ✏️ 编辑
                  </button>
                ) : (
                  <button
                    onClick={() => { setEditMode(false); setSaveMsg(''); }}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    取消
                  </button>
                )}
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-7 h-7 flex items-center justify-center">×</button>
              </div>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4 text-sm">
              {/* Script */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Script</p>
                {editMode ? (
                  <textarea
                    value={editScript}
                    onChange={e => setEditScript(e.target.value)}
                    rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                  />
                ) : (
                  modalPost.script ? (
                    <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 text-xs">{modalPost.script}</p>
                  ) : (
                    <p className="text-gray-400 italic text-xs">（无）</p>
                  )
                )}
              </div>

              {/* Caption */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Caption</p>
                {editMode ? (
                  <textarea
                    value={editCaption}
                    onChange={e => setEditCaption(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                  />
                ) : (
                  modalPost.caption ? (
                    <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 text-xs">{modalPost.caption}</p>
                  ) : (
                    <p className="text-gray-400 italic text-xs">（无）</p>
                  )
                )}
              </div>

              {/* Hashtags */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hashtags</p>
                {editMode ? (
                  <input
                    type="text"
                    value={editHashtags}
                    onChange={e => setEditHashtags(e.target.value)}
                    placeholder="#tag1 #tag2 #tag3（空格分隔）"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                ) : (
                  modalPost.hashtags && modalPost.hashtags.length > 0 ? (
                    <p className="text-indigo-600 text-xs">{modalPost.hashtags.join(' ')}</p>
                  ) : (
                    <p className="text-gray-400 italic text-xs">（无）</p>
                  )
                )}
              </div>

              {/* Visual Brief */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Visual Brief</p>
                {editMode ? (
                  <textarea
                    value={editVisualBrief}
                    onChange={e => setEditVisualBrief(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                  />
                ) : (
                  modalPost.visual_brief ? (
                    <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs">{modalPost.visual_brief}</p>
                  ) : (
                    <p className="text-gray-400 italic text-xs">（无）</p>
                  )
                )}
              </div>

              {/* Save button (edit mode) */}
              {editMode && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    {savingEdit ? '保存中…' : '💾 保存修改'}
                  </button>
                  {saveMsg && (
                    <span className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</span>
                  )}
                </div>
              )}
              {!editMode && saveMsg && (
                <p className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>
              )}

              {/* ── Image Preview Section ─────────────────────────────── */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">图片预览生成</p>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <label className="text-xs text-gray-600 font-medium whitespace-nowrap">比例：</label>
                  <select
                    value={previewRatio}
                    onChange={e => setPreviewRatio(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    {RATIO_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleGeneratePreview}
                    disabled={previewStatus === 'generating'}
                    className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {previewStatus === 'generating' ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        生成中…
                      </span>
                    ) : '✨ 生成预览图'}
                  </button>
                </div>

                {previewStatus === 'generating' && (
                  <p className="text-xs text-gray-400">WaveSpeed Flux-dev 生成中，通常需要 1-3 分钟，请耐心等待…</p>
                )}

                {previewStatus === 'failed' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-600">{previewError}</p>
                    <button onClick={handleGeneratePreview} className="text-xs text-red-700 underline mt-1">重试</button>
                  </div>
                )}

                {previewStatus === 'done' && previewImageUrl && (
                  <div className="mt-2">
                    <img
                      src={previewImageUrl}
                      alt="Generated preview"
                      className="w-full max-w-sm mx-auto rounded-xl border border-gray-200 shadow-sm"
                    />
                    <div className="flex gap-3 mt-2 justify-center">
                      <a
                        href={previewImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        ↗ 查看原图
                      </a>
                      <button
                        onClick={handleGeneratePreview}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        ↻ 重新生成
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {/* ──────────────────────────────────────────────────────── */}

              {/* Quick approve/reject — only for drafts */}
              {(modalPost.status === 'draft') && (
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => {
                      const id = modalPost.id;
                      closeModal();
                      batchUpdate([id], 'approved');
                    }}
                    disabled={batching}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    ✓ 批准此条
                  </button>
                  <button
                    onClick={() => {
                      const id = modalPost.id;
                      closeModal();
                      batchUpdate([id], 'rejected');
                    }}
                    disabled={batching}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    ✕ 拒绝此条
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
