'use client';

import { useState, useEffect, useCallback } from 'react';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

interface BacklinkMetrics {
  domain: string;
  backlinks_count: number;
  total_backlinks: number;
  referring_domains: number;
  referring_pages: number;
  rank?: number;
}

interface Backlink {
  url: string;
  domain: string;
  anchor_text?: string;
  tld_rank?: number;
  citation_flow?: number;
  trust_flow?: number;
  link_type: string;
  is_new: boolean;
  is_lost: boolean;
}

const linkTypeColors: Record<string, string> = {
  'do-follow': 'bg-green-100 text-green-700',
  'no-follow': 'bg-yellow-100 text-yellow-700',
  'internal': 'bg-blue-100 text-blue-700',
};

export default function LinkIntelligencePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [metrics, setMetrics] = useState<BacklinkMetrics | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [sortBy, setSortBy] = useState<'tld_rank' | 'citation_flow' | 'trust_flow'>('tld_rank');

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list = d.clients ?? [];
      setClients(list);
      if (list.length > 0) {
        setSelectedClient(list[0].id);
      }
    });
  }, []);

  const handleSync = useCallback(async () => {
    if (!selectedClient) return;
    setSyncing(true);
    setSyncStatus('');

    try {
      const res = await fetch(`/api/clients/${selectedClient}/datasources/backlinks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      setSyncStatus(`✓ Synced ${json.backlinks_count} backlinks`);
    } catch (err: unknown) {
      setSyncStatus(`✗ ${err instanceof Error ? err.message : 'Sync failed'}`);
    } finally {
      setSyncing(false);
    }
  }, [selectedClient]);

  const loadMetrics = useCallback(async () => {
    if (!selectedClient) return;
    setLoading(true);
    try {
      // For now, we'll fetch the sync data as metrics
      // In a real implementation, we'd have a separate GET endpoint
      const res = await fetch(`/api/clients/${selectedClient}/datasources/backlinks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      const json = await res.json();
      if (res.ok) {
        setMetrics(json);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedClient]);

  useEffect(() => {
    if (selectedClient) {
      loadMetrics();
    }
  }, [selectedClient, loadMetrics]);

  const sortedBacklinks = [...backlinks].sort((a, b) => {
    if (sortBy === 'tld_rank') return (b.tld_rank ?? 0) - (a.tld_rank ?? 0);
    if (sortBy === 'citation_flow') return (b.citation_flow ?? 0) - (a.citation_flow ?? 0);
    return (b.trust_flow ?? 0) - (a.trust_flow ?? 0);
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Link Intelligence</h1>
        <p className="text-sm text-gray-500 mt-1">Backlink tracking & competitor analysis</p>
      </div>

      {/* Sync Panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">🔗 Backlink Sync</h2>
          {syncStatus && <span className="text-xs text-green-600">{syncStatus}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || !selectedClient}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 h-[42px]"
          >
            {syncing ? (
              <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Syncing...</>
            ) : '↻ Sync Backlinks'}
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-600 uppercase">Total Backlinks</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.total_backlinks?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-600 uppercase">Referring Domains</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.referring_domains?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-600 uppercase">Referring Pages</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.referring_pages?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-600 uppercase">Domain Rank</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.rank ?? '—'}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="tld_rank">Sort by Domain Rank</option>
          <option value="citation_flow">Sort by Citation Flow</option>
          <option value="trust_flow">Sort by Trust Flow</option>
        </select>
        <span className="text-sm text-gray-400">{sortedBacklinks.length} backlinks</span>
      </div>

      {/* Backlinks Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : sortedBacklinks.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No backlinks found. Click &quot;Sync Backlinks&quot; to fetch data.</div>
        ) : (
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">URL</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Domain</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Domain Rank</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Citation Flow</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Trust Flow</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Link Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedBacklinks.map((link, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-blue-600 truncate max-w-xs">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {link.url.length > 50 ? link.url.substring(0, 47) + '…' : link.url}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">{link.domain}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-center font-bold">{link.tld_rank ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-center">{link.citation_flow ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-center">{link.trust_flow ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${linkTypeColors[link.link_type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {link.link_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {link.is_new && <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">New</span>}
                      {link.is_lost && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">Lost</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
