import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface LeadsPageProps {
  params: { id: string };
}

export const metadata = {
  title: "Submissions — HiBiz",
};

function formatPayload(payload: unknown): { key: string; value: string }[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const o = payload as Record<string, unknown>;
  return Object.entries(o).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

export default async function ProjectLeadsPage({ params }: LeadsPageProps) {
  const supabase = createClient();
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();

  if (pErr || !project) {
    notFound();
  }

  const { data: rows, error: sErr } = await supabase
    .from("submissions")
    .select("id, created_at, payload")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(300);

  if (sErr) {
    return (
      <div>
        <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 underline">
          ← {project.name}
        </Link>
        <p className="mt-8 text-sm text-red-700">Could not load submissions.</p>
      </div>
    );
  }

  const list = rows ?? [];

  return (
    <div>
      <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">Submissions</h1>
      <p className="mt-1 text-sm text-stone-500">
        {list.length} lead{list.length === 1 ? "" : "s"} (newest first)
      </p>

      {list.length === 0 ? (
        <p className="mt-10 rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
          No submissions yet. After you <strong>publish</strong>, links under the project will accept visitor leads here.
        </p>
      ) : (
        <ul className="mt-8 space-y-6">
          {list.map((row) => {
            const fields = formatPayload(row.payload);
            return (
              <li key={row.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString("en-NZ", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "—"}
                </p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {fields.map(({ key, value }) => (
                    <div key={key} className="min-w-0 sm:col-span-2">
                      <dt className="text-stone-500">{key}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-stone-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
