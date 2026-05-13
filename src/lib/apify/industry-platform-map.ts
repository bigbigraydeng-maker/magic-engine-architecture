export type Industry =
  | 'building_supplies'
  | 'tourism_travel'
  | 'restaurant_cafe'
  | 'professional_services'
  | 'automotive'
  | 'health_medical'
  | 'retail_general'
  | 'education'
  | 'real_estate'

export interface ReviewPlatform {
  name: string
  url: string // base URL for search
  apifyActor: string | null // Apify actor ID, null if manual/API
  priority: 'primary' | 'secondary'
}

export const INDUSTRY_PLATFORM_MAP: Record<Industry, ReviewPlatform[]> = {
  building_supplies: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'ProductReview.com.au', url: 'https://www.productreview.com.au', apifyActor: 'apify/web-scraper', priority: 'primary' },
    { name: 'Houzz', url: 'https://www.houzz.com.au', apifyActor: null, priority: 'secondary' },
    { name: 'Hipages', url: 'https://hipages.com.au', apifyActor: null, priority: 'secondary' },
  ],
  tourism_travel: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'TripAdvisor', url: 'https://www.tripadvisor.com.au', apifyActor: 'maxcopell/tripadvisor-scraper', priority: 'primary' },
    { name: 'Booking.com', url: 'https://www.booking.com', apifyActor: null, priority: 'secondary' },
  ],
  restaurant_cafe: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'TripAdvisor', url: 'https://www.tripadvisor.com.au', apifyActor: 'maxcopell/tripadvisor-scraper', priority: 'primary' },
    { name: 'Zomato', url: 'https://www.zomato.com/australia', apifyActor: null, priority: 'secondary' },
  ],
  professional_services: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'ProductReview.com.au', url: 'https://www.productreview.com.au', apifyActor: null, priority: 'primary' },
  ],
  automotive: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'carsales.com.au', url: 'https://www.carsales.com.au', apifyActor: null, priority: 'secondary' },
  ],
  health_medical: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'HealthEngine', url: 'https://healthengine.com.au', apifyActor: null, priority: 'primary' },
    { name: 'Whitecoat', url: 'https://www.whitecoat.com.au', apifyActor: null, priority: 'secondary' },
  ],
  retail_general: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'ProductReview.com.au', url: 'https://www.productreview.com.au', apifyActor: null, priority: 'primary' },
  ],
  education: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'ProductReview.com.au', url: 'https://www.productreview.com.au', apifyActor: null, priority: 'primary' },
  ],
  real_estate: [
    { name: 'Google Reviews', url: 'https://maps.google.com', apifyActor: null, priority: 'primary' },
    { name: 'RateMyAgent', url: 'https://ratemyagent.com.au', apifyActor: null, priority: 'primary' },
    { name: 'Domain.com.au', url: 'https://www.domain.com.au', apifyActor: null, priority: 'secondary' },
  ],
}

export function getReviewPlatforms(industry: Industry): ReviewPlatform[] {
  return INDUSTRY_PLATFORM_MAP[industry]
}

export function getPrimaryPlatforms(industry: Industry): ReviewPlatform[] {
  return INDUSTRY_PLATFORM_MAP[industry].filter(p => p.priority === 'primary')
}
