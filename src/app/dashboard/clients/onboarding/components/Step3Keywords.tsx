'use client'

import { useEffect, useState } from 'react'

interface Step3Props {
  onSubmit: (data: { semrushDb: string; monthlyQuota: number }) => void
  onBack: () => void
  loading: boolean
  defaultMarket?: string
}

export default function Step3Keywords({
  onSubmit,
  onBack,
  loading,
  defaultMarket = 'au',
}: Step3Props) {
  const [semrushDb, setSemrushDb] = useState(defaultMarket)
  const [monthlyQuota, setMonthlyQuota] = useState(1000)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setSemrushDb(defaultMarket)
  }, [defaultMarket])

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!semrushDb) {
      newErrors.semrushDb = 'Keyword database is required'
    }

    if (monthlyQuota < 100 || monthlyQuota > 10000) {
      newErrors.monthlyQuota = 'Monthly quota must be between 100 and 10,000'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit({
        semrushDb,
        monthlyQuota,
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          Keyword Intelligence Setup
        </h2>
        <p className="text-slate-600">Configure your SEMrush database and content quota</p>
      </div>

      {/* Keyword Database Selection */}
      <div>
        <label htmlFor="db" className="block text-sm font-medium text-slate-700 mb-2">
          Keyword Database <span className="text-red-500">*</span>
        </label>
        <select
          id="db"
          value={semrushDb}
          onChange={(e) => setSemrushDb(e.target.value)}
          className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
          disabled={loading}
        >
          <option value="au">🇦🇺 Australia (AU)</option>
          <option value="nz">🇳🇿 New Zealand (NZ)</option>
          <option value="us">🇺🇸 United States (US)</option>
          <option value="gb">🇬🇧 United Kingdom (GB)</option>
          <option value="ca">🇨🇦 Canada (CA)</option>
        </select>
        {errors.semrushDb && (
          <p className="mt-1 text-sm text-red-600">{errors.semrushDb}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Select the primary country where your customer operates. You can change this later.
        </p>
      </div>

      {/* Monthly Quota */}
      <div>
        <label htmlFor="quota" className="block text-sm font-medium text-slate-700 mb-2">
          Monthly Content Quota <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="quota"
            type="range"
            min="100"
            max="5000"
            step="100"
            value={monthlyQuota}
            onChange={(e) => setMonthlyQuota(Number(e.target.value))}
            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
            disabled={loading}
          />
          <div className="text-right min-w-fit">
            <input
              type="number"
              value={monthlyQuota}
              onChange={(e) => {
                const val = Number(e.target.value)
                if (val >= 100 && val <= 10000) {
                  setMonthlyQuota(val)
                }
              }}
              className={`px-3 py-2 rounded-lg border text-right font-semibold w-24 ${
                errors.monthlyQuota
                  ? 'border-red-500 bg-red-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              } focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50`}
              disabled={loading}
              min="100"
              max="10000"
            />
          </div>
        </div>
        {errors.monthlyQuota && (
          <p className="mt-1 text-sm text-red-600">{errors.monthlyQuota}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          This determines how many pieces of content can be generated per month (typically
          100–5000 depending on your plan tier)
        </p>
      </div>

      {/* Summary */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <h3 className="font-semibold text-slate-900 mb-3">Setup Summary</h3>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-slate-600">Keyword Database:</span>
            <span className="ml-2 font-semibold text-slate-900">
              {
                {
                  au: '🇦🇺 Australia (AU)',
                  nz: '🇳🇿 New Zealand (NZ)',
                  us: '🇺🇸 United States (US)',
                  gb: '🇬🇧 United Kingdom (GB)',
                  ca: '🇨🇦 Canada (CA)',
                }[semrushDb]
              }
            </span>
          </p>
          <p>
            <span className="text-slate-600">Monthly Quota:</span>
            <span className="ml-2 font-semibold text-slate-900">{monthlyQuota} pieces</span>
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="pt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="px-6 py-3 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? 'Completing setup...' : 'Complete Setup'}
        </button>
      </div>
    </form>
  )
}
