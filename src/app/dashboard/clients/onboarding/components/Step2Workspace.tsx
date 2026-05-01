'use client'

import { useState } from 'react'

interface Step2Props {
  onSubmit: (data: {
    airtableBaseId: string
    airtableTableId?: string
  }) => void
  onBack: () => void
  loading: boolean
}

export default function Step2Workspace({
  onSubmit,
  onBack,
  loading,
}: Step2Props) {
  const [airtableBaseId, setAirtableBaseId] = useState('')
  const [airtableTableId, setAirtableTableId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!airtableBaseId.trim()) {
      newErrors.airtableBaseId = 'Airtable Base ID is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit({
        airtableBaseId: airtableBaseId.trim(),
        airtableTableId: airtableTableId.trim() || undefined,
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          Content Workspace Setup
        </h2>
        <p className="text-slate-600">
          Connect to your Airtable base for content collaboration
        </p>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-slate-700">
        <p className="font-semibold mb-2">How to find your Airtable Base ID:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Open your Airtable workspace</li>
          <li>Click on the base you want to connect</li>
          <li>Look at the URL: airtable.com/base/<strong>appXXXXXXXXXXXXXX</strong></li>
          <li>Copy the part after <code className="bg-white px-1">base/</code></li>
        </ol>
      </div>

      {/* Airtable Base ID */}
      <div>
        <label htmlFor="baseId" className="block text-sm font-medium text-slate-700 mb-2">
          Airtable Base ID <span className="text-red-500">*</span>
        </label>
        <input
          id="baseId"
          type="text"
          value={airtableBaseId}
          onChange={(e) => setAirtableBaseId(e.target.value)}
          placeholder="e.g., appXXXXXXXXXXXXXX"
          className={`w-full px-4 py-2 rounded-lg border transition-colors font-mono text-sm ${
            errors.airtableBaseId
              ? 'border-red-500 bg-red-50'
              : 'border-slate-300 bg-white hover:border-slate-400'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          disabled={loading}
        />
        {errors.airtableBaseId && (
          <p className="mt-1 text-sm text-red-600">{errors.airtableBaseId}</p>
        )}
      </div>

      {/* Airtable Table ID (optional) */}
      <div>
        <label htmlFor="tableId" className="block text-sm font-medium text-slate-700 mb-2">
          Content Table ID <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="tableId"
          type="text"
          value={airtableTableId}
          onChange={(e) => setAirtableTableId(e.target.value)}
          placeholder="e.g., tblYYYYYYYYYYYYYY"
          className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors font-mono text-sm disabled:opacity-50"
          disabled={loading}
        />
        <p className="mt-1 text-xs text-slate-500">
          Leave blank to auto-detect, or specify the table containing your content calendar
        </p>
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
          className="flex-1 px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? 'Verifying...' : 'Continue to Step 3'}
        </button>
      </div>
    </form>
  )
}
