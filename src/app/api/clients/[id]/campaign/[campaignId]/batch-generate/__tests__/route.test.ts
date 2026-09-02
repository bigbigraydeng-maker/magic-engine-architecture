import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import JSZip from 'jszip'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  getActiveBrief: vi.fn(),
  getCampaignById: vi.fn(),
  auditSocialPost: vi.fn(),
  createCompletion: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))
vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: mocks.getActiveBrief,
  formatBriefForPrompt: vi.fn(() => 'brand brief'),
}))
vi.mock('@/lib/content/campaign-injector', () => ({
  getCampaignById: mocks.getCampaignById,
  formatCampaignForPrompt: vi.fn(() => 'campaign brief'),
}))
vi.mock('@/lib/content/social-quality-audit', () => ({
  auditSocialPost: mocks.auditSocialPost,
}))
vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: vi.fn(() => ({
    chat: { completions: { create: mocks.createCompletion } },
  })),
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

describe('campaign batch generation — campaign itinerary uploads', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: true })
    mocks.getActiveBrief.mockResolvedValue({ id: 'brief-1', brand_name: 'Test Brand' })
    mocks.getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      title: 'Christmas campaign',
      source_file_urls: ['campaigns/china-icons.docx'],
      semrush_keywords: [{ keyword: 'Christmas China tour' }],
    })
    mocks.download.mockResolvedValue({ data: await itineraryDocx(), error: null })
    mocks.auditSocialPost.mockResolvedValue(null)
    mocks.createCompletion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        title: 'Christmas in China',
        script: 'Grounded draft',
        caption: 'Grounded caption',
        hashtags: ['#travel'],
        visual_brief: 'Market lights',
      }) } }],
    })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'content_posts') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: [{ id: 'post-1', title: 'Christmas in China' }],
              error: null,
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  })

  it('injects extracted DOCX date facts into the Content Engine system prompt', async () => {
    const req = new NextRequest(
      `http://localhost/api/clients/${CLIENT_ID}/campaign/${CAMPAIGN_ID}/batch-generate`,
      {
        method: 'POST',
        body: JSON.stringify({
          platforms: ['facebook'],
          direction_note: 'Christmas campaign',
          route_a_count: 1,
          route_c_count: 0,
        }),
      },
    )

    const res = await POST(req, { params: { id: CLIENT_ID, campaignId: CAMPAIGN_ID } })

    expect(res.status).toBe(200)
    expect(mocks.createCompletion).toHaveBeenCalledOnce()
    const messages = mocks.createCompletion.mock.calls[0][0].messages as Array<{ role: string; content: string }>
    const systemPrompt = messages.find(message => message.role === 'system')?.content ?? ''
    expect(systemPrompt).toContain('12/24 Christmas Eve')
    expect(systemPrompt).toContain('12/31 New Year Eve')
    expect(systemPrompt).not.toContain('PK')
  })

  it('marks PDF facts as unread instead of pretending they grounded the draft', async () => {
    mocks.getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      title: 'Christmas campaign',
      source_file_urls: ['campaigns/china-icons.pdf'],
      semrush_keywords: [{ keyword: 'Christmas China tour' }],
    })
    mocks.download.mockResolvedValue({
      data: new Blob(['pdf-itinerary'], { type: 'application/pdf' }),
      error: null,
    })
    const req = new NextRequest(
      `http://localhost/api/clients/${CLIENT_ID}/campaign/${CAMPAIGN_ID}/batch-generate`,
      {
        method: 'POST',
        body: JSON.stringify({
          platforms: ['facebook'],
          direction_note: 'Christmas campaign',
          route_a_count: 1,
          route_c_count: 0,
        }),
      },
    )

    const res = await POST(req, { params: { id: CLIENT_ID, campaignId: CAMPAIGN_ID } })

    expect(res.status).toBe(200)
    const messages = mocks.createCompletion.mock.calls[0][0].messages as Array<{ role: string; content: string }>
    const systemPrompt = messages.find(message => message.role === 'system')?.content ?? ''
    expect(systemPrompt).toContain('1 个活动资料未被本生成路径读取')
    expect(systemPrompt).toContain('不得引用或推断其中事实')
    expect(systemPrompt).not.toContain('pdf-itinerary')
  })
})
