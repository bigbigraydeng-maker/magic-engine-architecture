import { headers } from "next/headers";
import { safeLoginNextPath } from "@/lib/auth/safe-login-next";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Resolve the external origin (what the user sees), not the internal
 * reverse-proxy address (e.g. localhost:10000 on Render).
 */
function externalOrigin(req: Request): string {
  const h = headers();
  const forwardedHost = h.get("x-forwarded-host");
  const forwardedProto = h.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = h.get("host");
  if (host) {
    return `${forwardedProto}://${host}`;
  }

  // Last resort: use request.url (may be internal on Render)
  const parsed = new URL(req.url);
  return parsed.origin;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeLoginNextPath(searchParams.get("next"));
  const origin = externalOrigin(request);

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
