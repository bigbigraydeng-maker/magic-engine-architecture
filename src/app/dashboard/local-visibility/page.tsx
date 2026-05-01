'use client'

import { useState, useEffect, useCallback } from 'react'

interface LocalRankingsByCity {
  city_name: string
  location_code: number
  country_code: string
  total: number
  top10: number
  top50: number
  rankings: Array<{
    id: string
    keyword: string
    position: number | null
    date: string
  }>
}

interface LocalTrend {
  keyword: string
  city_name: string
  location_code: number
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

export default function LocalVisibilityPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [rankingsByCity, setRankingsByCity] = useState<LocalRankingsByCity[]>([])
  const [trends, setTrends] = useState<LocalTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)

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

  const fetchRankings = useCallback(async () => {
    if (!selectedClientId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/clients/${selectedClientId}/datasources/local/rankings?limit=100&offset=0`
      )
      const data = await res.json()
      setRankingsByCity(data.rankingsByCity || [])
      setTrends(data.trends || [])
      if (data.rankingsByCity.length > 0 && !selectedCity) {
        setSelectedCity(data.rankingsByCity[0].city_name)
      }
    } catch (error) {
      console.error('Failed to fetch rankings:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedClientId, selectedCity])

  const handleSync = useCallback(async () => {
    if (!selectedClientId) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/clients/${selectedClientId}/datasources/local/sync`, {
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
  }, [selectedClientId, fetchRankings])

  const selectedCityData = rankingsByCity.find((c) => c.city_name === selectedCity)
  const trendsByCity = trends.filter((t) => t.city_name === selectedCity)
  const newRankings = trendsByCity.filter((t) => t.is_new)
  const lostRankings = trendsByCity.filter((t) => t.is_lost)
  const topChanges = trendsByCity
    .filter((t) => t.position_current && t.position_current <= 3)
    .sort((a, b) => (a.position_change || 0) - (b.position_change || 0))
    .slice(0, 5)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Local Visibility</h1>
        <p className="text-gray-500 mt-2">澳大利亚和新西兰城市排名跟踪</p>
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

        <div className="ml-auto">
          <select
            value={selectedCity || ''}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">Select City</option>
            {rankingsByCity.map((city) => (
              <option key={city.location_code} value={city.city_name}>
                {city.city_name} ({city.country_code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* City Overview - Grid of all cities */}
      {rankingsByCity.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {rankingsByCity.map((city) => (
            <div
              key={city.location_code}
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                selectedCity === city.city_name
                  ? 'bg-indigo-50 border-indigo-300'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setSelectedCity(city.city_name)}
            >
              <div className="text-sm font-medium text-gray-700">
                {city.city_name} ({city.country_code})
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-xs text-gray-500">
                  Top 10: <span className="font-semibold text-green-600">{city.top10}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Top 50: <span className="font-semibold text-blue-600">{city.top50}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Total: <span className="font-semibold">{city.total}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected City Details */}
      {selectedCityData && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-500">Total Keywords</div>
              <div className="text-3xl font-bold text-gray-900">{selectedCityData.total}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-500">Top 10</div>
              <div className="text-3xl font-bold text-green-600">{selectedCityData.top10}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-500">Top 50</div>
              <div className="text-3xl font-bold text-blue-600">{selectedCityData.top50}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-500">Not Ranking</div>
              <div className="text-3xl font-bold text-gray-400">
                {selectedCityData.total - selectedCityData.top50}
              </div>
            </div>
          </div>

          {/* Quick Insights */}
          <div className="grid grid-cols-2 gap-4">
            {/* Top Changes */}
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">Top Changes</h3>
              {topChanges.length > 0 ? (
                <ul className="space-y-2">
                  {topChanges.map((trend) => (
                    <li key={trend.keyword} className="text-sm text-gray-600">
                      <span className="font-medium">{trend.keyword}</span>
                      {trend.position_change && (
                        <span
                          className={
                            trend.position_change > 0 ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          {' '}({trend.position_change > 0 ? '+' : ''}{trend.position_change})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400 text-sm">No changes in this window</p>
              )}
            </div>

            {/* Opportunities */}
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">Opportunities</h3>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-green-600 font-semibold">
                    New Entries: {newRankings.length}
                  </div>
                  {newRankings.slice(0, 3).map((opp) => (
                    <div key={opp.keyword} className="text-xs text-green-600 ml-2">
                      🎯 {opp.keyword}
                    </div>
                  ))}
                  {newRankings.length > 3 && (
                    <div className="text-xs text-gray-400 ml-2">
                      +{newRankings.length - 3} more
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-red-600 font-semibold">
                    Lost: {lostRankings.length}
                  </div>
                  {lostRankings.slice(0, 3).map((lost) => (
                    <div key={lost.keyword} className="text-xs text-red-600 ml-2">
                      ⚠️ {lost.keyword}
                    </div>
                  ))}
                  {lostRankings.length > 3 && (
                    <div className="text-xs text-gray-400 ml-2">
                      +{lostRankings.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Rankings Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">
                Rankings in {selectedCityData.city_name}
              </h3>
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-400">Loading rankings...</div>
            ) : selectedCityData.rankings.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                No rankings found. Click &quot;Sync Rankings&quot; to fetch data.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Keyword</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-700">
                        Position
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCityData.rankings.slice(0, 50).map((ranking) => (
                      <tr key={ranking.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {ranking.keyword}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ranking.position ? (
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                ranking.position <= 3
                                  ? 'bg-green-100 text-green-700'
                                  : ranking.position <= 10
                                  ? 'bg-blue-100 text-blue-700'
                                  : ranking.position <= 50
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              #{ranking.position}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{ranking.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
