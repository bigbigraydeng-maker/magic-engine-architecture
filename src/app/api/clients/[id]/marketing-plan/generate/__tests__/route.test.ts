import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import JSZip from 'jszip'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  getCampaignById: vi.fn(),
  generatePlanData: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))
vi.mock('@/lib/content/brief-injector', () => ({
  formatBriefForPrompt: vi.fn(() => 'brand brief'),
}))
vi.mock('@/lib/content/campaign-injector', () => ({
  getCampaignById: mocks.getCampaignById,
  formatCampaignForPrompt: vi.fn(() => 'campaign brief'),
}))
vi.mock('@/lib/marketing-plan/generator', () => ({
  generatePlanData: mocks.generatePlanData,
  formatStrategySuggestions: vi.fn(() => ''),
  formatViralReferences: vi.fn(() => ''),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    storage: { from: vi.fn(() => ({ download: mocks.download })) },
  },
}))

import { POST } from '../route'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'ca000000-0000-0000-0000-000000000001'

async function itineraryDocx(): Promise<Blob> {
  const zip = new JSZip()
  zip.file('word/document.xml', [
    '<w:document><w:body>',
    '<w:p><w:r><w:t>12/24 Christmas Eve at Waitanyuan Christmas Market</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>12/31 New Year Eve at Datang Everbright City</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join(''))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

function queryWithResult(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'or', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  return chain
}

describe('marketing-plan generate — campaign itinerary uploads', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: true })
    mocks.getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      source_file_urls: ['campaigns/china-icons.docx'],
    })
    mocks.download.mockResolvedValue({ data: await itineraryDocx(), error: null })
    mocks.generatePlanData.mockResolvedValue({
      plan_data: { social: {}, blog: { monthly_count: 0, topics: [] }, kpis: {}, tasks: [] },
      meta: { model: 'test', generation_cost_usd: 0 },
    })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return queryWithResult({ data: { id: 'brief-1' }, error: null })
      }
      if (table === 'content_strategy_items' || table === 'viral_reference_library') {
        const chain = queryWithResult({ data: [], error: null })
        chain.limit = vi.fn(async () => ({ data: [], error: null }))
        return chain
      }
      if (table === 'marketing_plans') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 'plan-1' }, error: null })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  })

  it('extracts DOCX text so date-specific itinerary facts reach Strategy Engine input', async () => {
    const req = new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/marketing-plan/generate`, {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: CAMPAIGN_ID,
        title: 'Christmas campaign',
        start_date: '2026-12-22',
        end_date: '2027-01-02',
      }),
    })

    const res = await POST(req, { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    expect(mocks.generatePlanData).toHaveBeenCalledOnce()
    const args = mocks.generatePlanData.mock.calls[0][0]
    expect(args.campaignDocs).toEqual([
      expect.objectContaining({ type: 'text', filename: 'china-icons.docx' }),
    ])
    expect(args.campaignDocs[0].content).toContain('12/24 Christmas Eve')
    expect(args.campaignDocs[0].content).toContain('12/31 New Year Eve')
    expect(args.campaignDocs[0].content).not.toContain('PK')
  })

  it('keeps PDF uploads on the existing document input path', async () => {
    mocks.getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      source_file_urls: ['campaigns/china-icons.pdf'],
    })
    mocks.download.mockResolvedValue({
      data: new Blob(['pdf-itinerary'], { type: 'application/pdf' }),
      error: null,
    })
    const req = new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/marketing-plan/generate`, {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: CAMPAIGN_ID,
        title: 'Christmas campaign',
        start_date: '2026-12-22',
        end_date: '2027-01-02',
      }),
    })

    const res = await POST(req, { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const docs = mocks.generatePlanData.mock.calls[0][0].campaignDocs
    expect(docs).toEqual([
      expect.objectContaining({ type: 'pdf', filename: 'china-icons.pdf' }),
    ])
    expect(Buffer.from(docs[0].content, 'base64').toString()).toBe('pdf-itinerary')
  })
})
