'use client'

import { useState, useEffect, useCallback } from 'react'

interface SerpRanking {
  id: string
  keyword: string
  position: number | null
  search_volume: number | null
  url: string | null
  snippet: string | null
  date: string
}

interface SerpTrend {
  keyword: string
  position_start: number | null
  position_current: number | null
  position_change: number | null
  is_new: boolean
  is_lost: boolean
}

interface Client {
  id: string
  name: string
}

export default function SerpIntelligencePage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [rankings, setRankings] = useState<SerpRanking[]>([])
  const [trends, setTrends] = useState<SerpTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [sortBy, setSortBy] = useState<'position' | 'keyword' | 'search_volume'>('position')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

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

  // Fetch rankings
  const fetchRankings = useCallback(async () => {
    if (!selectedClientId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/clients/${selectedClientId}/datasources/serp/rankings?sortBy=${sortBy}&sortOrder=${sortOrder}&limit=100`
      )
      const data = await res.json()
      setRankings(data.rankings || [])
      setTrends(data.trends || [])
    } catch (error) {
      console.error('Failed to fetch rankings:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedClientId, sortBy, sortOrder])

  // Sync SERP data
  const handleSync = useCallback(async () => {
    if (!selectedClientId) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/clients/${selectedClientId}/datasources/serp/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchRankings()
      }
    } catch (error) {
      console.error('Failed to sync:', error)
    } finally {
      setSyncing(false)
    }
  }, [selectedClientId, fetchRankings])

  useEffect(() => {
    if (selectedClientId) {
      fetchRankings()
    }
  }, [selectedClientId, sortBy, sortOrder, fetchRankings])

  const topThreeChanges = trends
    ?.filter((t) => t.position_current && t.position_current <= 3)
    ?.slice(0, 5) || []

  const newOpportunities = trends?.filter((t) => t.is_new) || []
  const lostRankings = trends?.filter((t) => t.is_lost) || []

  const metricsTop10 = rankings.filter((r) => r.position && r.position <= 10).length
  const metricsTop50 = rankings.filter((r) => r.position && r.position <= 50).length

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">SERP Intelligence</h1>
        <p className="text-gray-500 mt-2">排名追踪和趋势分析</p>
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
          {syncing ? 'Syncing...' : 'Sync Rankings'}
        </button>

        <div className="flex gap-2 ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'position' | 'keyword' | 'search_volume')}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="position">Sort by Position</option>
            <option value="keyword">Sort by Keyword</option>
            <option value="search_volume">Sort by Volume</option>
          </select>

          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Total Keywords</div>
          <div className="text-3xl font-bold text-gray-900">{rankings.length}</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Top 10</div>
          <div className="text-3xl font-bold text-green-600">{metricsTop10}</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Top 50</div>
          <div className="text-3xl font-bold text-blue-600">{metricsTop50}</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-500">Not Ranking</div>
          <div className="text-3xl font-bold text-gray-400">
            {rankings.filter((r) => !r.position).length}
          </div>
        </div>
      </div>

      {/* Quick Insights */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top 3 Changes */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">Top 3 Changes</h3>
          {topThreeChanges.length > 0 ? (
            <ul className="space-y-2">
              {topThreeChanges.map((trend) => (
                <li key={trend.keyword} className="text-sm text-gray-600">
                  <span className="font-medium">{trend.keyword}</span>
                  {trend.position_change && (
                    <span className={trend.position_change > 0 ? 'text-green-600' : 'text-red-600'}>
                      {' '}({trend.position_change > 0 ? '+' : ''}{trend.position_change})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm">No data yet</p>
          )}
        </div>

        {/* Opportunities */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">New Opportunities</h3>
          {newOpportunities.length > 0 ? (
            <ul className="space-y-2">
              {newOpportunities.slice(0, 5).map((opp) => (
                <li key={opp.keyword} className="text-sm text-green-600">
                  🎯 {opp.keyword}
                </li>
              ))}
              {newOpportunities.length > 5 && (
                <li className="text-sm text-gray-400">+{newOpportunities.length - 5} more</li>
              )}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm">No new rankings</p>
          )}
        </div>
      </div>

      {/* Rankings Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Keyword Rankings</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading rankings...</div>
        ) : rankings.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No rankings found. Click &quot;Sync Rankings&quot; to fetch data.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Keyword</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">Position</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">Search Volume</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">URL</th>
                </tr>
              </thead>
              <tbody>
                {rankings.slice(0, 50).map((ranking) => (
                  <tr key={ranking.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{ranking.keyword}</td>
                    <td className="px-4 py-3 text-center">
                      {ranking.position ? (
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          ranking.position <= 3 ? 'bg-green-100 text-green-700' :
                          ranking.position <= 10 ? 'bg-blue-100 text-blue-700' :
                          ranking.position <= 50 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          #{ranking.position}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {ranking.search_volume ? ranking.search_volume.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 truncate text-gray-600 text-xs">
                      {ranking.url || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
