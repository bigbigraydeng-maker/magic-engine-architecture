'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BillingData {
  month: string
  totalCost: number
  totalApiCalls: number
  costsByService: Record<string, number>
  byClient: Array<{
    clientId: string
    service: string
    apiCalls: number
    costUsd: number
  }>
}

export default function BillingMonitorPage() {
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [billingData, setBillingData] = useState<BillingData | null>(null)
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // Fetch available months on mount
  useEffect(() => {
    const fetchMonths = async () => {
      try {
        const res = await fetch('/api/admin/billing/datasources')
        const data = await res.json()
        if (data.availableMonths) {
          setAvailableMonths(data.availableMonths)
          if (data.availableMonths.length > 0) {
            setSelectedMonth(data.availableMonths[0])
          }
        }
      } catch (err) {
        // Silently fail - no months available yet
      }
    }
    fetchMonths()
  }, [])

  // Fetch billing data when month changes
  useEffect(() => {
    if (!selectedMonth) return

    const fetchBillingData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/admin/billing/datasources?month=${selectedMonth}`)
        const data = await res.json()

        if (res.ok) {
          setBillingData(data)
        } else {
          setError(data.error || 'Failed to fetch billing data')
        }
      } catch (err) {
        setError('Failed to fetch billing data')
      } finally {
        setLoading(false)
      }
    }

    fetchBillingData()
  }, [selectedMonth])

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">💳</span>
            <h1 className="text-3xl font-bold text-gray-900">Billing Monitor</h1>
          </div>
          <p className="text-gray-600">Track DataForSEO API usage and costs by client and month</p>
        </div>

        {/* Month Selector */}
        <div className="mb-8 bg-white rounded-lg shadow p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Month
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-8 rounded-md bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {billingData && !loading && (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
              {/* Total Cost Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-gray-600">Total Cost</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  ${billingData.totalCost.toFixed(2)}
                </p>
              </div>

              {/* Total API Calls Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-gray-600">Total API Calls</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {billingData.totalApiCalls.toLocaleString()}
                </p>
              </div>

              {/* Services Count Card */}
              <div className="rounded-lg bg-white shadow p-6">
                <p className="text-sm font-medium text-gray-600">Services</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {Object.keys(billingData.costsByService).length}
                </p>
              </div>
            </div>

            {/* Costs by Service */}
            <div className="mb-8 bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Costs by Service</h2>
              </div>
              <div className="divide-y divide-gray-200">
                {Object.entries(billingData.costsByService).map(([service, cost]) => (
                  <div key={service} className="px-6 py-4 flex justify-between">
                    <span className="text-gray-900">{service}</span>
                    <span className="font-semibold text-gray-900">
                      ${Number(cost).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Breakdown */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Breakdown by Client & Service</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                        Client ID
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                        Service
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                        API Calls
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                        Cost (USD)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {billingData.byClient.map((log, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <Link
                            href={`/dashboard/clients/${log.clientId}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {log.clientId.substring(0, 8)}...
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{log.service}</td>
                        <td className="px-6 py-4 text-sm text-right text-gray-900">
                          {log.apiCalls.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-gray-900">
                          ${log.costUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="inline-flex items-center gap-2 text-gray-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
              Loading billing data...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
