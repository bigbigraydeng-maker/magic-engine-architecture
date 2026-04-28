'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
  airtable_base_id?: string;
  airtable_content_table_id?: string;
  airtable_keywords_table_id?: string;
  airtable_embed_social?: string;
  airtable_embed_keywords?: string;
  airtable_embed_seo?: string;
  created_at: string;
}

interface MasterBrief {
  id?: string;
  brand_name?: string;
  tone?: string;
  primary_audience?: string;
  visual_style?: string;
  products?: Array<{ name: string; description: string }>;
  content_topics?: string[];
}

interface ContentPost {
  id: string;
  title: string;
  status: string;
  route: string;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-800',
};

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [brief, setBrief] = useState<MasterBrief>({});
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [airtableConfig, setAirtableConfig] = useState({
    airtable_base_id: '',
    airtable_content_table_id: '',
    airtable_keywords_table_id: '',
    airtable_embed_social: '',
    airtable_embed_keywords: '',
    airtable_embed_seo: '',
  });
  const [savingAirtable, setSavingAirtable] = useState(false);
  const [airtableMsg, setAirtableMsg] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, briefRes, postsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief`),
        fetch(`/api/clients/${clientId}/posts`),
      ]);

      if (clientRes.ok) {
        const { client: c } = await clientRes.json();
        setClient(c);
        setAirtableConfig({
          airtable_base_id: c.airtable_base_id ?? '',
          airtable_content_table_id: c.airtable_content_table_id ?? '',
          airtable_keywords_table_id: c.airtable_keywords_table_id ?? '',
          airtable_embed_social: c.airtable_embed_social ?? '',
          airtable_embed_keywords: c.airtable_embed_keywords ?? '',
          airtable_embed_seo: c.airtable_embed_seo ?? '',
        });
      }
      if (briefRes.ok) {
        const { brief: b } = await briefRes.json();
        if (b) setBrief(b);
      }
      if (postsRes.ok) {
        const { posts: p } = await postsRes.json();
        setPosts(p ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveAirtable = async () => {
    setSavingAirtable(true);
    setAirtableMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(airtableConfig),
      });
      if (!res.ok) throw new Error('Failed to save');
      setAirtableMsg('Saved ✓');
      setTimeout(() => setAirtableMsg(''), 3000);
    } catch {
      setAirtableMsg('Error saving');
    } finally {
      setSavingAirtable(false);
    }
  };

  const handleSaveBrief = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch {
      setSaveMsg('Error saving');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-200 rounded w-64" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Client not found.</p>
        <Link href="/dashboard/clients" className="text-indigo-600 hover:underline text-sm mt-2 block">← Back to clients</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/clients" className="text-gray-400 hover:text-gray-600 text-sm">← Clients</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
      </div>

      {/* Client Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Client Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Domain:</span>
            {client.domain ? (
              <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="ml-2 text-indigo-600 hover:underline">{client.domain}</a>
            ) : <span className="ml-2 text-gray-400">—</span>}
          </div>
          <div>
            <span className="text-gray-500">Airtable Base:</span>
            <span className="ml-2 font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{client.airtable_base_id ?? '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Created:</span>
            <span className="ml-2 text-gray-900">{new Date(client.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Airtable Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Airtable Configuration</h2>
            <p className="text-xs text-gray-400 mt-0.5">同步设置 + 嵌入视图 URL</p>
          </div>
          <div className="flex items-center gap-3">
            {airtableMsg && <span className="text-sm text-green-600">{airtableMsg}</span>}
            <button
              onClick={handleSaveAirtable}
              disabled={savingAirtable}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {savingAirtable ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {/* Sync IDs */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sync Settings</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { label: 'Airtable Base ID', key: 'airtable_base_id', placeholder: 'appXXXXXXXXXXXXXX' },
                { label: 'Social Calendar Table ID', key: 'airtable_content_table_id', placeholder: 'tblXXXXXXXXXXXXXX' },
                { label: 'Keywords Table ID', key: 'airtable_keywords_table_id', placeholder: 'tblXXXXXXXXX or "Keywords"' },
              ] as { label: string; key: keyof typeof airtableConfig; placeholder: string }[]).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    value={airtableConfig[key]}
                    onChange={e => setAirtableConfig(c => ({ ...c, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Embed URLs */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Embed View URLs
              <span className="ml-2 font-normal normal-case text-gray-400">Airtable → Share → Embed this view → 复制 src URL</span>
            </p>
            <div className="space-y-3">
              {([
                { label: '📅 Social Calendar', key: 'airtable_embed_social' },
                { label: '🔑 Keywords', key: 'airtable_embed_keywords' },
                { label: '📈 SEO Strategy', key: 'airtable_embed_seo' },
              ] as { label: string; key: keyof typeof airtableConfig }[]).map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    value={airtableConfig[key]}
                    onChange={e => setAirtableConfig(c => ({ ...c, [key]: e.target.value }))}
                    placeholder="https://airtable.com/embed/shr…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Master Brief */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Master Brief</h2>
          <div className="flex items-center gap-3">
            {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
            <button
              onClick={handleSaveBrief}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Brief'}
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Brand Name</label>
              <input
                value={brief.brand_name ?? ''}
                onChange={(e) => setBrief({ ...brief, brand_name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Primary Audience</label>
              <input
                value={brief.primary_audience ?? ''}
                onChange={(e) => setBrief({ ...brief, primary_audience: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tone of Voice</label>
            <textarea
              rows={2}
              value={brief.tone ?? ''}
              onChange={(e) => setBrief({ ...brief, tone: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="e.g. Warm, adventurous, inspiring..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Visual Style</label>
            <textarea
              rows={2}
              value={brief.visual_style ?? ''}
              onChange={(e) => setBrief({ ...brief, visual_style: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="e.g. Bright, scenic landscape photography..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Key Messages (one per line)</label>
            <textarea
              rows={4}
              value={brief.content_topics?.join('\n') ?? ''}
              onChange={(e) => setBrief({ ...brief, content_topics: e.target.value.split('\n').filter(Boolean) })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Enter key messages or topics, one per line..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Products (JSON)</label>
            <textarea
              rows={4}
              value={brief.products ? JSON.stringify(brief.products, null, 2) : '[]'}
              onChange={(e) => {
                try { setBrief({ ...brief, products: JSON.parse(e.target.value) }); } catch { /* ignore */ }
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Recent Content */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Recent Content</h2>
        </div>
        {posts.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No content posts yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {posts.slice(0, 10).map((post) => (
              <div key={post.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{post.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{post.route} · {new Date(post.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[post.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {post.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
