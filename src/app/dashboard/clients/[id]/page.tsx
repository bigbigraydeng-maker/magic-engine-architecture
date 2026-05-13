'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ContentHub } from './_components/ContentHub';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { SettingsDrawer, type SettingsTab } from './_components/SettingsDrawer';

interface Client {
  id: string;
  name: string;
  domain?: string;
  created_at: string;
}

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveBrief, setHasActiveBrief] = useState<boolean | null>(null);

  const [generationOpen, setGenerationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('brief');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, briefRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
      ]);
      if (clientRes.ok) {
        const { client: c } = await clientRes.json();
        setClient(c);
      }
      if (briefRes.ok) {
        const { brief } = await briefRes.json();
        setHasActiveBrief(Boolean(brief));
      } else {
        setHasActiveBrief(false);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openSettings = (tab: SettingsTab = 'brief') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
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
        <Link href="/dashboard/clients" className="text-indigo-600 hover:underline text-sm mt-2 block">
          ← Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Master Brief warning banner */}
      {hasActiveBrief === false && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-lg">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">尚未配置 Master Brief</p>
            <p className="text-xs text-amber-800">
              请先上传品牌文件并生成 Master Brief，才能开始内容生产。
            </p>
          </div>
          <button
            onClick={() => openSettings('brief')}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
          >
            配置 Master Brief →
          </button>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/clients" className="text-gray-400 hover:text-gray-600 text-sm">
          ← Clients
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
        {client.domain && (
          <a
            href={`https://${client.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-500 hover:text-indigo-700 font-mono"
          >
            {client.domain} ↗
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/dashboard/clients/${clientId}/zhangqian`}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-purple-600 hover:text-purple-800 border border-purple-200 hover:border-purple-400 rounded-lg transition-colors"
          >
            🧭 张骞发现
          </Link>
          <button
            onClick={() => openSettings('brief')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
          >
            ⚙️ 设置
          </button>
          <button
            onClick={() => setGenerationOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            🚀 生成内容
          </button>
        </div>
      </div>

      {/* Content Hub — main workspace */}
      <ContentHub clientId={clientId} />

      {/* Generation drawer */}
      <GenerationDrawer
        clientId={clientId}
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
      />

      {/* Settings drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        clientId={clientId}
        client={client}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </div>
  );
}
