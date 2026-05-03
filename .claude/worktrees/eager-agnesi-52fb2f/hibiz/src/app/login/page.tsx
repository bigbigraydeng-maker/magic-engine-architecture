import Link from "next/link";
import { redirect } from "next/navigation";
import { safeLoginNextPath } from "@/lib/auth/safe-login-next";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./ui-login-form";

interface LoginPageProps {
  searchParams: { error?: string; next?: string };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(safeLoginNextPath(params.next ?? null));
  }

  return (
    <>
      <SiteHeader email={null} />
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-display text-3xl font-semibold text-stone-900">Sign in</h1>
        <p className="mt-2 text-sm text-stone-600">We&apos;ll email you a magic link to save projects and submissions.</p>
        {params.error === "auth" ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Could not complete sign-in. Try again.</p>
        ) : null}
        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm nextPath={safeLoginNextPath(params.next ?? null)} />
        </div>
        <p className="mt-6 text-center text-sm text-stone-500">
          <Link href="/" className="text-emerald-800 hover:underline">
            Back to home
          </Link>
        </p>
      </main>
    </>
  );
}
