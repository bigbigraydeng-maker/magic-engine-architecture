/** Aggregated microsite analytics for the project dashboard. */

export interface SiteVisitRow {
  id: string;
  microsite_id: string;
  path: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  user_agent: string | null;
  visited_at: string;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface ReferrerCount {
  referrer: string;
  count: number;
}

export interface UtmBucket {
  source: string;
  medium: string;
  campaign: string | null;
  count: number;
}

export interface AnalyticsSummary {
  days: number;
  totalVisits: number;
  totalSubmissions: number;
  /** 0–100, submissions / visits when visits > 0 */
  conversionRatePct: number;
  visitsByDay: DayCount[];
  submissionsByDay: DayCount[];
  topReferrers: ReferrerCount[];
  utmBuckets: UtmBucket[];
}

export interface RecentSubmissionRow {
  id: string;
  created_at: string;
  payload: unknown;
}
