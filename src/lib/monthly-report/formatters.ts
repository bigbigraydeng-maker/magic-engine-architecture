export function formatLabel(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'N/A'
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return value.toFixed(2)
    }
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : '')
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).slice(0, 50)
  }
  return String(value)
}
