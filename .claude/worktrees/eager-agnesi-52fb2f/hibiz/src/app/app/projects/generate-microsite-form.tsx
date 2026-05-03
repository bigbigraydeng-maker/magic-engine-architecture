"use client";

import { useFormStatus } from "react-dom";
import { runGenerationFromForm } from "./generation-actions";

function SubmitButton({ isRegenerate }: { isRegenerate: boolean }) {
  const { pending } = useFormStatus();
  const defaultLabel = isRegenerate ? "Regenerate microsite (OpenAI)" : "Generate microsite (OpenAI)";
  return (
    <div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-stone-900 px-5 py-3 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? "Generating… (30–90s, keep this tab open)" : defaultLabel}
      </button>
      {pending ? (
        <p className="mt-3 text-xs font-medium text-amber-800">
          Calling OpenAI from your computer (Next.js server). First run can take longer.
        </p>
      ) : null}
    </div>
  );
}

export function GenerateMicrositeForm({ projectId, isRegenerate }: { projectId: string; isRegenerate: boolean }) {
  return (
    <form action={runGenerationFromForm}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton isRegenerate={isRegenerate} />
      <p className="mt-2 max-w-xl text-xs text-stone-500">
        Uses <code className="rounded bg-stone-100 px-1">OPENAI_API_KEY</code> from <code className="rounded bg-stone-100 px-1">.env.local</code>{" "}
        (restart <code className="rounded bg-stone-100 px-1">npm run dev</code> after editing). Optional:{" "}
        <code className="rounded bg-stone-100 px-1">OPENAI_MODEL</code>.
      </p>
    </form>
  );
}
