'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewTourButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/group-tours`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '新建失败')
      const { tour } = await res.json()
      router.push(`/dashboard/clients/${clientId}/tours/${tour.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建失败')
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre disabled:opacity-50"
      >
        {busy ? '创建中…' : '新增团'}
      </button>
      {error && <span className="text-xs font-semibold text-[#C2453A]">{error}</span>}
    </span>
  )
}
