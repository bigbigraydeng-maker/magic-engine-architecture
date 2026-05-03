import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { INDUSTRIES } from "@/types/hibiz";
import { getOptionalUserEmail } from "@/lib/supabase/optional-session";

export default async function HomePage() {
  const email = await getOptionalUserEmail();

  return (
    <>
      <SiteHeader email={email} />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-16">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">Australia &amp; New Zealand</p>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-stone-900 sm:text-5xl">
          Landing pages &amp; lead forms in one sentence.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-stone-600">
          HiBiz is an AI microsite engine for local businesses in Australia and New Zealand: describe what you need,
          confirm the details, and get a mobile-ready page with an embedded form and a standalone form link. After you
          sign in, you can also start from a one-click draft and add optional{" "}
          <span className="font-medium text-stone-700">Builder.io</span> sections for editable blocks—without hosting your
          whole site elsewhere.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href={email ? "/app/projects/new" : "/login?next=/app/projects/new"}
            className="rounded-full bg-emerald-800 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"
          >
            Generate my microsite
          </Link>
          <Link href="/login" className="rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-800 hover:border-stone-400">
            Sign in to save projects
          </Link>
        </div>

        <section className="mt-20">
          <h2 className="font-display text-2xl font-semibold text-stone-900">Who it&apos;s for first</h2>
          <p className="mt-2 max-w-2xl text-sm text-stone-600">
            We ship vertical templates for two sectors (no restaurant). Real estate is our active launch focus; the
            education / migration preset remains available but is not our primary outreach vertical right now.
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {INDUSTRIES.map((ind) => (
              <div
                key={ind.id}
                className={`rounded-2xl border bg-white p-6 shadow-sm ${
                  ind.focus === "primary"
                    ? "border-emerald-300 ring-1 ring-emerald-100"
                    : "border-stone-200 opacity-95"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {ind.focus === "primary" ? "Current focus" : "Templates · limited promotion"}
                </p>
                <h3 className="mt-2 font-display text-lg font-semibold text-emerald-900">{ind.label}</h3>
                <p className="mt-2 text-sm text-stone-600">{ind.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold text-stone-900">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              "Describe your page in plain English",
              "Confirm industry, page type, and city or region",
              "Publish links and collect leads",
            ].map(
              (step, i) => (
                <li key={step} className="flex gap-4 rounded-xl border border-stone-100 bg-white p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-900">
                    {i + 1}
                  </span>
                  <span className="text-sm text-stone-700">{step}</span>
                </li>
              ),
            )}
          </ol>
        </section>

        <p className="mt-16 text-xs text-stone-500">
          <Link href="/progress" className="text-emerald-800 underline decoration-emerald-800/30 underline-offset-2 hover:decoration-emerald-800">
            Development progress
          </Link>
          <span className="mx-2 text-stone-300">·</span>
          HiBiz is a Magic Lab product. MVP features are free during the launch period. You are responsible for industry-specific
          disclaimers and privacy notices—we inject baseline Australia / New Zealand–oriented hints where configured.
        </p>
      </main>
    </>
  );
}
