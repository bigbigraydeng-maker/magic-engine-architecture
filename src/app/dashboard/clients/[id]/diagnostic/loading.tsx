export default function DiagnosticLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 bg-gray-200 rounded" />
          <div className="h-9 w-32 bg-gray-200 rounded-lg" />
        </div>

        {/* Score grid skeleton — 2×3 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-gray-100 p-5 h-24" />
          ))}
        </div>

        {/* Findings list skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 h-24" />
          ))}
        </div>
      </div>
    </div>
  )
}
