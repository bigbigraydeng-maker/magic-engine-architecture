import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAnalyticsSummary, fetchRecentSubmissions } from "@/lib/analytics/fetch-analytics";
import { DashboardCharts } from "./dashboard-charts";

interface DashboardPageProps {
  params: { id: string };
}

function summarizePayload(p: unknown): string {
  if (!p || typeof p !== "object") {
    return "—";
  }
  const o = p as Record<string, unknown>;
  const keys = ["name", "full_name", "email", "phone", "mobile"] as const;
  const bits = keys.map((k) => (typeof o[k] === "string" ? (o[k] as string) : null)).filter(Boolean);
  if (bits.length > 0) {
    return bits.join(" · ");
  }
  const s = JSON.stringify(o);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export default async function ProjectDashboardPage({ params }: DashboardPageProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();
  if (!project) {
    notFound();
  }

  const days = 14;
  const summary = await fetchAnalyticsSummary(supabase, project.id, days);
  const recent = await fetchRecentSubmissions(supabase, project.id, 10);

  const maxRef = summary.topReferrers[0]?.count ?? 1;
  const maxUtm = summary.utmBuckets[0]?.count ?? 1;

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← 所有项目
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">{project.name} · 数据仪表盘</h1>
      <p className="mt-1 text-sm text-stone-500">最近 {summary.days} 天 · 仅统计已发布微站的访问与本项目表单提交</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">访问量</p>
          <p className="mt-2 font-display text-3xl font-semibold text-stone-900">{summary.totalVisits.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">线索（提交）</p>
          <p className="mt-2 font-display text-3xl font-semibold text-stone-900">{summary.totalSubmissions.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">转化率</p>
          <p className="mt-2 font-display text-3xl font-semibold text-emerald-900">{summary.conversionRatePct}%</p>
          <p className="mt-1 text-xs text-stone-500">提交 ÷ 访问（访问为 0 时为 0%）</p>
        </div>
      </div>

      <div className="mt-10">
        <DashboardCharts summary={summary} />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-800">顶部引荐来源</h3>
          <ul className="mt-4 space-y-3">
            {summary.topReferrers.length === 0 ? (
              <li className="text-sm text-stone-500">暂无数据</li>
            ) : (
              summary.topReferrers.map((r) => (
                <li key={r.referrer}>
                  <div className="flex items-center justify-between gap-2 text-xs text-stone-600">
                    <span className="max-w-[70%] truncate" title={r.referrer}>
                      {r.referrer}
                    </span>
                    <span className="shrink-0 font-medium text-stone-900">{r.count}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-emerald-700"
                      style={{ width: `${Math.max(6, (r.count / maxRef) * 100)}%` }}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-800">UTM 汇总</h3>
          <ul className="mt-4 space-y-3">
            {summary.utmBuckets.length === 0 ? (
              <li className="text-sm text-stone-500">暂无 UTM 参数</li>
            ) : (
              summary.utmBuckets.map((u) => {
                const label = [u.source, u.medium, u.campaign].filter(Boolean).join(" / ");
                return (
                  <li key={label}>
                    <div className="flex items-center justify-between gap-2 text-xs text-stone-600">
                      <span className="max-w-[70%] truncate" title={label}>
                        {label}
                      </span>
                      <span className="shrink-0 font-medium text-stone-900">{u.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-amber-600"
                        style={{ width: `${Math.max(6, (u.count / maxUtm) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      <div className="mt-10 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-stone-800">最近提交</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
                <th className="py-2 pr-4 font-medium">时间</th>
                <th className="py-2 font-medium">摘要</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-6 text-stone-500">
                    暂无提交记录
                  </td>
                </tr>
              ) : (
                recent.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100">
                    <td className="py-3 pr-4 whitespace-nowrap text-stone-600">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 text-stone-800">{summarizePayload(row.payload)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
