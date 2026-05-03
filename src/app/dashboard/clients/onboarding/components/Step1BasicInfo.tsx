'use client'

import { useState } from 'react'

interface Step1Props {
  onSubmit: (data: {
    name: string
    domain: string
    targetMarket: 'au' | 'nz' | 'other'
  }) => void
  loading: boolean
}

export default function Step1BasicInfo({ onSubmit, loading }: Step1Props) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [targetMarket, setTargetMarket] = useState<'au' | 'nz' | 'other'>('au')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!name.trim()) {
      newErrors.name = 'Customer name is required'
    }

    if (domain.trim() && !isValidDomain(domain)) {
      newErrors.domain = 'Please enter a valid domain (e.g., example.com)'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const isValidDomain = (url: string) => {
    try {
      // Allow just domain or full URL
      if (!url.includes('://')) {
        new URL(`https://${url}`)
      } else {
        new URL(url)
      }
      return true
    } catch {
      return false
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit({
        name: name.trim(),
        domain: domain.trim() || '',
        targetMarket,
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Basic Information</h2>
        <p className="text-slate-600">Tell us about the customer you&apos;re onboarding</p>
      </div>

      {/* Customer Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
          Customer Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., CTS Tours Aotearoa"
          className={`w-full px-4 py-2 rounded-lg border transition-colors ${
            errors.name
              ? 'border-red-500 bg-red-50'
              : 'border-slate-300 bg-white hover:border-slate-400'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          disabled={loading}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name}</p>
        )}
      </div>

      {/* Domain */}
      <div>
        <label htmlFor="domain" className="block text-sm font-medium text-slate-700 mb-2">
          Website Domain <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="domain"
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="e.g., ctstours.co.nz or https://ctstours.co.nz"
          className={`w-full px-4 py-2 rounded-lg border transition-colors ${
            errors.domain
              ? 'border-red-500 bg-red-50'
              : 'border-slate-300 bg-white hover:border-slate-400'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          disabled={loading}
        />
        {errors.domain && (
          <p className="mt-1 text-sm text-red-600">{errors.domain}</p>
        )}
      </div>

      {/* Target Market */}
      <div>
        <label htmlFor="market" className="block text-sm font-medium text-slate-700 mb-2">
          Primary Market <span className="text-red-500">*</span>
        </label>
        <select
          id="market"
          value={targetMarket}
          onChange={(e) =>
            setTargetMarket(e.target.value as 'au' | 'nz' | 'other')
          }
          className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
          disabled={loading}
        >
          <option value="au">Australia (AU)</option>
          <option value="nz">New Zealand (NZ)</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Submit Button */}
      <div className="pt-6">
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? 'Creating client...' : 'Continue to Step 2'}
        </button>
      </div>
    </form>
  )
}
