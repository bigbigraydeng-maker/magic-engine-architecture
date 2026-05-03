'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MasterBrief } from '@/types/magic-engine';
import { BriefSourcesForm } from './BriefSourcesForm';
import { BriefEditor } from './BriefEditor';
import { BriefChat } from './BriefChat';
import { BriefDocument } from './BriefDocument';

type ViewMode = 'edit' | 'document';

interface Props {
  clientId: string;
}

export function BriefPanel({ clientId }: Props) {
  const [brief, setBrief] = useState<MasterBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');

  const fetchActiveBrief = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brief?status=active`);
      if (res.ok) {
        const json = await res.json();
        setBrief(json.brief ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // On initial mount also check for drafts if no active brief
  const fetchLatestBrief = useCallback(async () => {
    setLoading(true);
    try {
      // Try active first
      const activeRes = await fetch(`/api/clients/${clientId}/brief?status=active`);
      if (activeRes.ok) {
        const { brief: activeBrief } = await activeRes.json();
        if (activeBrief) {
          setBrief(activeBrief);
          return;
        }
      }
      // Fall back to latest draft
      const draftRes = await fetch(`/api/clients/${clientId}/brief?status=draft`);
      if (draftRes.ok) {
        const { brief: draftBrief } = await draftRes.json();
        if (draftBrief) setBrief(draftBrief);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchLatestBrief();
  }, [fetchLatestBrief]);

  const handleGenerated = async (briefId: string) => {
    // Fetch the newly created draft by loading all and finding it
    const res = await fetch(`/api/clients/${clientId}/brief/${briefId}`);
    if (res.ok) {
      const { brief: newBrief } = await res.json();
      setBrief(newBrief);
    }
  };

  const handleActivate = () => {
    // After activate, refresh to get updated status
    fetchActiveBrief();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-pulse text-sm text-gray-400">Loading brief…</div>
      </div>
    );
  }

  return (
    <div className={`flex gap-5 h-[calc(100vh-220px)] min-h-[500px] print:h-auto print:block`}>
      {/* Left panel — full width in document mode, 60% in edit mode */}
      <div className={viewMode === 'document' && brief ? 'flex-1 overflow-y-auto' : 'flex-[3] overflow-y-auto'}>
        {!brief ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-gray-900">Generate Master Brief</h3>
              <p className="text-xs text-gray-500 mt-1">
                Provide brand data sources. Claude will analyze them and generate a complete brand strategy document.
              </p>
            </div>
            <BriefSourcesForm clientId={clientId} onGenerated={handleGenerated} />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200">
            {/* Brief header: title + view toggle + actions */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {brief.brand_name ?? 'Master Brief'}
              </h3>
              <div className="flex items-center gap-3">
                {/* View mode toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                  <button
                    onClick={() => setViewMode('edit')}
                    className={`px-3 py-1.5 font-medium transition-colors ${
                      viewMode === 'edit'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => setViewMode('document')}
                    className={`px-3 py-1.5 font-medium transition-colors ${
                      viewMode === 'document'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    📄 Document
                  </button>
                </div>
                {viewMode === 'document' && (
                  <button
                    onClick={() => window.print()}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1.5 border border-gray-200 rounded-lg"
                    title="Print or save as PDF"
                  >
                    🖨️ Print
                  </button>
                )}
                <button
                  onClick={() => setBrief(null)}
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
                  title="Generate a new brief"
                >
                  + New
                </button>
              </div>
            </div>

            {viewMode === 'edit' ? (
              <div className="p-5">
                <BriefEditor
                  brief={brief}
                  briefId={brief.id}
                  clientId={clientId}
                  onUpdated={setBrief}
                  onActivate={handleActivate}
                />
              </div>
            ) : (
              <div className="p-6 overflow-y-auto max-h-[calc(100vh-280px)] print:max-h-none print:overflow-visible">
                <BriefDocument brief={brief} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel — hidden in document mode */}
      {viewMode === 'edit' && (
        <div className="flex-[2] bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden print:hidden">
          <BriefChat
            briefId={brief?.id ?? ''}
            clientId={clientId}
            disabled={!brief}
            onBriefUpdated={setBrief}
          />
        </div>
      )}
    </div>
  );
}
