'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StepIndicator from './components/StepIndicator'
import Step1BasicInfo from './components/Step1BasicInfo'
import Step2Workspace from './components/Step2Workspace'
import Step3Keywords from './components/Step3Keywords'

/** Map Step 1 market → SEMrush DB default for Step 3 */
function toSemrushDb(market: 'au' | 'nz' | 'other'): 'au' | 'nz' | 'us' {
  if (market === 'au') return 'au'
  if (market === 'nz') return 'nz'
  return 'us'
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [clientId, setClientId] = useState<string | null>(null)
  const [targetMarket, setTargetMarket] = useState<'au' | 'nz' | 'other'>('au')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Create new client
  const handleStep1Submit = async (data: {
    name: string
    domain: string
    targetMarket: 'au' | 'nz' | 'other'
  }) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/clients/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 1,
          name: data.name,
          domain: data.domain,
          target_market: data.targetMarket,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create client')
      }

      setClientId(result.client_id)
      setTargetMarket(data.targetMarket) // thread market to step 3
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Set up Airtable workspace (optional — clients can skip)
  const handleStep2Submit = async (data: {
    airtableBaseId: string
    airtableTableId?: string
  }) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/clients/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 2,
          client_id: clientId,
          airtable_base_id: data.airtableBaseId,
          airtable_content_table_id: data.airtableTableId,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to connect Airtable')
      }

      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Skip Airtable — proceed without workspace connection
  const handleStep2Skip = () => {
    setError(null)
    setStep(3)
  }

  // Step 3: Configure keywords and quota
  const handleStep3Submit = async (data: {
    semrushDb: string
    monthlyQuota: number
  }) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/clients/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 3,
          client_id: clientId,
          semrush_db: data.semrushDb,
          monthly_quota: data.monthlyQuota,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to complete setup')
      }

      // Redirect to client dashboard
      router.push(`/dashboard/clients/${clientId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
      setError(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Welcome to Magic Engine
          </h1>
          <p className="text-lg text-slate-600">
            Add your first client in just 3 steps
          </p>
        </div>

        {/* Step Indicator */}
        <StepIndicator currentStep={step} totalSteps={3} />

        {/* Card Container */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mt-8">
          {/* Error Alert */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
              {error}
            </div>
          )}

          {/* Step 1 */}
          {step === 1 && (
            <Step1BasicInfo onSubmit={handleStep1Submit} loading={loading} />
          )}

          {/* Step 2 — Airtable workspace (optional) */}
          {step === 2 && clientId && (
            <Step2Workspace
              onSubmit={handleStep2Submit}
              onSkip={handleStep2Skip}
              loading={loading}
              onBack={handleBack}
            />
          )}

          {/* Step 3 — pre-fill market from step 1 */}
          {step === 3 && clientId && (
            <Step3Keywords
              onSubmit={handleStep3Submit}
              loading={loading}
              onBack={handleBack}
              defaultMarket={toSemrushDb(targetMarket)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
