"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { compileLatestIntent } from "./intent-actions";

export async function createProjectWithIntent(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") || "Untitled").trim() || "Untitled";
  const rawPrompt = String(formData.get("prompt") || "").trim();
  const industryHintRaw = formData.get("industry_hint");
  const industryHint =
    industryHintRaw === "immigration_education" || industryHintRaw === "real_estate"
      ? industryHintRaw
      : null;

  if (!rawPrompt) {
    redirect("/app/projects/new?error=empty_prompt");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name,
      status: "intent_drafting",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to create project");
  }

  const { data: intent, error: intentError } = await supabase
    .from("project_intents")
    .insert({
      project_id: project.id,
      revision: 1,
      raw_prompt: rawPrompt,
      industry_hint: industryHint,
      compile_status: "pending",
    })
    .select("id")
    .single();

  if (intentError || !intent) {
    throw new Error(intentError?.message ?? "Failed to create intent");
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({ current_intent_id: intent.id })
    .eq("id", project.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await compileLatestIntent(project.id);

  redirect(`/app/projects/${project.id}`);
}
