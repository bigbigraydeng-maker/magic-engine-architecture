"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { compileRuleBased, getCompilerVersion } from "@/lib/compiler/rule-based";

/** Use this from `<form action={...}>` — avoids `.bind()` on server actions (can break webpack chunks on Windows). */
export async function compileIntentFromForm(formData: FormData): Promise<void> {
  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    return;
  }
  await compileLatestIntent(projectId);
}

export async function compileLatestIntent(projectId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  const { data: intent, error: intentError } = await supabase
    .from("project_intents")
    .select("id, raw_prompt, industry_hint, compile_status, revision")
    .eq("project_id", projectId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (intentError || !intent) {
    return;
  }

  if (intent.compile_status !== "pending" && intent.compile_status !== "failed") {
    return;
  }

  const result = compileRuleBased(intent.raw_prompt, intent.industry_hint);

  if (result.kind === "ok") {
    const { error: upIntent } = await supabase
      .from("project_intents")
      .update({
        compiled: result.compiled,
        compile_status: "succeeded",
        compiler_version: getCompilerVersion(),
        compile_error: null,
        clarification: null,
      })
      .eq("id", intent.id);

    if (upIntent) {
      console.error(upIntent.message);
      return;
    }

    const { error: upProject } = await supabase
      .from("projects")
      .update({ status: "intent_ready" })
      .eq("id", projectId)
      .eq("user_id", user.id);

    if (upProject) {
      console.error(upProject.message);
    }
  } else {
    const { error: upIntent } = await supabase
      .from("project_intents")
      .update({
        clarification: result.clarification,
        compile_status: "needs_clarification",
        compiler_version: getCompilerVersion(),
        compile_error: null,
      })
      .eq("id", intent.id);

    if (upIntent) {
      console.error(upIntent.message);
    }
  }

  revalidatePath(`/app/projects/${projectId}`);
}
