import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [clientsRes, monthlyRes, pendingRes, keywordsRes, recentRes] = await Promise.all([
    supabaseAdmin.from('clients').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('content_posts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth),
    supabaseAdmin
      .from('content_posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),
    supabaseAdmin.from('keywords').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('content_posts')
      .select('id, title, status, created_at, clients(name), route')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  return {
    totalClients: clientsRes.count ?? 0,
    monthlyContent: monthlyRes.count ?? 0,
    pendingReview: pendingRes.count ?? 0,
    totalKeywords: keywordsRes.count ?? 0,
    recentPosts: recentRes.data ?? [],
  };
}

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-800',
};

const routeLabels: Record<string, string> = {
  route_a: 'Route A',
  route_b: 'Route B',
  route_c: 'Route C',
};

export default async function OverviewPage() {
  const stats = await getStats();

  const cards = [
    { label: 'Total Clients', value: stats.totalClients, icon: '👥', color: 'bg-indigo-50 border-indigo-200', textColor: 'text-indigo-700', href: '/dashboard/clients' },
    { label: 'Content This Month', value: stats.monthlyContent, icon: '📝', color: 'bg-blue-50 border-blue-200', textColor: 'text-blue-700', href: '/dashboard/content' },
    { label: 'Pending Review', value: stats.pendingReview, icon: '⏳', color: 'bg-yellow-50 border-yellow-200', textColor: 'text-yellow-700', href: '/dashboard/content' },
    { label: 'Keywords Total', value: stats.totalKeywords, icon: '🔑', color: 'bg-green-50 border-green-200', textColor: 'text-green-700', href: '/dashboard/keywords' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Magic Engine Admin Dashboard</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Link key={card.label} href={card.href}>
            <div className={`border rounded-xl p-5 ${card.color} hover:shadow-md transition-shadow cursor-pointer`}>
              <div className="flex items-center justify-between">
                <span className="text-2xl">{card.icon}</span>
                <span className={`text-3xl font-bold ${card.textColor}`}>{card.value}</span>
              </div>
              <p className="text-sm font-medium text-gray-600 mt-3">{card.label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Content */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Recent Content</h2>
          <Link href="/dashboard/content" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            View all →
          </Link>
        </div>
        {stats.recentPosts.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            No content yet. <Link href="/dashboard/content/generate" className="text-indigo-600 hover:underline">Generate some content</Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {stats.recentPosts.map((post: Record<string, unknown>) => (
              <div key={post.id as string} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{post.title as string}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">
                      {(post.clients as Record<string, string> | null)?.name ?? 'Unknown Client'}
                    </span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">
                      {routeLabels[post.route as string] ?? post.route as string}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[post.status as string] ?? 'bg-gray-100 text-gray-600'}`}>
                    {post.status as string}
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(post.created_at as string).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Six Pillars */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">六大支柱</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {(
            [
              { emoji: '🔍', title: 'SEO Intelligence', desc: '关键词情报 · 站点审计 · 内容策略',   href: '/dashboard/keywords' as string | null,      color: 'bg-blue-50   border-blue-200   hover:border-blue-400   hover:shadow-md' },
              { emoji: '🤖', title: 'AI 可见度',         desc: 'AI 搜索追踪 · GEO 指令部署',        href: '/dashboard/ai-visibility' as string | null, color: 'bg-violet-50 border-violet-200 hover:border-violet-400 hover:shadow-md' },
              { emoji: '📢', title: 'Ads Intelligence',  desc: 'Meta · Google · TikTok 广告诊断',  href: null,                                        color: 'bg-orange-50 border-orange-200 opacity-50' },
              { emoji: '📱', title: 'Social Matrix',     desc: '多平台内容生产 · Campaign 管理',     href: '/dashboard/content' as string | null,       color: 'bg-pink-50   border-pink-200   hover:border-pink-400   hover:shadow-md' },
              { emoji: '⭐', title: '口碑管理',           desc: '评价监控 · 声誉诊断',               href: null,                                        color: 'bg-yellow-50 border-yellow-200 opacity-50' },
              { emoji: '🏆', title: '竞品分析',           desc: '竞争对手追踪 · 差距分析',            href: null,                                        color: 'bg-emerald-50 border-emerald-200 opacity-50' },
            ] as const
          ).map((p) => {
            const card = (
              <div className={`border rounded-xl p-5 transition-all ${p.color}`}>
                <div className="text-2xl mb-2">{p.emoji}</div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                  {!p.href && (
                    <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Soon</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{p.desc}</p>
              </div>
            )
            return p.href ? (
              <Link key={p.title} href={p.href}>{card}</Link>
            ) : (
              <div key={p.title} className="cursor-not-allowed">{card}</div>
            )
          })}
        </div>
      </div>
    </div>
  );
}
