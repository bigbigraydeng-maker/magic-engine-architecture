import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDatasetItems, getRun, runActor } from '../client'
import { getWebsiteCapture, startWebsiteCapture, WEBSITE_ACTOR } from '../website'
import type { ApifyRunResult } from '../types'
vi.mock('../client', () => ({ getDatasetItems: vi.fn(), getRun: vi.fn(), runActor: vi.fn() }))
const run: ApifyRunResult = { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'data1', startedAt: '2026-09-09', usageTotalUsd: 0.01 }
const page = () => ({ url: 'https://example.com/', markdown: 'A public product description with meaningful information. '.repeat(8), metadata: { title: 'Products' }, crawl: { httpStatusCode: 200, loadedUrl: 'https://example.com/' } })
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getRun).mockResolvedValue(run); vi.mocked(getDatasetItems).mockResolvedValue([page()]) })
describe('bounded Website capture', () => {
  it('starts exactly one approved URL with pinned build and provider cap', async () => {
    await startWebsiteCapture({ url: 'https://example.com/', build: '1.2.3', maxChargeUsd: 0.05 })
    expect(runActor).toHaveBeenCalledWith(WEBSITE_ACTOR, expect.objectContaining({ startUrls: [{ url: 'https://example.com/' }], proxyConfiguration: { useApifyProxy: true }, maxCrawlDepth: 0, maxCrawlPages: 1, saveFiles: false, saveContentTypes: '', summarize: false, expandIframes: false }), { build: '1.2.3', maxTotalChargeUsd: 0.05, timeout: 120, memory: 1024 })
  })
  it.each(['latest', '', '1.2'])('rejects unpinned build %s', async build => {
    await expect(startWebsiteCapture({ url: 'https://example.com', build, maxChargeUsd: 0.05 })).rejects.toThrow('pinned')
    expect(runActor).not.toHaveBeenCalled()
  })
  it('rejects invalid budget before provider start', async () => {
    await expect(startWebsiteCapture({ url: 'https://example.com', build: '1.2.3', maxChargeUsd: NaN })).rejects.toThrow('budget')
  })
  it.each(['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:444'])('rejects unsafe start %s', async url => {
    await expect(startWebsiteCapture({ url, build: '1.2.3', maxChargeUsd: 0.05 })).rejects.toThrow()
  })
  it('returns verified content and actual run usage', async () => {
    expect(await getWebsiteCapture('run1', 'https://example.com')).toEqual({ status: 'complete', run, page: { url: page().url, title: 'Products', text: page().markdown.trim() } })
  })
  it('does not read dataset for pending runs', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...run, status: 'RUNNING' })
    expect((await getWebsiteCapture('run1', 'https://example.com')).status).toBe('pending')
    expect(getDatasetItems).not.toHaveBeenCalled()
  })
  it('preserves failed run and its cost', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...run, status: 'TIMED-OUT' })
    expect(await getWebsiteCapture('run1', 'https://example.com')).toMatchObject({ status: 'failed', run: { usageTotalUsd: 0.01 } })
  })
  it.each([{ items: [] }, { items: [page(), page()] }])('rejects missing or multiple dataset pages', async ({ items }) => {
    vi.mocked(getDatasetItems).mockResolvedValue(items)
    expect((await getWebsiteCapture('run1', 'https://example.com')).status).toBe('failed')
  })
  it.each([
    { markdown: '' }, { markdown: 'too short' }, { truncated: true },
    { crawl: { httpStatusCode: 403 } }, { crawl: {} },
    { crawl: { httpStatusCode: 200, loadedUrl: 'https://evil.com/' } },
    { crawl: { httpStatusCode: 200, loadedUrl: 'http://example.com/' } },
    { metadata: { title: 'Just a moment' } },
  ])('rejects unreliable evidence %j', async patch => {
    vi.mocked(getDatasetItems).mockResolvedValue([{ ...page(), ...patch }])
    expect((await getWebsiteCapture('run1', 'https://example.com')).status).toBe('failed')
  })
  it('accepts www HTTPS alias', async () => {
    vi.mocked(getDatasetItems).mockResolvedValue([{ ...page(), crawl: { httpStatusCode: 200, loadedUrl: 'https://www.example.com/' } }])
    expect((await getWebsiteCapture('run1', 'https://example.com')).status).toBe('complete')
  })
  it('returns failure with run receipt if dataset read fails', async () => {
    vi.mocked(getDatasetItems).mockRejectedValue(new Error('dataset unavailable'))
    expect(await getWebsiteCapture('run1', 'https://example.com')).toMatchObject({ status: 'failed', run, error: 'dataset unavailable' })
  })
})
