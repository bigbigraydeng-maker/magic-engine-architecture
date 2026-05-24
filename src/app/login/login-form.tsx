'use client'

import { useState, useEffect } from 'react'

export default function LoginForm({ next, authFailed }: { next: string; authFailed?: boolean }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Parse Supabase hash-fragment errors (e.g. #error_code=otp_expired)
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    const code = params.get('error_code')
    if (code === 'otp_expired') {
      setError('Magic link has expired. Please request a new one.')
    } else if (code) {
      setError('Authentication failed. Please try again.')
    }
    // Clean hash from URL without reload
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

      // Send magic link server-side (no PKCE) so it works regardless of which
      // browser or email client the user clicks the link from.
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), redirectTo }),
      })

      if (!res.ok) {
        setError('Unable to send link. Please try again.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Unable to send link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">📬</div>
        <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
        <p className="text-gray-400 text-sm">
          Magic link sent to <span className="text-indigo-400">{email}</span>.
          <br />Link expires in 15 minutes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@magiclab.com"
          className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {(error || authFailed) && (
        <p className="text-red-400 text-sm">
          {error || 'Authentication failed. Please try again.'}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
      >
        {loading ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  )
}
