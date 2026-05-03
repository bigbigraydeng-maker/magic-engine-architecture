import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

/**
 * Log a page view for published microsites (anon Supabase client — RLS allows insert when microsite is live).
 */
export async function recordPublishedSiteVisit(request: NextRequest): Promise<void> {
  const pathname = request.nextUrl.pathname;
  const match = pathname.match(/^\/site\/([^/]+)/);
  if (!match) {
    return;
  }
  const slug = decodeURIComponent(match[1]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return;
  }

  const supabase = createClient(url, key);
  const { data: row, error: selErr } = await supabase.from("microsites").select("id").eq("slug", slug).maybeSingle();
  if (selErr || !row?.id) {
    return;
  }

  const path = pathname + (request.nextUrl.search || "");
  const sp = request.nextUrl.searchParams;

  await supabase.from("site_visits").insert({
    microsite_id: row.id,
    path: path.slice(0, 2000),
    referrer: request.headers.get("referer")?.slice(0, 2000) ?? null,
    utm_source: sp.get("utm_source")?.slice(0, 500) ?? null,
    utm_medium: sp.get("utm_medium")?.slice(0, 500) ?? null,
    utm_campaign: sp.get("utm_campaign")?.slice(0, 500) ?? null,
    user_agent: request.headers.get("user-agent")?.slice(0, 2000) ?? null,
  });
}
