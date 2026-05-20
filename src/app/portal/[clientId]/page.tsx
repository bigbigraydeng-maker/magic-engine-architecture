import { supabaseAdmin } from '@/lib/supabase'
import type { DiagnosticDimension } from '@/types/diagnostic'
import Link from 'next/link'

interface Props {
  params: { clientId: string }
}

const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI Visibility',
  ads:           'Ads',
  social:        'Social',
  reputation:    'Reputation',
  competitor:    'Competitor',
}

const ALL_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'social', 'reputation', 'competitor', 'ads',
]

function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-400'
  if (score >= 70) return 'text-green-600'
  if (score >= 40) return 'text-amber-500'
  return 'text-red-500'
}

function scoreBg(score: number | null): string {
  if (score === null) return 'bg-gray-50 border-gray-100'
  if (score >= 70) return 'bg-green-50 border-green-100'
  if (score >= 40) return 'bg-amber-50 border-amber-100'
  return 'bg-red-50 border-red-100'
}

export default async function PortalOverviewPage({ params }: Props) {
  const { clientId } = params

  // Latest diagnostic run
  const { data: run } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, overall_score, dimension_scores, completed_at, status')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Content counts
  const [{ count: blogCount }, { count: socialCount }] = await Promise.all([
    supabaseAdmin
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'published'),
    supabaseAdmin
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['approved', 'published', 'scheduled']),
  ])

  const dimensionScores = (run?.dimension_scores ?? {}) as Partial<Record<DiagnosticDimension, number | null>>

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        {run?.completed_at && (
          <p className="mt-1 text-sm text-gray-500">
            Last diagnostic:{' '}
            {new Date(run.completed_at).toLocaleDateString('en-NZ', {
              day: 'numeric', month: 'long', year: 'numeric',
              timeZone: 'Pacific/Auckland',
            })}
          </p>
        )}
      </div>

      {/* Diagnostic scores */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-700">Performance Scores</h2>
          {run && (
            <Link
              href={`/portal/${clientId}/report`}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View full report →
            </Link>
          )}
        </div>

        {!run ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            No diagnostic data yet — your account manager will run your first diagnostic soon.
          </div>
        ) : (
          <>
            {/* Overall score */}
            {run.overall_score != null && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Overall Score</span>
                <span className={`text-2xl font-bold ${scoreColor(run.overall_score)}`}>
                  {Math.round(run.overall_score)}
                  <span className="text-sm font-normal text-gray-400">/100</span>
                </span>
              </div>
            )}

            {/* 6 dimension tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ALL_DIMENSIONS.map(dim => {
                const score = dimensionScores[dim] ?? null
                return (
                  <div
                    key={dim}
                    className={`rounded-xl border p-4 flex flex-col gap-1 ${scoreBg(score)}`}
                  >
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      {DIMENSION_LABELS[dim]}
                    </span>
                    {score === null ? (
                      <span className="text-lg font-bold text-gray-300">—</span>
                    ) : (
                      <span className={`text-2xl font-bold ${scoreColor(score)}`}>
                        {Math.round(score)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* Content stats */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-4">Content Published</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Blog Articles</p>
            <p className="text-3xl font-bold text-gray-900">{blogCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Social Posts</p>
            <p className="text-3xl font-bold text-gray-900">{socialCount ?? 0}</p>
          </div>
        </div>
        <div className="mt-3">
          <Link
            href={`/portal/${clientId}/content`}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Browse content library →
          </Link>
        </div>
      </section>
    </div>
  )
}
