import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebIntelligencePanel } from '../WebIntelligencePanel'

const clients = { clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }] }
const payload = (id = 'a') => ({
  client: { id, name: `Client ${id.toUpperCase()}` }, settings: null,
  competitors: [{ domain: 'example.com', tier: 'core', status: 'active', sources: ['legacy'], tags: [], urls: ['https://example.com/'], interval_hours: 24 }],
  signals: [], evidence: [], runs: [], budget: { accounted_nzd: 3, reserved_nzd: 2 }, can_edit: true, can_run: true,
})
const response = (data: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data } as Response)
async function selectClient(id = 'a') {
  await screen.findByRole('option', { name: 'Client A' })
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: id } })
}
afterEach(() => vi.unstubAllGlobals())

describe('WebIntelligencePanel', () => {
  it('defaults to disabled settings with unconfirmed currency and preserves existing discovery sources', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : payload())))
    render(<WebIntelligencePanel />)
    await selectClient()
    expect(await screen.findByText(/Not configured/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monitoring enabled')).not.toBeChecked()
    expect(screen.getByLabelText('Membership currency')).toHaveValue('')
    expect(screen.getByLabelText('legacy')).toBeChecked()
    expect(screen.getByText(/Accounted: NZ\$3.00/)).toBeInTheDocument()
    expect(screen.getByText(/never executed automatically/)).toBeInTheDocument()
  })

  it('saves metadata only through the existing competitor endpoint and surfaces collection errors', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return response({ error: 'Metadata update rejected' }, false)
      if (init?.method === 'POST') return response({ error: 'Monthly hard stop reached' }, false)
      return response(url === '/api/clients' ? clients : payload())
    })
    vi.stubGlobal('fetch', fetcher)
    render(<WebIntelligencePanel />)
    await selectClient()
    await screen.findByText('example.com')
    fireEvent.change(screen.getByLabelText('Tags (comma separated)'), { target: { value: 'priority, travel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save competitor settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Metadata update rejected')
    const call = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(call[0]).toBe('/api/clients/a/competitor-domains')
    expect(JSON.parse(call[1]!.body as string)).toEqual({ monitoring: { ...payload().competitors[0], tags: ['priority', 'travel'] } })
    fireEvent.click(screen.getByRole('button', { name: 'Collect website' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Monthly hard stop reached')
  })

  it('clears client-private results immediately and ignores late previous-client responses', async () => {
    let resolveA!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/clients') return response(clients)
      if (url.includes('/a/')) return new Promise<Response>(resolve => { resolveA = resolve })
      return response({ ...payload('b'), competitors: [{ ...payload().competitors[0], domain: 'private-b.example' }] })
    }))
    render(<WebIntelligencePanel />)
    await selectClient()
    await selectClient('b')
    await screen.findByText('private-b.example')
    await act(async () => { resolveA(await response(payload())) })
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
    expect(screen.getByText('private-b.example')).toBeInTheDocument()
    await selectClient('')
    expect(screen.queryByText('private-b.example')).not.toBeInTheDocument()
  })

  it('renders read-only evidence and recommendations without an execute control', async () => {
    const data = { ...payload(), can_edit: false, can_run: false,
      evidence: [{ id: 'e2', source_url: 'https://example.com/news', excerpt: 'New service announced', observed_at: '2026-09-09', content_hash: 'abc' }],
      signals: [{ id: 's1', domain: 'example.com', kind: 'website', before_evidence_id: null, after_evidence_id: 'e2', interpretation_status: 'completed', classification: 'opportunity', interpretation: { summary: 'A new service may affect demand.', confidence: 0.8 }, recommended_action: 'Review positioning', created_at: '2026-09-09' }],
    }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />)
    await selectClient()
    await screen.findByText('Review positioning', { exact: false })
    expect(screen.getByLabelText('Monitoring enabled')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Collect website' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
    const signals = screen.getByRole('region', { name: 'Market signals' })
    expect(within(signals).getByRole('link')).toHaveAttribute('href', 'https://example.com/news')
    expect(within(signals).getByText('New service announced')).toBeInTheDocument()
    expect(within(signals).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows settings-save errors instead of implying success', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'PATCH'
      ? response({ error: 'Exchange rate is stale' }, false) : response(url === '/api/clients' ? clients : payload())))
    render(<WebIntelligencePanel />)
    await selectClient()
    await screen.findByRole('button', { name: 'Save settings' })
    fireEvent.change(screen.getByLabelText('Exchange rate date'), { target: { value: '2026-09-09' } })
    fireEvent.change(screen.getByLabelText('Collector version'), { target: { value: '0.0.1' } })
    fireEvent.change(screen.getByLabelText('USD to NZD rate'), { target: { value: '1.7' } })
    fireEvent.change(screen.getByLabelText('Per-capture limit (USD)'), { target: { value: '0.1' } })
    fireEvent.change(screen.getByLabelText('Per-capture overhead reserve (NZD)'), { target: { value: '0.02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Exchange rate is stale'))
  })
})
