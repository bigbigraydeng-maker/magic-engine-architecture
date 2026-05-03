/**
 * §8 Market Benchmark — competitor gap analysis
 * Reference: ROADMAP.md P8.C.1, P8.9
 */
import type { MarketBenchmarkData } from '@/lib/reports/monthly-aggregator'
import { KpiCard, EmptyState } from './Shared'

export function MarketBenchmarkPanel({ data }: { data: MarketBenchmarkData | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <EmptyState message="暂无市场基准数据 — Market Benchmark 模块上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Keywords Compared"
          value={data.total_keywords_compared.toString()}
          sub={<span className="text-xs text-gray-400">vs competitors</span>}
        />
        <KpiCard
          label="Competitor Leads"
          value={data.keywords_competitor_wins.toString()}
          sub={<span className="text-xs text-gray-400">keywords where they rank higher</span>}
        />
        <KpiCard
          label="Avg. Gap"
          value={data.avg_gap != null ? `${data.avg_gap > 0 ? '+' : ''}${data.avg_gap}` : '—'}
          sub={<span className="text-xs text-gray-400">positions behind (positive = behind)</span>}
        />
      </div>

      {data.top_opportunities.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Top Opportunities</p>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-2/5">Keyword</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Your Rank</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Competitor</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Domain</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.top_opportunities.map((opp, i) => (
                  <tr key={i} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs font-mono text-gray-800 truncate max-w-xs">{opp.keyword}</td>
                    <td className="px-3 py-2 text-center text-xs text-gray-600">
                      {opp.client_rank != null ? `#${opp.client_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-green-700 font-bold">
                      {opp.competitor_rank != null ? `#${opp.competitor_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[160px]">{opp.competitor_domain}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${Math.min(opp.opportunity_score, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-indigo-700">{opp.opportunity_score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
