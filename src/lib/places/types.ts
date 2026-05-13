export interface PlaceSearchResult {
  placeId: string
  name: string
  address: string
  rating: number | null
  userRatingCount: number
  businessStatus: string // 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | etc.
}

export interface PlaceReview {
  authorName: string
  rating: number
  text: string
  relativeTimeDescription: string // e.g. "2 months ago"
  time: number // Unix timestamp
}

export interface PlaceDetails extends PlaceSearchResult {
  phoneNumber?: string
  website?: string
  reviews: PlaceReview[]
}

export interface PlacesSearchResponse {
  success: boolean
  place: PlaceDetails | null
  error?: string
}
