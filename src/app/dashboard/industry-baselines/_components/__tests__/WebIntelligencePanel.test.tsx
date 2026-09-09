import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebIntelligencePanel } from '../WebIntelligencePanel'

const clients = { clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }] }
const baseCompetitor = { domain: 'example.com', tier: 'core', status: 'active', sources: ['legacy'], tags: [], urls: ['https://example.com/tours/'], interval_hours: 24 }
const payload = (id = 'a') => ({
  client: { id, name: `Client ${id.toUpperCase()}` }, settings: null,
  competitors: [baseCompetitor], signals: [], evidence: [], runs: [],
  budget: { accounted_nzd: 3, reserved_nzd: 2 }, can_edit: true, can_run: true,
})
const response = (data: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data } as Response)
async function selectClient(id = 'a') {
  await screen.findByRole('option', { name: 'Client A' })
  fireEvent.change(screen.getByLabelText('客户'), { target: { value: id } })
}
function openSection(name: string) { fireEvent.click(screen.getByText(name)) }
afterEach(() => vi.unstubAllGlobals())

describe('WebIntelligencePanel IMPACT flow', () => {
  it('puts one analysis action and the decision result ahead of configuration', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : payload())))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByRole('button', { name: '开始竞争分析' })).toBeVisible()
    expect(screen.getByText('本次将分析 1 家竞品、1 个页面')).toBeVisible()
    expect(screen.getByText('还没有可用的竞争分析')).toBeVisible()
    expect(screen.getByRole('region', { name: 'IMPACT 进度' })).toHaveTextContent('I发现变化M衡量影响P建议下一步A尚未执行C执行后验证T根据结果调优')
    expect(screen.getByLabelText('开启监控')).not.toBeVisible()
    openSection('成本、运行记录与证据')
    expect(screen.getByLabelText('开启监控')).not.toBeChecked()
  })

  it('queues configured pages in core-first order and retries only the failed identity', async () => {
    const data = { ...payload(), competitors: [
      { ...baseCompetitor, domain: 'watch.example', tier: 'watch', urls: ['https://watch.example/tours/'] },
      baseCompetitor,
    ] }
    const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011']
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift()) })
    let posts = 0
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/clients') return response(clients)
      if (init?.method === 'POST') return ++posts === 2 ? response({ error: 'Monthly hard stop reached' }, false) : response({ status: 'queued', request_id: JSON.parse(init.body as string).request_id })
      return response(data)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<WebIntelligencePanel />); await selectClient()
    fireEvent.click(await screen.findByRole('button', { name: '开始竞争分析' }))
    expect(await screen.findByText(/1\/2 个页面已开始，1 个页面/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续未完成页面' }))
    await waitFor(() => expect(posts).toBe(3))
    expect(screen.getByRole('button', { name: '开始新一轮竞争分析' })).toBeVisible()
    const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string))
    expect(bodies[0].domain).toBe('example.com')
    expect(bodies[1].request_id).toBe(bodies[2].request_id)
  })

  it('does not present an old signal as the result of a newer unchanged run', async () => {
    const data = { ...payload(), runs: [{
      id: 'new-run', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null,
      created_at: '2026-09-10T01:00:00Z', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0,
    }], signals: [{
      id: 'old-signal', run_id: 'old-run', domain: 'example.com', kind: 'business_page_changed', before_evidence_id: null, after_evidence_id: null,
      interpretation_status: 'complete', classification: 'threat', interpretation: { summary: 'Old misleading conclusion' }, recommended_action: 'Old action', created_at: '2026-09-09T01:00:00Z',
    }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次没有发现需要调衡的竞争变化')).toBeVisible()
    expect(screen.getByText('覆盖状态：1/1 个页面完成')).toBeVisible()
    expect(screen.getByText('Old misleading conclusion')).not.toBeVisible()
    openSection('历史分析 · 1 条')
    expect(screen.getByText('Old misleading conclusion')).toBeVisible()
  })

  it('shows current evidence as Inspect, Measure and Prescribe without claiming execution', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Standard price $1,200\nAvailable', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Earlybird price $950\nOnly 3 spaces left', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: '竞品降价并接近售罄。', confidence: 0.9 }, recommended_action: '比较同类产品价值，并决定是否调整优惠。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('I · 发现了什么')).toBeVisible()
    expect(screen.getByText('M · 竞争影响')).toBeVisible()
    expect(screen.getByText('P · 建议下一步')).toBeVisible()
    expect(screen.getByText(/A 尚未执行 · C\/T 将在执行并获得结果后启用/)).toBeVisible()
    expect(screen.getByText('+ Earlybird price $950')).toBeVisible()
    expect(screen.getByText('− Standard price $1,200')).toBeVisible()
  })

  it('reports partial coverage instead of a safe conclusion', async () => {
    const data = { ...payload(), runs: [{ id: 'failed', domain: 'example.com', url: 'https://example.com/tours/', status: 'failed', provider_status: 'FAILED', error_code: 'capture_invalid', created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0 }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次覆盖不足，暂不能下结论')).toBeVisible()
    expect(screen.getByText(/1 个未完成/)).toBeVisible()
  })

  it('does not call a partially observed watchlist safe', async () => {
    const data = { ...payload(), competitors: [baseCompetitor, { ...baseCompetitor, domain: 'unseen.example', urls: ['https://unseen.example/tours/'] }], runs: [{ id: 'done', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0 }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次覆盖不足，暂不能下结论')).toBeVisible()
    expect(screen.getByText(/1 个尚未运行/)).toBeVisible()
    expect(screen.queryByText('最近一次没有发现需要调衡的竞争变化')).not.toBeInTheDocument()
  })

  it('clears one client private result while another client is loading', async () => {
    let resolveA!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/clients') return response(clients)
      if (url.includes('/a/')) return new Promise<Response>(resolve => { resolveA = resolve })
      return response({ ...payload('b'), competitors: [{ ...baseCompetitor, domain: 'private-b.example', urls: [] }] })
    }))
    render(<WebIntelligencePanel />); await selectClient(); await selectClient('b')
    await screen.findByText('Client B · 竞争分析'); openSection('管理监控范围'); await screen.findByText('private-b.example')
    await act(async () => resolveA(await response(payload())))
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })
})
