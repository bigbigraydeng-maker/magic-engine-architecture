import { supabaseAdmin } from '@/lib/supabase'
import Link from 'next/link'

interface Props {
  params: { clientId: string }
  searchParams: { tab?: string }
}

export default async function PortalContentPage({ params, searchParams }: Props) {
  const { clientId } = params
  const tab = searchParams.tab === 'social' ? 'social' : 'blog'

  // Blog posts
  const { data: blogs } = await supabaseAdmin
    .from('blog_posts')
    .select('id, title, primary_keyword, word_count, status, created_at')
    .eq('client_id', clientId)
    .in('status', ['published', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50)

  // Social posts
  const { data: socials } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, caption, script, platforms, route, status, scheduled_at, created_at')
    .eq('client_id', clientId)
    .in('status', ['approved', 'published', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(50)

  const blogCount = blogs?.length ?? 0
  const socialCount = socials?.length ?? 0

  const STATUS_STYLES: Record<string, string> = {
    published: 'bg-green-100 text-green-700',
    approved:  'bg-blue-100 text-blue-700',
    scheduled: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
          <p className="mt-1 text-sm text-gray-500">
            {blogCount} blog articles · {socialCount} social posts
          </p>
        </div>
        <Link
          href={`/portal/${clientId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Overview
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'blog',   label: `Blog (${blogCount})` },
          { key: 'social', label: `Social (${socialCount})` },
        ].map(t => (
          <Link
            key={t.key}
            href={`/portal/${clientId}/content?tab=${t.key}`}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Blog list */}
      {tab === 'blog' && (
        <div className="space-y-3">
          {!blogCount ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
              No published articles yet.
            </div>
          ) : (
            blogs?.map(post => (
              <div key={post.id} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{post.title}</p>
                    {post.primary_keyword && (
                      <p className="text-xs text-indigo-500 mt-0.5">
                        Keyword: {post.primary_keyword}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {post.word_count && (
                      <span className="text-xs text-gray-400">{post.word_count.toLocaleString()} words</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {post.status}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(post.created_at).toLocaleDateString('en-NZ', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    timeZone: 'Pacific/Auckland',
                  })}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Social list */}
      {tab === 'social' && (
        <div className="space-y-3">
          {!socialCount ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
              No approved social content yet.
            </div>
          ) : (
            socials?.map(post => (
              <div key={post.id} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {(post.platforms as string[] | null)?.map((p: string) => (
                        <span key={p} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
                          {p}
                        </span>
                      ))}
                      {post.route && (
                        <span className="text-xs text-gray-400 uppercase">{post.route}</span>
                      )}
                    </div>
                    {post.title && (
                      <p className="text-sm font-semibold text-gray-900 mb-1">{post.title}</p>
                    )}
                    {post.caption && (
                      <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">
                        {post.caption}
                      </p>
                    )}
                    {post.script && (
                      <details className="mt-2">
                        <summary className="text-xs font-medium text-indigo-600 cursor-pointer hover:text-indigo-700 select-none">
                          Video Script ▾
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700 bg-gray-50 rounded-lg p-3 leading-relaxed border border-gray-200">
                          {post.script}
                        </pre>
                      </details>
                    )}
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {post.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {post.scheduled_at
                    ? `Scheduled: ${new Date(post.scheduled_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })}`
                    : new Date(post.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })
                  }
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
