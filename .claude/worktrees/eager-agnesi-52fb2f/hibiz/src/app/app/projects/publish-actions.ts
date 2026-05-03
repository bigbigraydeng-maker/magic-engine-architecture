"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isRenderModelV1 } from "@/types/render-model";

export async function publishProjectFromForm(formData: FormData): Promise<void> {
  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/projects/${projectId}`)}`);
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, status, user_id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !project) {
    redirect("/app/projects");
  }

  if (project.status !== "ready_draft" && project.status !== "published") {
    redirect(`/app/projects/${projectId}?notice=publish_bad_state`);
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, draft_model, slug")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms?.draft_model || !isRenderModelV1(ms.draft_model)) {
    redirect(`/app/projects/${projectId}?notice=publish_no_draft`);
  }

  const now = new Date().toISOString();

  const { error: uMs } = await supabase
    .from("microsites")
    .update({
      published_model: ms.draft_model,
      published_at: now,
      seo: ms.draft_model.seo,
      updated_at: now,
    })
    .eq("id", ms.id);

  if (uMs) {
    redirect(`/app/projects/${projectId}?notice=publish_error`);
  }

  const { error: uForm } = await supabase
    .from("forms")
    .update({ status: "active", updated_at: now })
    .eq("project_id", projectId);

  if (uForm) {
    redirect(`/app/projects/${projectId}?notice=publish_error`);
  }

  const { error: uProj } = await supabase.from("projects").update({ status: "published" }).eq("id", projectId).eq("user_id", user.id);

  if (uProj) {
    redirect(`/app/projects/${projectId}?notice=publish_error`);
  }

  const { data: formSlugRow } = await supabase.from("forms").select("public_slug").eq("project_id", projectId).limit(1).maybeSingle();

  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath(`/site/${ms.slug}`);
  revalidatePath("/app/projects");
  if (formSlugRow?.public_slug) {
    revalidatePath(`/forms/${formSlugRow.public_slug}`);
  }

  redirect(`/app/projects/${projectId}?notice=published`);
}
