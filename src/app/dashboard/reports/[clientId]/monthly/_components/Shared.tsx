/**
 * Shared components for Monthly Report panels
 * KpiCard, SectionHeader, EmptyState — used by all Phase 7+8 sections
 */
import React from 'react'

export function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
        {number}
      </span>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
    </div>
  )
}

export function KpiCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string
  value: string
  sub: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${
      highlight ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
    }`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <div>{sub}</div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-gray-400 text-center py-8">
      {message}
    </p>
  )
}

export function delta(n: number | null, invert = false) {
  if (n == null) return <span className="text-xs text-gray-400">—</span>
  const good = invert ? n < 0 : n > 0
  const bad  = invert ? n > 0 : n < 0
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '→'
  const color = good ? 'text-green-600' : bad ? 'text-red-500' : 'text-gray-500'
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {arrow} {Math.abs(n)}
    </span>
  )
}
