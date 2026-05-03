import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeLoginNextPath } from "@/lib/auth/safe-login-next";
import { createClient } from "@/lib/supabase/server";
import { HIBIZ_LOGIN_NEXT_HEADER } from "@/lib/supabase/middleware";
import { AppSignOutButton } from "./app-sign-out-button";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = safeLoginNextPath(headers().get(HIBIZ_LOGIN_NEXT_HEADER));
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/app/projects" className="font-display text-lg font-semibold text-emerald-900">
            HiBiz
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/app/projects" className="text-stone-600 hover:text-emerald-900">
              Projects
            </Link>
            <Link href="/app/poster-from-trademe" className="text-stone-600 hover:text-emerald-900">
              TradeMe 海报
            </Link>
            <Link href="/app/projects/new" className="font-medium text-emerald-800 hover:text-emerald-950">
              New
            </Link>
            <form action={signOutAction}>
              <AppSignOutButton />
            </form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
