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
  fireEvent.change(screen.getByLabelText('客户'), { target: { value: id } })
}
async function view(name: string) { fireEvent.click(await screen.findByRole('button', { name })) }
async function competitor() { await view('监控对象'); fireEvent.click(await screen.findByText('example.com')) }
afterEach(() => vi.unstubAllGlobals())

describe('WebIntelligencePanel', () => {
  it('starts with readable results and exposes configuration only when requested', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : payload())))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('还没有变化情报')).toBeInTheDocument()
    expect(screen.queryByLabelText('开启监控')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采集此页面' })).not.toBeInTheDocument()
    expect(screen.getByText(/招聘.*尚未接入/)).toBeInTheDocument()
    await view('设置')
    expect(screen.getByLabelText('开启监控')).not.toBeChecked()
    expect(screen.getByLabelText('会员币种')).toHaveValue('')
    await competitor()
    expect(screen.getByLabelText('legacy')).toBeChecked()
  })

  it('preserves existing metadata routes and surfaces paid capture refusal', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return response({ error: 'Metadata update rejected' }, false)
      if (init?.method === 'POST') return response({ error: 'Monthly hard stop reached' }, false)
      return response(url === '/api/clients' ? clients : payload())
    })
    vi.stubGlobal('fetch', fetcher)
    render(<WebIntelligencePanel />); await selectClient(); await competitor()
    fireEvent.change(screen.getByLabelText('标签（逗号分隔）'), { target: { value: 'priority, travel' } })
    fireEvent.click(screen.getByRole('button', { name: '保存竞品设置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Metadata update rejected')
    const call = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(call[0]).toBe('/api/clients/a/competitor-domains')
    expect(JSON.parse(call[1]!.body as string)).toEqual({ monitoring: { ...payload().competitors[0], tags: ['priority', 'travel'] } })
    fireEvent.click(screen.getByRole('button', { name: '采集此页面' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Monthly hard stop reached')
  })

  it('clears client-private results immediately and ignores late previous-client responses', async () => {
    let resolveA!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/clients') return response(clients)
      if (url.includes('/a/')) return new Promise<Response>(resolve => { resolveA = resolve })
      return response({ ...payload('b'), competitors: [{ ...payload().competitors[0], domain: 'private-b.example' }] })
    }))
    render(<WebIntelligencePanel />); await selectClient(); await selectClient('b'); await view('监控对象')
    await screen.findByText('private-b.example')
    await act(async () => { resolveA(await response(payload())) })
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
    await selectClient('')
    expect(screen.queryByText('private-b.example')).not.toBeInTheDocument()
  })

  it('keeps failed analysis visible, groups ignore results and collapses raw evidence', async () => {
    const data = { ...payload(), can_edit: false, can_run: false,
      evidence: [{ id: 'e2', source_url: 'https://example.com/news', excerpt: 'Long original source text', observed_at: '2026-09-09', content_hash: 'abc' }],
      signals: [
        { id: 's1', domain: 'ignored.example', kind: 'website', before_evidence_id: null, after_evidence_id: 'e2', interpretation_status: 'complete', classification: 'ignore', interpretation: { summary: 'No material change.', confidence: 0.8 }, recommended_action: 'No action recommended.', created_at: '2026-09-09' },
        { id: 's2', domain: 'failed.example', kind: 'website', before_evidence_id: null, after_evidence_id: 'e2', interpretation_status: 'failed', classification: null, interpretation: null, recommended_action: null, created_at: '2026-09-09' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('分析未完成')).toBeVisible()
    expect(screen.getByText('No material change.')).not.toBeVisible()
    fireEvent.click(screen.getByText('无需行动 · 1 条'))
    expect(screen.getByText('无需采取行动。')).toBeVisible()
    expect(screen.getAllByText('Long original source text').every(el => !el.closest('details')?.open)).toBe(true)
    const signals = screen.getByRole('region', { name: '竞品情报' })
    expect(within(signals).getAllByRole('link')[0]).toHaveAttribute('href', 'https://example.com/news')
    expect(within(signals).queryByRole('button')).not.toBeInTheDocument()
    await view('设置'); expect(screen.getByLabelText('开启监控')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument()
  })

  it('remounts saved settings only after the refreshed payload arrives', async () => {
    const settings = { enabled: false, entitled: false, entitlement_price: 499, entitlement_currency: 'NZD', target_nzd: 30, hard_stop_nzd: 50, usd_to_nzd: 1.7, fx_as_of: '2026-09-09', actor_build: '0.3.97', capture_limit_usd: 0.1, overhead_nzd: 0.02, context: 'original' }
    let readCount = 0, resolveRefresh!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/clients') return response(clients)
      if (init?.method === 'PATCH') return response({ ok: true })
      if (++readCount > 1) return new Promise<Response>(resolve => { resolveRefresh = resolve })
      return response({ ...payload(), settings })
    }))
    render(<WebIntelligencePanel />); await selectClient(); await view('设置')
    fireEvent.change(screen.getByLabelText('客户分析背景'), { target: { value: 'saved context' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(readCount).toBe(2))
    expect(screen.getByLabelText('客户分析背景')).toHaveValue('saved context')
    await act(async () => resolveRefresh(await response({ ...payload(), settings: { ...settings, context: 'saved context' } })))
    expect(screen.getByLabelText('客户分析背景')).toHaveValue('saved context')
  })
})
