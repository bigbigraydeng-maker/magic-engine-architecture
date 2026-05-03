import { type NextRequest } from "next/server";
import { recordPublishedSiteVisit } from "@/lib/analytics/record-site-visit";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  try {
    await recordPublishedSiteVisit(request);
  } catch {
    /* analytics must not break public pages */
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
