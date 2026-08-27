import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listPullRequestFiles } from '../src/github.mjs'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('listPullRequestFiles', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a single page as-is when it is short of 100 entries', async () => {
    const batch = [{ filename: 'a.ts' }, { filename: 'b.ts' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files).toEqual(batch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('page=1')
  })

  it('follows pagination across multiple full pages and stops at the short one', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `p1-${i}.ts` }))
    const page2 = Array.from({ length: 100 }, (_, i) => ({ filename: `p2-${i}.ts` }))
    const page3 = [{ filename: 'last.ts' }]
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
      .mockResolvedValueOnce(jsonResponse(page3))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files).toHaveLength(201)
    expect(files[0]).toEqual({ filename: 'p1-0.ts' })
    expect(files[200]).toEqual({ filename: 'last.ts' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('preserves rename metadata untouched', async () => {
    const batch = [{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files[0]).toMatchObject({ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed' })
  })

  it('throws rather than returning a partial list when a page request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, false, 500))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).rejects.toThrow(/failed: 500/)
  })

  it('fails closed if pagination never terminates within the page cap', async () => {
    // Every page comes back full (100 entries), so the loop never sees the
    // "short page" signal that normally ends it. Getting a list back here
    // would be a silently truncated one dressed up as complete.
    fetchMock.mockImplementation(async () => jsonResponse(Array.from({ length: 100 }, () => ({ filename: 'x.ts' }))))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).rejects.toThrow(/did not terminate/)
  }, 20000)
})
