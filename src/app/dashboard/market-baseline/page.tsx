'use client'

import { useState, useEffect, useCallback } from 'react'

interface MarketComparison {
  id: string
  keyword: string
  client_position: number | null
  industry_avg_position: number | null
  position_diff: number | null
  client_volume: number | null
  industry_avg_volume: number
  volume_percentile: number | null
  client_ranking_strength: 'ahead' | 'aligned' | 'behind' | 'not_ranking'
  opportunity_score: number
  date: string
}

interface MarketMetrics {
  comparisons: MarketComparison[]
  topOpportunities: MarketComparison[]
  underperformers: MarketComparison[]
  aligned: MarketComparison[]
  avgOpportunityScore: number
  totalKeywords: number
  snapshotDate: string
}

interface Client {
  id: string
  name: string
}

export default function MarketBaselinePage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [metrics, setMetrics] = useState<MarketMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Fetch available clients on mount
  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list = d.clients ?? []
      setClients(list)
      if (list.length > 0) {
        setSelectedClientId(list[0].id)
      }
    })
  }, [])

  const fetchMetrics = useCallback(async () => {
    if (!selectedClientId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/clients/${selectedClientId}/datasources/market/rankings?limit=100&offset=0`
      )
      const data = await res.json()
      setMetrics(data)
    } catch (error) {
      console.error('Failed to fetch market metrics:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedClientId])

  const handleSync = useCallback(async () => {
    if (!selectedClientId) return
    setSyncing(true)
    try {
      const res = await fetch(
        `/api/clients/${selectedClientId}/datasources/market/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      const data = await res.json()
      if (data.success) {
        await fetchMetrics()
      }
    } catch (error) {
      console.error('Failed to sync:', error)
    } finally {
      setSyncing(false)
    }
  }, [selectedClientId, fetchMetrics])

  useEffect(() => {
    if (selectedClientId) {
      fetchMetrics()
    }
  }, [selectedClientId, fetchMetrics])

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-center text-gray-400">Loading market baseline...</div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Market Baseline</h1>
          <p className="text-gray-500 mt-2">与行业竞争水位对标分析</p>
        </div>
        <div className="bg-white p-8 rounded-lg border border-gray-200 text-center">
          <p className="text-gray-500 mb-4">还没有市场基准数据</p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync Market Baseline'}
          </button>
        </div>
      </div>
    )
  }

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'ahead':
        return 'text-green-600 bg-green-50'
      case 'aligned':
        return 'text-blue-600 bg-blue-50'
      case 'behind':
        return 'text-red-600 bg-red-50'
      case 'not_ranking':
        return 'text-gray-600 bg-gray-50'
      default:
        return 'text-gray-600'
    }
  }

  const getStrengthLabel = (strength: string) => {
    switch (strength) {
      case 'ahead':
        return '领先'
      case 'aligned':
        return '持平'
      case 'behind':
        return '落后'
      case 'not_ranking':
        return '未排名'
      default:
        return strength
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Market Baseline</h1>
        <p className="text-gray-500 mt-2">与行业竞争水位对标分析</p>
      </div>

      {/* Control Bar */}
      <div className="flex gap-4 items-center bg-white p-4 rounded-lg border border-gray-200">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || !selectedClientId}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync Market Baseline'}
        </button>
        <div className="ml-auto text-sm text-gray-500">
          最后更新：{metrics.snapshotDate}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Total Keywords</div>
          <div className="text-3xl font-bold text-gray-900">
            {metrics.totalKeywords}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Avg Opportunity</div>
          <div className="text-3xl font-bold text-blue-600">
            {metrics.avgOpportunityScore}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Top Opportunities</div>
          <div className="text-3xl font-bold text-green-600">
            {metrics.topOpportunities.length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Underperformers</div>
          <div className="text-3xl font-bold text-red-600">
            {metrics.underperformers.length}
          </div>
        </div>
      </div>

      {/* Top Opportunities */}
      {metrics.topOpportunities.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Top Opportunities</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">
                    Keyword
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Position
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Industry Avg
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Strength
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.topOpportunities.map((opp) => (
                  <tr key={opp.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {opp.keyword}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {opp.client_position ? `#${opp.client_position}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {opp.industry_avg_position
                        ? `#${Math.round(opp.industry_avg_position)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-semibold ${getStrengthColor(
                          opp.client_ranking_strength
                        )}`}
                      >
                        {getStrengthLabel(opp.client_ranking_strength)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-blue-600">
                        {Math.round(opp.opportunity_score)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Underperformers */}
      {metrics.underperformers.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Underperformers</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">
                    Keyword
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Your Position
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Industry Avg
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Gap
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    Volume
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.underperformers.map((under) => (
                  <tr key={under.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {under.keyword}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {under.client_position ? (
                        <span className="font-semibold text-red-600">
                          #{under.client_position}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {under.industry_avg_position
                        ? `#${Math.round(under.industry_avg_position)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {under.position_diff && (
                        <span className="text-red-600 font-semibold">
                          {under.position_diff > 0 ? '+' : ''}{Math.round(under.position_diff)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {under.industry_avg_volume}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Comparisons Table */}
      {(metrics.comparisons ?? []).length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">All Keywords</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">
                    Keyword
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Position
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Strength
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    Volume %
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {(metrics.comparisons ?? []).slice(0, 50).map((comp) => (
                  <tr key={comp.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {comp.keyword}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {comp.client_position ? `#${comp.client_position}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-semibold ${getStrengthColor(
                          comp.client_ranking_strength
                        )}`}
                      >
                        {getStrengthLabel(comp.client_ranking_strength)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {comp.volume_percentile
                        ? `${Math.round(comp.volume_percentile)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-blue-600">
                        {Math.round(comp.opportunity_score)}
                      </span>
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
