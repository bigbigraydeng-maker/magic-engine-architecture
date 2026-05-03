import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectsPage() {
  const supabase = createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, status, updated_at")
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <p className="font-medium">Could not load projects</p>
        <p className="mt-1 text-sm">{error.message}</p>
        <p className="mt-3 text-sm">
          Ensure Supabase env vars are set and the migration has been applied to your project.
        </p>
      </div>
    );
  }

  const list = projects ?? [];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-semibold text-stone-900">Projects</h1>
        <Link
          href="/app/projects/new"
          className="inline-flex justify-center rounded-full bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          New project
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <p className="font-display text-lg text-stone-800">No projects yet</p>
          <p className="mt-2 text-sm text-stone-600">
            Create a landing page and lead form from one sentence about your business.
          </p>
          <Link
            href="/app/projects/new"
            className="mt-6 inline-block rounded-full bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            Create a project
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {list.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/projects/${p.id}`}
                className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-4 shadow-sm transition hover:border-emerald-200"
              >
                <div>
                  <p className="font-medium text-stone-900">{p.name}</p>
                  <p className="mt-0.5 text-xs uppercase tracking-wide text-stone-500">{p.status}</p>
                </div>
                <span className="text-stone-400">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
