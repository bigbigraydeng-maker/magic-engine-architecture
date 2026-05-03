"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { RenderModelV1 } from "@/types/render-model";
import { isRenderModelV1 } from "@/types/render-model";

function clamp(s: string, max: number): string {
  return s.trim().slice(0, max);
}

export async function updateHeroDraftFromForm(formData: FormData): Promise<void> {
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

  const eyebrow = clamp(String(formData.get("hero_eyebrow") ?? ""), 120);
  const title = clamp(String(formData.get("hero_title") ?? ""), 200);
  const subtitle = clamp(String(formData.get("hero_subtitle") ?? ""), 600);
  const subtitleSecondaryRaw = String(formData.get("hero_subtitle_secondary") ?? "").trim();
  const subtitleSecondary = subtitleSecondaryRaw.length > 0 ? clamp(subtitleSecondaryRaw, 400) : null;
  const primaryCta = clamp(String(formData.get("hero_primary_cta") ?? ""), 80);

  if (title.length === 0) {
    redirect(`/app/projects/${projectId}?notice=hero_title_required`);
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, draft_model")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms?.draft_model || !isRenderModelV1(ms.draft_model)) {
    redirect(`/app/projects/${projectId}?notice=hero_no_draft`);
  }

  let patched = false;
  const model = ms.draft_model as RenderModelV1;
  const modules = model.modules.map((mod) => {
    if (mod.type !== "hero") {
      return mod;
    }
    patched = true;
    return {
      ...mod,
      content: {
        ...mod.content,
        eyebrow: eyebrow.length > 0 ? eyebrow : null,
        title,
        subtitle,
        subtitle_secondary: subtitleSecondary,
        primary_cta_label: primaryCta.length > 0 ? primaryCta : mod.content.primary_cta_label,
      },
    };
  });

  if (!patched) {
    redirect(`/app/projects/${projectId}?notice=hero_no_module`);
  }

  const nextModel: RenderModelV1 = {
    ...model,
    modules,
    seo: {
      ...model.seo,
      title: title.slice(0, 70),
      description: model.seo.description,
    },
  };

  const { error: uErr } = await supabase
    .from("microsites")
    .update({
      draft_model: nextModel,
      seo: nextModel.seo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  if (uErr) {
    redirect(`/app/projects/${projectId}?notice=hero_save_error`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?notice=hero_saved`);
}
