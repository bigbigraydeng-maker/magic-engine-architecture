/**
 * §7 Local Visibility — city-level search ranking summary
 * Reference: ROADMAP.md P8.C.1, P8.8
 */
import type { LocalVisibilityData } from '@/lib/reports/monthly-aggregator'
import { EmptyState } from './Shared'

export function LocalVisibilityPanel({ data }: { data: LocalVisibilityData | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <EmptyState message="暂无本地搜索数据 — Local Visibility 模块上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="text-center">
          <p className="text-2xl font-bold text-indigo-700">{data.total_cities}</p>
          <p className="text-xs text-gray-500 mt-1">Cities Tracked</p>
        </div>
        {data.top_opportunity_city && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <span className="text-amber-500 text-sm">🎯</span>
            <div>
              <p className="text-xs text-amber-700 font-semibold">Top Opportunity</p>
              <p className="text-sm font-bold text-amber-900">{data.top_opportunity_city}</p>
            </div>
          </div>
        )}
      </div>

      {data.cities.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">City</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Keywords</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Avg Rank</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Top 3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.cities.map((city, i) => {
                const isOpportunity = city.city === data.top_opportunity_city
                return (
                  <tr key={i} className={isOpportunity ? 'bg-amber-50/40' : 'hover:bg-gray-50/50'}>
                    <td className="px-4 py-2 text-xs font-medium text-gray-800">
                      {isOpportunity && <span className="mr-1">🎯</span>}
                      {city.city}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-600">{city.tracked_keywords}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-gray-900">
                      {city.avg_rank != null ? `#${city.avg_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-green-700 font-semibold">{city.top3_count}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
