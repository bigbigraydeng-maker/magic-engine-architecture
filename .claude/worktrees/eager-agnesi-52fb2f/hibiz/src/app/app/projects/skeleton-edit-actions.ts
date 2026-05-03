"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { assembleRenderModelFromSkeleton } from "@/lib/generation/assemble-skeleton";
import { getSkeletonById } from "@/data/skeletons";
import { skeletonModuleVisibilityKey } from "@/lib/generation/skeleton-module-key";
import { validateImageUpload } from "@/lib/upload/validate-image";
import { parseMerchantProfile, type MerchantProfileV1 } from "@/types/merchant-profile";
import { isRenderModelV1, type RenderModelV1 } from "@/types/render-model";
import { parseCompiledIntentV2 } from "@/types/compiled-intent-v2";

function clamp(s: string, max: number): string {
  return s.trim().slice(0, max);
}

async function reapplySkeletonDraft(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
): Promise<void> {
  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, merchant_profile, draft_model")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms) {
    return;
  }

  const profile = parseMerchantProfile(ms.merchant_profile);
  if (!profile?.skeleton_id) {
    return;
  }

  const skeleton = getSkeletonById(profile.skeleton_id);
  if (!skeleton) {
    return;
  }

  const { data: proj } = await supabase
    .from("projects")
    .select("name, compiled_intent_v2")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!proj) {
    return;
  }

  const { data: formRow } = await supabase.from("forms").select("id, public_slug").eq("project_id", projectId).limit(1).maybeSingle();
  if (!formRow?.id || !formRow.public_slug) {
    return;
  }

  // 查詢最新的 CompiledIntentV2（如果存在）
  const parsed = proj.compiled_intent_v2
    ? parseCompiledIntentV2(proj.compiled_intent_v2)
    : null;
  const compiledIntent = parsed ?? undefined;

  const nextModel = assembleRenderModelFromSkeleton({
    skeleton,
    profile,
    compiledIntent,
    formId: formRow.id,
    publicSlug: formRow.public_slug,
    projectName: proj.name,
  });

  const prev = ms.draft_model && isRenderModelV1(ms.draft_model) ? ms.draft_model : null;
  const finalModel: RenderModelV1 = prev
    ? {
        ...nextModel,
        seo: { ...nextModel.seo, title: prev.seo.title, description: prev.seo.description },
        modules: nextModel.modules.map((m) => {
          if (m.type !== "hero") return m;
          const heroPrev = prev.modules.find((p) => p.type === "hero");
          if (!heroPrev || heroPrev.type !== "hero") return m;
          return {
            ...m,
            content: {
              ...m.content,
              title: heroPrev.content.title,
              subtitle: heroPrev.content.subtitle,
              eyebrow: heroPrev.content.eyebrow,
              subtitle_secondary: heroPrev.content.subtitle_secondary,
              primary_cta_label: heroPrev.content.primary_cta_label,
              secondary_cta_label: heroPrev.content.secondary_cta_label,
            },
          };
        }),
      }
    : nextModel;

  await supabase
    .from("microsites")
    .update({
      draft_model: finalModel as unknown as Record<string, unknown>,
      seo: finalModel.seo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);
}

export async function updateSkeletonDraftField(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const moduleId = String(formData.get("module_id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  if (!projectId || !moduleId || (field !== "title" && field !== "subtitle")) {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  // Verify user owns the project before touching the microsite
  const { data: ownerCheck } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerCheck) {
    return;
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, draft_model")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms?.draft_model || !isRenderModelV1(ms.draft_model)) {
    return;
  }

  const model = ms.draft_model as RenderModelV1;
  const nextModules = model.modules.map((mod) => {
    if (mod.id !== moduleId || mod.type !== "hero") {
      return mod;
    }
    const v = field === "title" ? clamp(value, 200) : clamp(value, 600);
    return {
      ...mod,
      content: {
        ...mod.content,
        ...(field === "title" ? { title: v || mod.content.title } : { subtitle: v }),
      },
    };
  });

  const next: RenderModelV1 = {
    ...model,
    modules: nextModules,
    seo: field === "title" ? { ...model.seo, title: clamp(value, 70) || model.seo.title } : model.seo,
  };

  await supabase
    .from("microsites")
    .update({
      draft_model: next as unknown as Record<string, unknown>,
      seo: next.seo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?preview=1`);
}

function mergeProfileVisibility(
  existing: MerchantProfileV1 | null,
  skeletonId: string,
  moduleIndex: number,
  visible: boolean,
): MerchantProfileV1 {
  const key = skeletonModuleVisibilityKey(skeletonId, moduleIndex);
  const prev = existing ?? { schema_version: 1 as const };
  const nextVis = { ...(prev.module_visibility ?? {}), [key]: visible };
  return {
    ...prev,
    schema_version: 1,
    skeleton_id: prev.skeleton_id ?? skeletonId,
    module_visibility: nextVis,
  };
}

export async function updateSkeletonHeroImage(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/projects/${projectId}?preview=1`)}`);
  }

  const entry = formData.get("hero_image");
  if (!entry || typeof entry !== "object" || !("arrayBuffer" in entry)) {
    redirect(`/app/projects/${projectId}?preview=1`);
  }
  const file = entry as File;
  const validated = await validateImageUpload(file);
  if (!validated) {
    redirect(`/app/projects/${projectId}?preview=1`);
  }

  // Verify user owns the project
  const { data: ownerCheck } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerCheck) {
    redirect(`/app/projects/${projectId}?preview=1`);
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms) {
    redirect(`/app/projects/${projectId}?preview=1`);
  }

  const path = `merchant/${user.id}/${projectId}/hero-${Date.now()}.${validated.ext}`;
  const { error: upErr } = await supabase.storage.from("listing-images").upload(path, validated.buffer, {
    contentType: validated.mime,
    upsert: false,
  });
  if (upErr) {
    redirect(`/app/projects/${projectId}?preview=1`);
  }

  const publicUrl = supabase.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
  const existing = parseMerchantProfile(ms.merchant_profile);
  const nextProfile: MerchantProfileV1 = {
    ...(existing ?? { schema_version: 1 }),
    schema_version: 1,
    avatar_url: publicUrl,
  };

  await supabase
    .from("microsites")
    .update({
      merchant_profile: nextProfile as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?preview=1`);
}

export async function updateSkeletonModuleToggle(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const skeletonId = String(formData.get("skeleton_id") ?? "");
  const moduleIndex = Number(formData.get("module_index") ?? "");
  const visibleRaw = formData.get("visible");
  const visible = visibleRaw === "true" || visibleRaw === "on";

  if (!projectId || !skeletonId || !Number.isFinite(moduleIndex) || moduleIndex < 0) {
    return;
  }

  const skeleton = getSkeletonById(skeletonId);
  const mod = skeleton?.modules[moduleIndex];
  if (!mod || mod.type === "hero" || mod.type === "footer") {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  // Verify user owns the project
  const { data: ownerCheck } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerCheck) {
    return;
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms) {
    return;
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  const nextProfile = mergeProfileVisibility(existing, skeletonId, moduleIndex, visible);

  await supabase
    .from("microsites")
    .update({
      merchant_profile: nextProfile as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  await reapplySkeletonDraft(supabase, projectId, user.id);

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?preview=1`);
}

export async function updateSkeletonPalette(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const paletteId = clamp(String(formData.get("palette_id") ?? ""), 80);
  if (!projectId || !paletteId) {
    return;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  // Verify user owns the project
  const { data: ownerCheck } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerCheck) {
    return;
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("id, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (mErr || !ms) {
    return;
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  if (!existing?.skeleton_id) {
    return;
  }

  const nextProfile: MerchantProfileV1 = {
    ...(existing ?? { schema_version: 1 }),
    schema_version: 1,
    theme_overrides: {
      ...(existing?.theme_overrides ?? {}),
      palette_id: paletteId,
    },
  };

  await supabase
    .from("microsites")
    .update({
      merchant_profile: nextProfile as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  await reapplySkeletonDraft(supabase, projectId, user.id);

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?preview=1`);
}
