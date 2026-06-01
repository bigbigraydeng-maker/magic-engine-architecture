'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface BriefGateStatus {
  complete: boolean
  gated: boolean
  briefUrl?: string
}

interface Props {
  /** Label shown in the banner body explaining which feature is locked. */
  featureLabel: string
  /** Optional explicit client id. Falls back to the dashboard route param. */
  clientId?: string
  /** Optional layout classes for surfaces that need to preserve flex sizing while locked. */
  className?: string
  children: React.ReactNode
}

export function BriefGateBanner({ featureLabel, clientId, className, children }: Props) {
  const params = useParams<{ id?: string; clientId?: string }>()
  const resolvedClientId = clientId ?? params.id ?? params.clientId ?? ''
  const [status, setStatus] = useState<'checking' | 'open' | 'locked'>('checking')
  const [briefUrl, setBriefUrl] = useState('')

  useEffect(() => {
    if (!resolvedClientId) {
      setStatus('open')
      return
    }

    let active = true
    setStatus('checking')

    fetch(`/api/clients/${resolvedClientId}/brief-status`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('Brief status unavailable')
        return res.json() as Promise<BriefGateStatus>
      })
      .then(data => {
        if (!active) return
        setBriefUrl(data.briefUrl ?? `/dashboard/clients/${resolvedClientId}/brief`)
        setStatus(data.gated ? 'locked' : 'open')
      })
      .catch(() => {
        if (active) setStatus('open')
      })

    return () => {
      active = false
    }
  }, [resolvedClientId])

  if (status !== 'locked') return <>{children}</>

  const href = briefUrl || `/dashboard/clients/${resolvedClientId}/brief`

  return (
    <div className={['relative', className].filter(Boolean).join(' ')} data-testid="brief-gate">
      <div
        className="pointer-events-none select-none opacity-30 blur-[2px]"
        aria-hidden="true"
        data-testid="brief-gate-content"
      >
        {children}
      </div>

      <div className="absolute inset-0 flex items-start justify-center bg-white/55 px-4 pt-16 backdrop-blur-[1px]">
        <div
          className="w-full max-w-md rounded-xl border border-me-ochre/30 bg-[#fffaf0] p-6 shadow-lg shadow-me-ochre/10"
          data-testid="brief-gate-banner"
        >
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">
            Brand Brief required
          </p>
          <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-me-charcoal">
            Complete your brief to unlock {featureLabel}
          </h3>
          <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
            Magic Engine needs your brand context before it generates or executes work. The light brief takes about 2 minutes.
          </p>
          <Link
            href={href}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-me-ochre px-4 text-sm font-bold text-white hover:bg-me-ochre/90"
          >
            Complete brief &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}
