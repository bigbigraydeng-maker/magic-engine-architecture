import { supabaseAdmin } from '@/lib/supabase'
import Link from 'next/link'

interface Props {
  params: { clientId: string }
}

export default async function PortalReportPage({ params }: Props) {
  const { clientId } = params

  // Latest completed diagnostic run with narratives
  const { data: run } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, overall_score, dimension_scores, completed_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch synthesis narratives if available
  const { data: narratives } = run
    ? await supabaseAdmin
        .from('diagnostic_narratives')
        .select('dimension, narrative_md, generated_at')
        .eq('run_id', run.id)
        .order('dimension')
    : { data: null }

  // Top findings
  const { data: findings } = run
    ? await supabaseAdmin
        .from('diagnostic_findings')
        .select('dimension, severity, title, description')
        .eq('run_id', run.id)
        .in('severity', ['critical', 'high'])
        .order('severity')
        .limit(10)
    : { data: null }

  if (!run) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Monthly Report</h1>
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          Your first report will appear here once your account manager runs an initial diagnostic.
        </div>
      </div>
    )
  }

  const SEVERITY_COLORS: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high:     'bg-amber-100 text-amber-700',
    medium:   'bg-yellow-100 text-yellow-700',
    low:      'bg-gray-100 text-gray-600',
  }

  const DIMENSION_LABELS: Record<string, string> = {
    seo:           'SEO',
    ai_visibility: 'AI Visibility',
    ads:           'Advertising',
    social:        'Social Media',
    reputation:    'Reputation',
    competitor:    'Competitive Position',
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generated{' '}
            {new Date(run.completed_at).toLocaleDateString('en-NZ', {
              day: 'numeric', month: 'long', year: 'numeric',
              timeZone: 'Pacific/Auckland',
            })}
          </p>
        </div>
        <Link
          href={`/portal/${clientId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Overview
        </Link>
      </div>

      {/* Overall score banner */}
      {run.overall_score != null && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-0.5">
              Overall Performance Score
            </p>
            <p className="text-sm text-indigo-700">
              Based on SEO, AI visibility, social media, reputation, and competitive positioning.
            </p>
          </div>
          <span className="text-5xl font-bold text-indigo-600 ml-6 flex-shrink-0">
            {Math.round(run.overall_score)}
          </span>
        </div>
      )}

      {/* Key findings */}
      {findings && findings.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Priority Actions</h2>
          <div className="space-y-2">
            {findings.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-start gap-3"
              >
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[f.severity] ?? 'bg-gray-100 text-gray-500'}`}>
                  {f.severity}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{f.title}</p>
                  {f.description && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.description}</p>
                  )}
                  <p className="text-xs text-indigo-500 mt-1">{DIMENSION_LABELS[f.dimension] ?? f.dimension}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Synthesis narratives */}
      {narratives && narratives.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-gray-700">Analysis by Area</h2>
          {narratives.map(n => (
            <div key={n.dimension} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">
                {DIMENSION_LABELS[n.dimension] ?? n.dimension}
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {n.narrative_md.replace(/[#*`]/g, '').trim()}
              </p>
            </div>
          ))}
        </section>
      )}

      {!narratives?.length && !findings?.length && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Detailed analysis will appear here after your next diagnostic run.
        </div>
      )}
    </div>
  )
}
