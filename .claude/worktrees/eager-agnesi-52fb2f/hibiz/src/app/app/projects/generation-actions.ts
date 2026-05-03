"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isCompiledIntentV1 } from "@/lib/compiler/guards";
import { assembleRenderModel } from "@/lib/generation/assemble";
import { buildFormPreset } from "@/lib/generation/form-presets";
import { generateCopyWithOpenAI } from "@/lib/generation/openai-copy";
import { makeFormPublicSlug, makeMicrositeSlug } from "@/lib/generation/slugs";

export async function runGenerationFromForm(formData: FormData): Promise<void> {
  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/app/projects/${projectId}`);
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    redirect(`/app/projects/${projectId}?notice=missing_openai`);
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name, status, user_id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !project) {
    redirect(`/app/projects/${projectId}?notice=gen_error`);
  }

  /* End any stuck "running" row so a new attempt can proceed (e.g. tab closed mid-request). */
  await supabase
    .from("generation_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      failure_code: "SUPERSEDED",
      failure_detail: { message: "Replaced or retried by a new generation" },
    })
    .eq("project_id", projectId)
    .eq("status", "running");

  const allowedStatus = ["intent_ready", "generation_failed", "ready_draft", "generating"];
  if (!allowedStatus.includes(project.status)) {
    redirect(`/app/projects/${projectId}?notice=bad_state`);
  }

  const { data: intent, error: iErr } = await supabase
    .from("project_intents")
    .select("id, compiled, raw_prompt, compile_status")
    .eq("project_id", projectId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (iErr || !intent || intent.compile_status !== "succeeded" || !isCompiledIntentV1(intent.compiled)) {
    redirect(`/app/projects/${projectId}?notice=no_intent`);
  }

  const compiled = intent.compiled;
  const started = Date.now();

  const { data: runRow, error: runInsErr } = await supabase
    .from("generation_runs")
    .insert({
      project_id: projectId,
      intent_id: intent.id,
      status: "running",
      started_at: new Date().toISOString(),
      pipeline_meta: { source: "next_server_action", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" },
    })
    .select("id")
    .single();

  if (runInsErr || !runRow) {
    redirect(`/app/projects/${projectId}?notice=gen_error`);
  }

  await supabase
    .from("projects")
    .update({ status: "generating", current_generation_id: runRow.id })
    .eq("id", projectId)
    .eq("user_id", user.id);

  try {
    const copy = await generateCopyWithOpenAI({
      rawPrompt: intent.raw_prompt,
      compiled,
      projectName: project.name,
    });

    const preset = buildFormPreset(compiled);

    const { data: existingMs } = await supabase
      .from("microsites")
      .select("id, slug")
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

    const { data: existingForm } = await supabase.from("forms").select("id, public_slug").eq("project_id", projectId).limit(1).maybeSingle();

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
          fields: preset,
          public_slug: publicSlug,
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", formId);
      if (fu) {
        throw new Error(fu.message);
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
          fields: preset,
          status: "draft",
        })
        .select("id")
        .single();
      if (fi || !insForm) {
        throw new Error(fi?.message ?? "form insert failed");
      }
      formId = insForm.id;
    }

    const renderModel = assembleRenderModel({
      compiled,
      copy,
      formId,
      publicSlug,
      projectName: project.name,
      businessBrand: project.name,
    });

    if (existingMs?.id) {
      const { error: mu } = await supabase
        .from("microsites")
        .update({
          draft_model: renderModel,
          seo: renderModel.seo,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingMs.id);
      if (mu) {
        throw new Error(mu.message);
      }
    } else {
      const { error: mi } = await supabase.from("microsites").insert({
        project_id: projectId,
        slug: siteSlug,
        draft_model: renderModel,
        seo: renderModel.seo,
      });
      if (mi) {
        throw new Error(mi.message);
      }
    }

    const duration_ms = Date.now() - started;
    await supabase
      .from("generation_runs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        pipeline_meta: {
          source: "next_server_action",
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          duration_ms,
          template_id: renderModel.template_id,
        },
        failure_code: null,
        failure_detail: null,
      })
      .eq("id", runRow.id);

    await supabase.from("projects").update({ status: "ready_draft" }).eq("id", projectId).eq("user_id", user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    await supabase
      .from("generation_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        failure_code: "GENERATION_ERROR",
        failure_detail: { message },
      })
      .eq("id", runRow.id);

    await supabase.from("projects").update({ status: "generation_failed" }).eq("id", projectId).eq("user_id", user.id);

    revalidatePath(`/app/projects/${projectId}`);
    redirect(`/app/projects/${projectId}?notice=gen_error`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?notice=generated`);
}
