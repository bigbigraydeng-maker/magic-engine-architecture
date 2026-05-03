"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getSkeletonById } from "@/data/skeletons";
import { assembleRenderModelFromSkeleton } from "@/lib/generation/assemble-skeleton";
import { compiledIntentFromSkeleton } from "@/lib/generation/skeleton-compiled";
import { buildFormFromTemplate, normalizeFormTemplateId, type FormTemplateId } from "@/lib/generation/form-presets";
import { generateCopyWithOpenAI } from "@/lib/generation/openai-copy";
import { makeFormPublicSlug, makeMicrositeSlug } from "@/lib/generation/slugs";
import { skeletonModuleVisibilityKey } from "@/lib/generation/skeleton-module-key";
import { validateImageUpload } from "@/lib/upload/validate-image";
import type { MerchantProfileV1, PropertyListing } from "@/types/merchant-profile";

function clamp(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadOptional(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  projectId: string,
  formData: FormData,
  field: string,
): Promise<string | null> {
  const entry = formData.get(field);
  if (!entry || typeof entry !== "object" || !("arrayBuffer" in entry)) {
    return null;
  }
  const file = entry as File;
  const validated = await validateImageUpload(file);
  if (!validated) {
    return null;
  }
  const path = `merchant/${userId}/${projectId}/${field}-${Date.now()}.${validated.ext}`;
  const { error } = await supabase.storage.from("listing-images").upload(path, validated.buffer, {
    contentType: validated.mime,
    upsert: false,
  });
  if (error) {
    return null;
  }
  return supabase.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
}

function parsePropertyListingsJson(raw: string): PropertyListing[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: PropertyListing[] = [];
  parsed.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    const address = String(o.address ?? "").trim();
    if (!name || !address) {
      return;
    }
    const images = Array.isArray(o.images)
      ? o.images.filter((x): x is string => typeof x === "string").slice(0, 24)
      : [];
    const idRaw = String(o.id ?? "").trim();
    out.push({
      id: idRaw || newId(),
      name: name.slice(0, 200),
      address: address.slice(0, 500),
      description: String(o.description ?? "").trim().slice(0, 8000),
      images,
      bedrooms: typeof o.bedrooms === "number" && Number.isFinite(o.bedrooms) ? Math.floor(o.bedrooms) : undefined,
      bathrooms: typeof o.bathrooms === "number" && Number.isFinite(o.bathrooms) ? Math.floor(o.bathrooms) : undefined,
      price_hint: String(o.price_hint ?? "").trim().slice(0, 80) || undefined,
      trademe_url: String(o.trademe_url ?? "").trim().slice(0, 500) || undefined,
      sort_order: typeof o.sort_order === "number" && Number.isFinite(o.sort_order) ? Math.floor(o.sort_order) : idx,
    });
  });
  return out;
}

function parseModuleVisibilityJson(
  skeletonId: string,
  raw: string,
): Record<string, boolean> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const o = parsed as Record<string, unknown>;
  const sk = getSkeletonById(skeletonId);
  if (!sk) {
    return undefined;
  }
  const out: Record<string, boolean> = {};
  sk.modules.forEach((mod, index) => {
    if (mod.type === "hero" || mod.type === "footer") {
      return;
    }
    const key = String(index);
    if (typeof o[key] === "boolean") {
      out[skeletonModuleVisibilityKey(skeletonId, index)] = o[key];
    }
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function createProjectFromSkeleton(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app/projects/new");
  }

  const projectName = clamp(String(formData.get("project_name") ?? ""), 200) || "Untitled";
  const skeletonId = clamp(String(formData.get("skeleton_id") ?? ""), 80);
  const displayName = clamp(String(formData.get("display_name") ?? ""), 120);
  const companyName = clamp(String(formData.get("company_name") ?? ""), 120);
  const phone = clamp(String(formData.get("phone") ?? ""), 40);
  const email = clamp(String(formData.get("email") ?? ""), 200);
  const whatsapp = clamp(String(formData.get("whatsapp") ?? ""), 40);
  const slogan = clamp(String(formData.get("slogan") ?? ""), 300);
  const serviceArea = clamp(String(formData.get("service_area") ?? ""), 200);
  const trademeUrl = clamp(String(formData.get("trademe_url") ?? ""), 500);
  const paletteId = clamp(String(formData.get("palette_id") ?? ""), 80);
  const listingsJson = String(formData.get("property_listings_json") ?? "[]");
  const visibilityJson = String(formData.get("module_visibility_json") ?? "");

  if (!skeletonId || !displayName || !phone) {
    redirect("/app/projects/new?step=info");
  }

  const skeleton = getSkeletonById(skeletonId);
  if (!skeleton) {
    redirect("/app/projects/new?step=skeleton&error=unknown_skeleton");
  }

  const formTemplateId: FormTemplateId = normalizeFormTemplateId(skeleton.defaultFormTemplate);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: projectName,
      status: "generating",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to create project");
  }

  const projectId = project.id;

  const compiled = compiledIntentFromSkeleton(skeleton, formTemplateId);
  const rawPrompt = `Skeleton: ${skeleton.nameEn} (${skeleton.id}). ${slogan || skeleton.description} Service area: ${serviceArea || "NZ"}.`;

  const { data: intent, error: intentError } = await supabase
    .from("project_intents")
    .insert({
      project_id: projectId,
      revision: 1,
      raw_prompt: rawPrompt,
      industry_hint: skeleton.industry === "real_estate" ? "real_estate" : "immigration_education",
      compile_status: "succeeded",
      compiled,
      compiler_version: "skeleton_v1",
    })
    .select("id")
    .single();

  if (intentError || !intent) {
    await supabase.from("projects").delete().eq("id", projectId);
    throw new Error(intentError?.message ?? "Failed to create intent");
  }

  await supabase.from("projects").update({ current_intent_id: intent.id }).eq("id", projectId);

  const avatarUrl = await uploadOptional(supabase, user.id, projectId, formData, "avatar");
  const logoUrl = await uploadOptional(supabase, user.id, projectId, formData, "logo");
  const wechatUrl = await uploadOptional(supabase, user.id, projectId, formData, "wechat_qr");

  let listings = parsePropertyListingsJson(listingsJson);
  if (trademeUrl && listings.length > 0 && !listings[0].trademe_url) {
    listings = listings.map((l, i) => (i === 0 ? { ...l, trademe_url: trademeUrl } : l));
  }

  const module_visibility = parseModuleVisibilityJson(skeletonId, visibilityJson);

  const profile: MerchantProfileV1 = {
    schema_version: 1,
    skeleton_id: skeletonId,
    display_name: displayName,
    ...(companyName ? { company_name: companyName } : {}),
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    ...(logoUrl ? { logo_url: logoUrl } : {}),
    ...(slogan ? { bio_zh: slogan } : {}),
    contact: {
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      ...(wechatUrl ? { wechat_qr_url: wechatUrl } : {}),
    },
    ...(paletteId ? { theme_overrides: { palette_id: paletteId } } : {}),
    ...(module_visibility ? { module_visibility } : {}),
    ...(listings.length > 0 ? { property_listings: listings } : {}),
  };

  const preset = buildFormFromTemplate(formTemplateId);

  let siteSlug = makeMicrositeSlug(projectName);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: clash } = await supabase.from("microsites").select("id").eq("slug", siteSlug).maybeSingle();
    if (!clash) {
      break;
    }
    siteSlug = makeMicrositeSlug(projectName);
  }

  let publicSlug = makeFormPublicSlug(projectName);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: clash } = await supabase.from("forms").select("id").eq("public_slug", publicSlug).maybeSingle();
    if (!clash) {
      break;
    }
    publicSlug = makeFormPublicSlug(projectName);
  }

  const { data: formIns, error: formErr } = await supabase
    .from("forms")
    .insert({
      project_id: projectId,
      public_slug: publicSlug,
      fields: preset,
      status: "draft",
    })
    .select("id")
    .single();

  if (formErr || !formIns) {
    throw new Error(formErr?.message ?? "form insert failed");
  }

  let copy = undefined;
  try {
    if (process.env.OPENAI_API_KEY?.trim()) {
      copy = await generateCopyWithOpenAI({
        rawPrompt,
        compiled,
        projectName,
      });
    }
  } catch {
    copy = undefined;
  }

  const renderModel = assembleRenderModelFromSkeleton({
    skeleton,
    profile,
    copy,
    formId: formIns.id,
    publicSlug,
    projectName,
  });

  const { error: msErr } = await supabase.from("microsites").insert({
    project_id: projectId,
    slug: siteSlug,
    draft_model: renderModel,
    seo: renderModel.seo,
    merchant_profile: profile,
  });

  if (msErr) {
    throw new Error(msErr.message);
  }

  await supabase.from("projects").update({ status: "ready_draft" }).eq("id", projectId).eq("user_id", user.id);

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);

  redirect(`/app/projects/${projectId}?preview=1`);
}
