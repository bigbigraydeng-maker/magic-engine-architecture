"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildFormFromTemplate } from "@/lib/generation/form-presets";
import { makeFormPublicSlug, makeMicrositeSlug } from "@/lib/generation/slugs";
import { createBuilderBootstrapRenderModel } from "@/lib/generation/builder-bootstrap";
import { parseMerchantProfile, type MerchantProfileV1 } from "@/types/merchant-profile";

export async function createWebsiteBuilderDraftFromForm(formData: FormData): Promise<void> {
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
    .select("id, user_id, name")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr || !project) {
    redirect("/app/projects");
  }

  const { data: existingMs } = await supabase
    .from("microsites")
    .select("id, slug, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  let siteSlug = existingMs?.slug ?? makeMicrositeSlug(project.name);
  if (!existingMs) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: clash } = await supabase.from("microsites").select("id").eq("slug", siteSlug).maybeSingle();
      if (!clash) {
        break;
      }
      siteSlug = makeMicrositeSlug(project.name);
    }
  }

  const { data: existingForm } = await supabase
    .from("forms")
    .select("id, public_slug")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  let formId: string;
  let publicSlug: string;

  if (existingForm?.id) {
    formId = existingForm.id;
    publicSlug =
      typeof existingForm.public_slug === "string" && existingForm.public_slug.length > 0
        ? existingForm.public_slug
        : makeFormPublicSlug(project.name);
    const { error: fu } = await supabase
      .from("forms")
      .update({
        fields: buildFormFromTemplate("open_home_registration"),
        public_slug: publicSlug,
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", formId);
    if (fu) {
      redirect(`/app/projects/${projectId}?notice=builder_bootstrap_error`);
    }
  } else {
    publicSlug = makeFormPublicSlug(project.name);
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: clash } = await supabase.from("forms").select("id").eq("public_slug", publicSlug).maybeSingle();
      if (!clash) {
        break;
      }
      publicSlug = makeFormPublicSlug(project.name);
    }
    const { data: insForm, error: fi } = await supabase
      .from("forms")
      .insert({
        project_id: projectId,
        public_slug: publicSlug,
        fields: buildFormFromTemplate("open_home_registration"),
        status: "draft",
      })
      .select("id")
      .single();
    if (fi || !insForm) {
      redirect(`/app/projects/${projectId}?notice=builder_bootstrap_error`);
    }
    formId = insForm.id;
  }

  const renderModel = createBuilderBootstrapRenderModel({
    projectName: project.name,
    formId,
    publicSlug,
  });

  const existingProfile = parseMerchantProfile(existingMs?.merchant_profile);
  const nextProfile: MerchantProfileV1 = {
    ...(existingProfile ?? { schema_version: 1 }),
    schema_version: 1,
    builder_section_enabled: true,
    builder_section_position: existingProfile?.builder_section_position ?? "before",
  };

  if (existingMs?.id) {
    const { error: mu } = await supabase
      .from("microsites")
      .update({
        slug: siteSlug,
        draft_model: renderModel,
        seo: renderModel.seo,
        merchant_profile: nextProfile as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingMs.id);
    if (mu) {
      redirect(`/app/projects/${projectId}?notice=builder_bootstrap_error`);
    }
  } else {
    const { error: mi } = await supabase.from("microsites").insert({
      project_id: projectId,
      slug: siteSlug,
      draft_model: renderModel,
      seo: renderModel.seo,
      merchant_profile: nextProfile as unknown as Record<string, unknown>,
    });
    if (mi) {
      redirect(`/app/projects/${projectId}?notice=builder_bootstrap_error`);
    }
  }

  await supabase
    .from("projects")
    .update({ status: "ready_draft" })
    .eq("id", projectId)
    .eq("user_id", user.id);

  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath("/app/projects");
  revalidatePath(`/site/${siteSlug}`);

  redirect(`/app/projects/${projectId}?notice=builder_bootstrap_ready`);
}
