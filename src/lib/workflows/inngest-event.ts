export interface InngestOutboundEvent<TData extends Record<string, unknown>> {
  id: string
  name: string
  data: TData
}

export interface InngestSendResult {
  event_ids: string[]
}

export async function sendInngestEvent<TData extends Record<string, unknown>>(
  event: InngestOutboundEvent<TData>,
  options: {
    eventKey?: string
    fetcher?: typeof fetch
  } = {}
): Promise<InngestSendResult> {
  const eventKey = options.eventKey ?? process.env.INNGEST_EVENT_KEY
  if (!eventKey?.trim()) throw new Error('INNGEST_EVENT_KEY_MISSING')

  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`https://inn.gs/e/${encodeURIComponent(eventKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })

  if (!response.ok) throw new Error(`INNGEST_EVENT_SEND_FAILED:${response.status}`)

  const json = await response.json().catch(() => null)
  const ids = parseEventIds(json)
  if (ids.length === 0) throw new Error('INNGEST_EVENT_RECEIPT_MISSING')
  return { event_ids: ids }
}

function parseEventIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const record = json as Record<string, unknown>
  const ids = record.ids ?? record.event_ids
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (typeof record.id === 'string' && record.id.length > 0) return [record.id]
  return []
}
