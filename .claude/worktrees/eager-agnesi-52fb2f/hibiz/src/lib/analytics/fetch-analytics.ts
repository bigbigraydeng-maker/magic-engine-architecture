import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyticsSummary,
  DayCount,
  RecentSubmissionRow,
  ReferrerCount,
  UtmBucket,
} from "@/types/analytics";

function startIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function dateKeyUtc(iso: string): string {
  return iso.slice(0, 10);
}

function buildDaySeries(days: number, counts: Map<string, number>): DayCount[] {
  const out: DayCount[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

function emptySummary(days: number): AnalyticsSummary {
  return {
    days,
    totalVisits: 0,
    totalSubmissions: 0,
    conversionRatePct: 0,
    visitsByDay: buildDaySeries(days, new Map()),
    submissionsByDay: buildDaySeries(days, new Map()),
    topReferrers: [],
    utmBuckets: [],
  };
}

export async function fetchAnalyticsSummary(
  supabase: SupabaseClient,
  projectId: string,
  days: number,
): Promise<AnalyticsSummary> {
  const since = startIso(days);

  const { data: ms } = await supabase.from("microsites").select("id").eq("project_id", projectId).maybeSingle();
  if (!ms?.id) {
    return emptySummary(days);
  }

  const { data: visits, error: vErr } = await supabase
    .from("site_visits")
    .select("visited_at, referrer, utm_source, utm_medium, utm_campaign")
    .eq("microsite_id", ms.id)
    .gte("visited_at", since);

  if (vErr) {
    return emptySummary(days);
  }

  const { data: submissions, error: sErr } = await supabase
    .from("submissions")
    .select("created_at")
    .eq("project_id", projectId)
    .gte("created_at", since);

  if (sErr) {
    return emptySummary(days);
  }

  const visitRows = visits ?? [];
  const subRows = submissions ?? [];

  const visitByDay = new Map<string, number>();
  for (const v of visitRows) {
    const k = dateKeyUtc(v.visited_at);
    visitByDay.set(k, (visitByDay.get(k) ?? 0) + 1);
  }

  const subByDay = new Map<string, number>();
  for (const s of subRows) {
    const k = dateKeyUtc(s.created_at);
    subByDay.set(k, (subByDay.get(k) ?? 0) + 1);
  }

  const refMap = new Map<string, number>();
  for (const v of visitRows) {
    const r = (v.referrer ?? "").trim() || "(direct / none)";
    refMap.set(r, (refMap.get(r) ?? 0) + 1);
  }
  const topReferrers: ReferrerCount[] = Array.from(refMap.entries())
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const utmMap = new Map<string, number>();
  for (const v of visitRows) {
    const src = (v.utm_source ?? "").trim() || "(not set)";
    const med = (v.utm_medium ?? "").trim() || "(not set)";
    const camp = (v.utm_campaign ?? "").trim() || null;
    const key = `${src}\t${med}\t${camp ?? ""}`;
    utmMap.set(key, (utmMap.get(key) ?? 0) + 1);
  }
  const utmBuckets: UtmBucket[] = Array.from(utmMap.entries())
    .map(([key, count]) => {
      const [source, medium, campaignRaw] = key.split("\t");
      return {
        source,
        medium,
        campaign: campaignRaw.length > 0 ? campaignRaw : null,
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalVisits = visitRows.length;
  const totalSubmissions = subRows.length;
  const conversionRatePct =
    totalVisits > 0 ? Math.round((totalSubmissions / totalVisits) * 1000) / 10 : 0;

  return {
    days,
    totalVisits,
    totalSubmissions,
    conversionRatePct,
    visitsByDay: buildDaySeries(days, visitByDay),
    submissionsByDay: buildDaySeries(days, subByDay),
    topReferrers,
    utmBuckets,
  };
}

export async function fetchRecentSubmissions(
  supabase: SupabaseClient,
  projectId: string,
  limit: number,
): Promise<RecentSubmissionRow[]> {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, created_at, payload")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }
  return data as RecentSubmissionRow[];
}
