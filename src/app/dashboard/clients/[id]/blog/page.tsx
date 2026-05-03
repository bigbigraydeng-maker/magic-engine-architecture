'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { BlogOpportunity, ContentAuditResult } from '@/types/magic-engine';

interface BlogPostSummary {
  id: string;
  mode: string;
  topic: string;
  source_query_text: string | null;
  title: string;
  meta_title: string;
  word_count: number | null;
  status: string;
  featured_image_url: string | null;
  cost_usd: number | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-amber-100 text-amber-700',
  approved:  'bg-blue-100 text-blue-700',
  published: 'bg-green-100 text-green-700',
  rejected:  'bg-gray-100 text-gray-500',
};

const WEAKNESS_COLORS = (score: number) =>
  score >= 0.8 ? 'text-red-600 bg-red-50 border-red-200' :
  score >= 0.5 ? 'text-amber-600 bg-amber-50 border-amber-200' :
                 'text-yellow-600 bg-yellow-50 border-yellow-200';

/**
 * /dashboard/clients/[id]/blog
 * Blog list + GEO weak-spot topic selector.
 * Reference: ROADMAP.md P7.3.9, P7.3.13
 */
export default function ClientBlogPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [opportunities, setOpportunities] = useState<BlogOpportunity[]>([]);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null); // query_id being generated
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState<boolean | null>(null);
  // Upgrade recommendation from content audit
  const [upgradeRec, setUpgradeRec] = useState<{
    opp: BlogOpportunity;
    audit: ContentAuditResult;
  } | null>(null);

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg);
    setActionOk(ok);
    setTimeout(() => { setActionMsg(''); setActionOk(null); }, 6000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, opRes, postsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/blog/opportunities`),
        fetch(`/api/clients/${clientId}/blog?limit=50`),
      ]);
      if (clientRes.ok) {
        const j = await clientRes.json();
        setClientName(j.client?.name ?? clientId);
      }
      if (opRes.ok) {
        const j = await opRes.json();
        setOpportunities(j.opportunities ?? []);
      }
      if (postsRes.ok) {
        const j = await postsRes.json();
        setPosts(j.posts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleGenerate = async (opp: BlogOpportunity, skipAudit = false) => {
    setGenerating(opp.query_id);
    setUpgradeRec(null);
    flash(
      skipAudit
        ? '✨ Generating blog post (audit bypassed)… this may take 20-30s'
        : '🔍 Auditing existing content, then generating… this may take 30s',
      true
    );
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'geo_only',
          topic: opp.query_text,
          source_query_id: opp.query_id,
          source_query_text: opp.query_text,
          word_count_target: 1000,
          skip_audit: skipAudit,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Generation failed');

      if (j.action === 'upgrade' && j.audit) {
        // Content audit flagged existing content — show recommendation instead of creating post
        setUpgradeRec({ opp, audit: j.audit as ContentAuditResult });
        setActionMsg('');
        setActionOk(null);
      } else {
        flash(`✓ Blog post created ($${j.cost_usd?.toFixed(4) ?? '?'}) — review it below`, true);
        await fetchAll();
      }
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Generation failed', false);
    } finally {
      setGenerating(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-7 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/clients/${clientId}`}
          className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0">
          ← {clientName}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Blog Posts</h1>
        {actionMsg && (
          <span className={`text-sm font-medium ml-2 ${actionOk ? 'text-green-600' : 'text-red-600'}`}>
            {actionMsg}
          </span>
        )}
      </div>

      {/* ── Content Audit: Upgrade Recommendation ─────────────────── */}
      {upgradeRec && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🔄</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 text-sm">
                Existing Content Detected — Upgrade Recommended
              </p>
              <p className="text-xs text-amber-700 mt-1">{upgradeRec.audit.reason}</p>
              {upgradeRec.audit.existing_url && (
                <a
                  href={upgradeRec.audit.existing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline mt-1 block truncate"
                >
                  📄 {upgradeRec.audit.existing_title ?? upgradeRec.audit.existing_url}
                </a>
              )}
              <p className="text-xs text-amber-600 mt-2">
                Confidence: {Math.round(upgradeRec.audit.confidence * 100)}% ·
                {upgradeRec.audit.discovered_urls.length} articles scanned
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => handleGenerate(upgradeRec.opp, true)}
              disabled={!!generating}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors"
            >
              {generating ? '⏳ Generating…' : '✨ Generate New Anyway'}
            </button>
            <button
              onClick={() => setUpgradeRec(null)}
              className="px-4 py-2 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              Dismiss
            </button>
            {upgradeRec.audit.existing_url && (
              <a
                href={upgradeRec.audit.existing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:border-gray-400 rounded-lg transition-colors"
              >
                Open Existing Article →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── AI Weak Spot Topics ────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              🎯 AI Weak Spot Topics
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Queries where AI systems are not recommending {clientName}. Each is a blog opportunity.
            </p>
          </div>
          <span className="text-xs text-gray-400">{opportunities.length} topics</span>
        </div>

        {opportunities.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-500">
            No weak spots detected yet — run the AI Visibility Tracker first to generate topics.
            <div className="mt-3">
              <Link href={`/dashboard/ai-visibility/${clientId}`}
                className="text-indigo-600 hover:text-indigo-800 font-medium">
                → Go to AI Visibility Tracker
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {opportunities.map(opp => {
              const isGenerating = generating === opp.query_id;
              const scoreLabel = opp.weakness_score >= 0.8 ? '🔴 Critical'
                : opp.weakness_score >= 0.5 ? '🟡 High' : '🟠 Medium';
              return (
                <div key={opp.query_id}
                  className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${WEAKNESS_COLORS(opp.weakness_score)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 leading-snug flex-1">
                      &quot;{opp.query_text}&quot;
                    </p>
                    <span className="text-xs font-semibold flex-shrink-0">{scoreLabel}</span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>Missed by: {opp.engines_missing.join(', ') || 'all engines'}</p>
                    <p>Weak in {Math.round(opp.weakness_score * 100)}% of {opp.total_runs_checked} runs</p>
                  </div>
                  <button
                    onClick={() => handleGenerate(opp)}
                    disabled={!!generating}
                    className="mt-auto w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors"
                  >
                    {isGenerating ? '⏳ Generating…' : '✨ Generate Blog Post'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Generated Posts ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            📝 Generated Posts
          </h2>
          <span className="text-xs text-gray-400">{posts.length} posts</span>
        </div>

        {posts.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl px-5 py-8 text-center text-sm text-gray-400">
            No posts yet. Click &quot;✨ Generate Blog Post&quot; on any topic above to start.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {posts.map(post => (
              <Link
                key={post.id}
                href={`/dashboard/clients/${clientId}/blog/${post.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700 truncate">
                    {post.title || post.topic}
                  </p>
                  {post.source_query_text && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      Topic: &quot;{post.source_query_text}&quot;
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-500">
                  {post.word_count && <span>{post.word_count} words</span>}
                  {post.cost_usd && <span>${post.cost_usd.toFixed(4)}</span>}
                  <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {post.status}
                  </span>
                  <span className="text-gray-300 group-hover:text-indigo-400">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
