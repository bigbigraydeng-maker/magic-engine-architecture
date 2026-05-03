import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/** Passed to RSC so `/app` layout can redirect to `/login?next=…` with the full deep link. */
export const HIBIZ_LOGIN_NEXT_HEADER = "x-hibiz-login-next";

function nextWithForwardedPath(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const path = request.nextUrl.pathname + request.nextUrl.search;
  headers.set(HIBIZ_LOGIN_NEXT_HEADER, path);
  return NextResponse.next({
    request: { headers },
  });
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = nextWithForwardedPath(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = nextWithForwardedPath(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}
