/**
 * CampaignDailyPlanPanel — 7-day remediation (Build Control comment 5394505714).
 *
 * Ray's original Ray Experience FAIL: six of seven days looked empty even
 * though the API always only ever exposed one "current" bundle, and the
 * Post copy was truncated with no way to read the full text. These tests
 * lock down the fix at the component level: date selection actually swaps
 * the three formats shown, Post can be expanded/collapsed, and a day that
 * is PLANNED but has no bundle fails honestly instead of quietly reusing
 * whatever was already on screen.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CampaignDailyPlanPanel } from '../CampaignDailyPlanPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'campaign-uuid'

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    master_brief_grounding: true,
    campaign_grounding: true,
    evidence_grounding: 'UNKNOWN',
    client_asset_provenance: false,
    format_completeness: { post: true, story: true, reel: true },
    human_approval: false,
    provider_authorization: false,
    publishing_authorization: false,
    performance_outcome: 'UNKNOWN',
    ...overrides,
  }
}

function daysGrid(plannedDates: string[]) {
  const all = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
  return all.map(date => ({
    date,
    slots: {
      post: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      story: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      reel: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
    },
  }))
}

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CampaignDailyPlanPanel — date selection shows that day\'s three formats', () => {
  it('selecting a later populated day swaps Post/Story/Reel away from Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24', '2026-08-26']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook text', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
        {
          date: '2026-08-26',
          post: { hook: 'Day 3 hook text', body: 'Day 3 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 3 frame' }] },
          reel: { brief: 'Day 3 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook text')
    expect(screen.queryByText('Day 3 hook text')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('08-26'))

    await screen.findByText('Day 3 hook text')
    expect(screen.queryByText('Day 1 hook text')).not.toBeInTheDocument()
    expect(screen.getByText('Day 3 frame')).toBeInTheDocument()
    expect(screen.getByText('Day 3 reel brief')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — Post full text can be expanded and collapsed', () => {
  it('shows a 展开全文/收起 toggle that reveals and hides the full Post body', async () => {
    const longBody = 'A '.repeat(80) + 'end of the long post body.'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: longBody, cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'frame' }] },
          reel: { brief: 'brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('展开全文')
    fireEvent.click(screen.getByText('展开全文'))
    expect(screen.getByText('收起')).toBeInTheDocument()
    fireEvent.click(screen.getByText('收起'))
    expect(screen.getByText('展开全文')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — missing bundle fails honestly, never borrows another day', () => {
  it('shows NOT_PLANNED for a day marked PLANNED in the grid but absent from bundles, instead of showing Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      // days[] claims 08-25 is PLANNED (a data-shape mismatch), but no
      // matching entry exists in bundles — the UI must not paper over this.
      days: daysGrid(['2026-08-24', '2026-08-25']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook')

    fireEvent.click(screen.getByText('08-25'))

    await screen.findAllByText(/该日暂无排定内容/) // both the bundle and readiness sections honestly say so
    expect(screen.queryByText('Day 1 hook')).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — seven distinct Post thumbnails + clickable CTA (Ray remediation 5405438962)', () => {
  it('renders each day\'s own post_image thumbnail (unique preview URLs) and an anchor with the exact CTA URL', async () => {
    const dates = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
    const CTA = 'https://www.ctstours.co.nz/tours/china/discovery/china-icons-collection'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(dates),
      bundles: dates.map((d, i) => ({
        date: d,
        post: { hook: `Day ${i + 1} hook`, body: `Day ${i + 1} body`, cta: 'Enquire Now', image_asset_id: `asset-${i}`, cta_url: CTA },
        story: { frames: [{ order: 1, copy: `f${i}` }, { order: 2, copy: `f${i}` }, { order: 3, copy: `f${i}` }, { order: 4, copy: `f${i}` }] },
        reel: { brief: `r${i}`, script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
        readiness: readiness(),
        provenance: [],
        post_image: {
          id: `asset-${i}`,
          preview_url: `https://cts-assets.test/day${i}.jpg`,
          filename: `day${i}.jpg`,
          source: 'client_provided',
          ownership: 'client_exclusive',
        },
      })),
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Day 1: correct thumbnail src + Enquire Now anchor with the exact CTA URL.
    await screen.findByText('Day 1 hook')
    const day1Img = document.querySelector('img[alt="day0.jpg"]') as HTMLImageElement | null
    expect(day1Img).not.toBeNull()
    expect(day1Img!.src).toBe('https://cts-assets.test/day0.jpg')
    const day1Cta = document.querySelector('a[href="' + CTA + '"]') as HTMLAnchorElement | null
    expect(day1Cta).not.toBeNull()
    expect(day1Cta!.target).toBe('_blank')
    expect(day1Cta!.rel).toBe('noopener noreferrer')

    // Switch to Day 4: thumbnail must be a DIFFERENT src.
    fireEvent.click(screen.getByText('08-27'))
    await screen.findByText('Day 4 hook')
    const day4Img = document.querySelector('img[alt="day3.jpg"]') as HTMLImageElement | null
    expect(day4Img).not.toBeNull()
    expect(day4Img!.src).toBe('https://cts-assets.test/day3.jpg')
    expect(day4Img!.src).not.toBe('https://cts-assets.test/day0.jpg')
  })
})

describe('CampaignDailyPlanPanel — complete route must not omit Chongqing/Guangzhou', () => {
  it('renders the full 5-city route text on the recap day without dropping Chongqing or Guangzhou', async () => {
    const recapStory = 'The full journey: Shanghai → Beijing → Xi\'an → Chongqing → Guangzhou'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-30']),
      bundles: [
        {
          date: '2026-08-30',
          post: { hook: 'Final stop: Guangzhou', body: 'Journey recap', cta: 'Enquire Now' },
          story: { frames: [{ order: 3, copy: recapStory }] },
          reel: { brief: 'recap', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText(/The full journey/)
    const recap = screen.getByText(/The full journey/)
    expect(recap.textContent).toContain('Chongqing')
    expect(recap.textContent).toContain('Guangzhou')
    expect(recap.textContent).toContain('Shanghai')
    expect(recap.textContent).toContain('Beijing')
  })
})


describe('CampaignDailyPlanPanel — Reel readiness is script-only, media_status stays separate (Build Control TRUTHFUL READINESS)', () => {
  it('shows "Reel 脚本草稿完整" (not "Reel 草稿完整") AND still shows 暂无成片 for a NO_MEDIA Reel', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: 'body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'f1' }, { order: 2, copy: 'f2' }, { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' }] },
          reel: { brief: 'the reel brief', script: 'the script', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness({ format_completeness: { post: true, story: true, reel: true } }),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Script-complete label, not the old "Reel 草稿完整".
    await screen.findByText('Reel 脚本草稿完整')
    expect(screen.queryByText('Reel 草稿完整')).not.toBeInTheDocument()
    // NO_MEDIA banner stays visible so the reviewer never confuses a script
    // draft with a real video file.
    expect(screen.getByText(/暂无成片/)).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — conversion goal vs publishing destination (Build Control TRUTHFUL READINESS)', () => {
  it('shows lead_form_submit as 转化目标 with a Chinese explainer; destination reads UNKNOWN / 未连接, never the CTA', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'lead_form_submit' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'h', body: 'b', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'f1' }, { order: 2, copy: 'f2' }, { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' }] },
          reel: { brief: 'br', script: 'sc', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { conversion_goal: 'lead_form_submit', destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    // Conversion goal row surfaces lead_form_submit with a plain-Chinese explainer.
    await screen.findByText(/转化目标/)
    expect(screen.getByText('lead_form_submit')).toBeInTheDocument()
    expect(screen.getByText(/用户在落地页提交表单即算转化/)).toBeInTheDocument()

    // Destination row explicitly says UNKNOWN / 未连接; the primary_cta must
    // NOT be echoed as a destination.
    expect(screen.getByText(/发布目的地/)).toBeInTheDocument()
    expect(screen.getByText(/UNKNOWN \/ 未连接/)).toBeInTheDocument()
    expect(screen.getByText(/尚未绑定 Facebook Page/)).toBeInTheDocument()

    // Publish authorisation stays NOT_AUTHORIZED.
    expect(screen.getByText('NOT_AUTHORIZED')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — explicit Post-only review handoff', () => {
  it('binds the action to the loaded plan revision and shows a review link without publishing', async () => {
    const planPayload = {
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
      plan_id: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
      plan_revision: '2026-08-24T03:00:00.000Z',
    }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => planPayload })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          posts: { created: 7, existing: 0 },
          review_path: `/dashboard/content?client=${CLIENT_ID}&status=draft&highlight=post-1`,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => planPayload }) as unknown as typeof fetch

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    const action = await screen.findByRole('button', { name: '刷新七日并送审' })
    fireEvent.change(screen.getByLabelText('七日计划开始日期'), { target: { value: '2026-09-10' } })
    fireEvent.click(action)

    expect(await screen.findByText('✓ 已送入审核队列：新建 7 条，已有 0 条')).toBeInTheDocument()
    const requestInit = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as RequestInit
    expect(JSON.parse(requestInit.body as string)).toEqual({
      campaign_id: CAMPAIGN_ID,
      plan_id: planPayload.plan_id,
      expected_revision: planPayload.plan_revision,
      start_date: '2026-09-10',
    })
    expect(screen.getByRole('link', { name: /打开 Launch Hub 审核这 7 条 Post/ })).toHaveAttribute(
      'href',
      `/dashboard/content?client=${CLIENT_ID}&status=draft&highlight=post-1`,
    )
    expect(screen.getByText('发布：NOT_AUTHORIZED')).toBeInTheDocument()
  })

  it('does not show an old client review link after the panel switches client mid-request', async () => {
    const responseFor = (campaignId: string) => ({
      success: true,
      campaign: { id: campaignId, title: campaignId, offer: null, primary_cta: null },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid([]),
      bundles: [],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
      plan_id: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
      plan_revision: '2026-08-24T03:00:00.000Z',
    })
    let resolveOldRequest!: (value: { ok: true; json: () => Promise<unknown> }) => void
    const oldRequest = new Promise<{ ok: true; json: () => Promise<unknown> }>(resolve => {
      resolveOldRequest = resolve
    })
    global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (init?.method === 'POST') return oldRequest
      const campaign = new URL(href, 'http://localhost').searchParams.get('campaign_id') ?? CAMPAIGN_ID
      return Promise.resolve({ ok: true, json: async () => responseFor(campaign) })
    }) as unknown as typeof fetch

    const { rerender } = render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: '刷新七日并送审' }))
    rerender(<CampaignDailyPlanPanel clientId="other-client" campaignId="other-campaign" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))

    await act(async () => {
      resolveOldRequest({
        ok: true,
        json: async () => ({
          success: true,
          posts: { created: 7, existing: 0 },
          review_path: `/dashboard/content?client=${CLIENT_ID}&highlight=old-post`,
        }),
      })
      await oldRequest
    })

    expect(screen.queryByText(/已送入审核队列/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /打开 Launch Hub/ })).not.toBeInTheDocument()
  })

  it('ignores an old client failure and re-enables the new client action even if abort is ignored', async () => {
    const responseFor = (campaignId: string) => ({
      success: true,
      campaign: { id: campaignId, title: campaignId, offer: null, primary_cta: null },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid([]),
      bundles: [],
      publishing_plan: { conversion_goal: null, destination: 'UNKNOWN', status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
      plan_id: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
      plan_revision: '2026-08-24T03:00:00.000Z',
    })
    let resolveOldRequest!: (value: { ok: true; json: () => Promise<unknown> }) => void
    const oldRequest = new Promise<{ ok: true; json: () => Promise<unknown> }>(resolve => {
      resolveOldRequest = resolve
    })
    global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return oldRequest
      const campaign = new URL(String(url), 'http://localhost').searchParams.get('campaign_id') ?? CAMPAIGN_ID
      return Promise.resolve({ ok: true, json: async () => responseFor(campaign) })
    }) as unknown as typeof fetch

    const { rerender } = render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: '刷新七日并送审' }))
    rerender(<CampaignDailyPlanPanel clientId="other-client" campaignId="other-campaign" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '刷新七日并送审' })).toBeEnabled()
    })
    await act(async () => {
      resolveOldRequest({ ok: true, json: async () => ({ success: false, error: 'OLD_CLIENT_FAILURE' }) })
      await oldRequest
    })

    expect(screen.queryByText(/OLD_CLIENT_FAILURE/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新七日并送审' })).toBeEnabled()
  })
})
