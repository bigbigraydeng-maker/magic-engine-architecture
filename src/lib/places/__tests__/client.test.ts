/**
 * Unit tests for src/lib/places/client.ts
 *
 * All tests mock global fetch — no real HTTP calls.
 * Covers:
 *   1. findPlace — maps API response to PlaceSearchResult
 *   2. getPlaceDetails — maps API response to PlaceDetails with reviews
 *   3. getBusinessReviews — returns { success: false, place: null } when place not found
 *   4. getPlacesApiKey — throws when GOOGLE_PLACES_API_KEY is missing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findPlace, getPlaceDetails, getBusinessReviews } from '../client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)
}

function mockFetchSequence(...responses: Array<{ body: unknown; status?: number }>): void {
  const mocks = responses.map(({ body, status = 200 }) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response)
  )
  global.fetch = vi.fn()
    .mockReturnValueOnce(mocks[0])
    .mockReturnValueOnce(mocks[1])
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_SEARCH_RESPONSE = {
  places: [
    {
      id: 'ChIJabc123',
      name: 'places/ChIJabc123',
      displayName: { text: 'Oztop Building Supplies', languageCode: 'en' },
      formattedAddress: '123 Moss St, Slacks Creek QLD 4127, Australia',
      rating: 4.3,
      userRatingCount: 87,
      businessStatus: 'OPERATIONAL',
    },
  ],
}

const MOCK_DETAILS_RESPONSE = {
  id: 'ChIJabc123',
  name: 'places/ChIJabc123',
  displayName: { text: 'Oztop Building Supplies', languageCode: 'en' },
  formattedAddress: '123 Moss St, Slacks Creek QLD 4127, Australia',
  rating: 4.3,
  userRatingCount: 87,
  businessStatus: 'OPERATIONAL',
  nationalPhoneNumber: '+61 7 3808 1234',
  websiteUri: 'https://oztop.com.au',
  reviews: [
    {
      authorAttributions: [{ displayName: 'Jane Smith' }],
      rating: 5,
      text: { text: 'Great service, very helpful staff!' },
      relativePublishTimeDescription: '2 months ago',
      publishTime: '2026-03-10T08:00:00Z',
    },
    {
      authorAttributions: [{ displayName: 'Bob Jones' }],
      rating: 4,
      text: { text: 'Good range of products.' },
      relativePublishTimeDescription: '4 months ago',
      publishTime: '2026-01-10T08:00:00Z',
    },
  ],
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-api-key-123')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── 1. findPlace ─────────────────────────────────────────────────────────────

describe('findPlace', () => {
  it('returns a correctly mapped PlaceSearchResult for the first match', async () => {
    mockFetchOnce(MOCK_SEARCH_RESPONSE)

    const result = await findPlace('Oztop Building Supplies Slacks Creek QLD')

    expect(result).not.toBeNull()
    expect(result!.placeId).toBe('places/ChIJabc123')
    expect(result!.name).toBe('Oztop Building Supplies')
    expect(result!.address).toBe('123 Moss St, Slacks Creek QLD 4127, Australia')
    expect(result!.rating).toBe(4.3)
    expect(result!.userRatingCount).toBe(87)
    expect(result!.businessStatus).toBe('OPERATIONAL')
  })

  it('returns null when the API returns an empty places array', async () => {
    mockFetchOnce({ places: [] })

    const result = await findPlace('NonExistent Business XYZ')

    expect(result).toBeNull()
  })

  it('returns null when the API returns no places key', async () => {
    mockFetchOnce({})

    const result = await findPlace('Nobody Here')

    expect(result).toBeNull()
  })

  it('sets rating to null when the place has no rating', async () => {
    const noRatingResponse = {
      places: [
        {
          id: 'ChIJnew',
          name: 'places/ChIJnew',
          displayName: { text: 'Brand New Business', languageCode: 'en' },
          formattedAddress: '1 New St, Brisbane QLD',
          userRatingCount: 0,
          businessStatus: 'OPERATIONAL',
          // no rating field
        },
      ],
    }
    mockFetchOnce(noRatingResponse)

    const result = await findPlace('Brand New Business Brisbane')

    expect(result).not.toBeNull()
    expect(result!.rating).toBeNull()
  })

  it('throws Places API error when HTTP status is not 2xx', async () => {
    mockFetchOnce({ error: { message: 'API key invalid' } }, 403)

    await expect(findPlace('Oztop Building Supplies')).rejects.toThrow(
      'Places API error: searchText returned HTTP 403'
    )
  })

  it('calls fetch with POST method and correct FieldMask header', async () => {
    mockFetchOnce(MOCK_SEARCH_RESPONSE)

    await findPlace('Test Query')

    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText')
    expect((options.method as string).toUpperCase()).toBe('POST')
    const headers = options.headers as Record<string, string>
    expect(headers['X-Goog-FieldMask']).toContain('places.id')
    expect(headers['X-Goog-Api-Key']).toBe('test-api-key-123')
  })
})

// ─── 2. getPlaceDetails ───────────────────────────────────────────────────────

describe('getPlaceDetails', () => {
  it('returns PlaceDetails with mapped reviews', async () => {
    mockFetchOnce(MOCK_DETAILS_RESPONSE)

    const result = await getPlaceDetails('places/ChIJabc123')

    expect(result).not.toBeNull()
    expect(result!.placeId).toBe('places/ChIJabc123')
    expect(result!.name).toBe('Oztop Building Supplies')
    expect(result!.phoneNumber).toBe('+61 7 3808 1234')
    expect(result!.website).toBe('https://oztop.com.au')
    expect(result!.reviews).toHaveLength(2)
  })

  it('maps review fields correctly', async () => {
    mockFetchOnce(MOCK_DETAILS_RESPONSE)

    const result = await getPlaceDetails('places/ChIJabc123')
    const review = result!.reviews[0]

    expect(review.authorName).toBe('Jane Smith')
    expect(review.rating).toBe(5)
    expect(review.text).toBe('Great service, very helpful staff!')
    expect(review.relativeTimeDescription).toBe('2 months ago')
    expect(review.time).toBe(Math.floor(new Date('2026-03-10T08:00:00Z').getTime() / 1000))
  })

  it('returns empty reviews array when place has no reviews', async () => {
    const noReviewsResponse = { ...MOCK_DETAILS_RESPONSE, reviews: undefined }
    mockFetchOnce(noReviewsResponse)

    const result = await getPlaceDetails('places/ChIJabc123')

    expect(result!.reviews).toEqual([])
  })

  it('auto-prefixes bare place ID with "places/"', async () => {
    mockFetchOnce(MOCK_DETAILS_RESPONSE)

    await getPlaceDetails('ChIJabc123')

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc123')
  })

  it('does not double-prefix resource name that already starts with "places/"', async () => {
    mockFetchOnce(MOCK_DETAILS_RESPONSE)

    await getPlaceDetails('places/ChIJabc123')

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc123')
  })

  it('returns null when response has no id or name', async () => {
    mockFetchOnce({})

    const result = await getPlaceDetails('places/ChIJempty')

    expect(result).toBeNull()
  })

  it('throws Places API error when HTTP status is not 2xx', async () => {
    mockFetchOnce({ error: { message: 'Not found' } }, 404)

    await expect(getPlaceDetails('places/ChIJbad')).rejects.toThrow(
      'Places API error: place details returned HTTP 404'
    )
  })
})

// ─── 3. getBusinessReviews ────────────────────────────────────────────────────

describe('getBusinessReviews', () => {
  it('returns success=true with full PlaceDetails on happy path', async () => {
    mockFetchSequence(
      { body: MOCK_SEARCH_RESPONSE },
      { body: MOCK_DETAILS_RESPONSE }
    )

    const response = await getBusinessReviews('Oztop Building Supplies Slacks Creek QLD')

    expect(response.success).toBe(true)
    expect(response.place).not.toBeNull()
    expect(response.place!.name).toBe('Oztop Building Supplies')
    expect(response.place!.reviews.length).toBeGreaterThan(0)
    expect(response.error).toBeUndefined()
  })

  it('returns { success: false, place: null } when place is not found', async () => {
    mockFetchOnce({ places: [] })

    const response = await getBusinessReviews('Completely Unknown Business XYZ 999')

    expect(response.success).toBe(false)
    expect(response.place).toBeNull()
    expect(response.error).toBe('No place found for query')
  })

  it('returns { success: false, place: null } when details fetch returns null', async () => {
    mockFetchSequence(
      { body: MOCK_SEARCH_RESPONSE },
      { body: {} } // details returns empty — maps to null
    )

    const response = await getBusinessReviews('Oztop Building Supplies')

    expect(response.success).toBe(false)
    expect(response.place).toBeNull()
    expect(response.error).toBe('Place found but details unavailable')
  })

  it('returns { success: false } and captures error message on fetch throw', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network failure'))

    const response = await getBusinessReviews('Any Query')

    expect(response.success).toBe(false)
    expect(response.place).toBeNull()
    expect(response.error).toBe('Network failure')
  })

  it('returns { success: false } and captures Places API error message', async () => {
    mockFetchOnce({ error: 'API key missing' }, 401)

    const response = await getBusinessReviews('Any Query')

    expect(response.success).toBe(false)
    expect(response.error).toContain('Places API error')
    expect(response.error).toContain('401')
  })
})

// ─── 4. getPlacesApiKey (env var guard) ──────────────────────────────────────

describe('getPlacesApiKey (via findPlace)', () => {
  it('throws an error when GOOGLE_PLACES_API_KEY is not set', async () => {
    vi.unstubAllEnvs()
    delete process.env.GOOGLE_PLACES_API_KEY

    await expect(findPlace('Any Query')).rejects.toThrow(
      'Places API error: GOOGLE_PLACES_API_KEY environment variable is not set'
    )
  })

  it('uses the key from the environment variable in the request header', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'my-secret-key-456')
    mockFetchOnce(MOCK_SEARCH_RESPONSE)

    await findPlace('Test')

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const headers = options.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('my-secret-key-456')
  })
})
