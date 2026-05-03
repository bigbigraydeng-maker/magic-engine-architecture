"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { normalizePosterTemplateId } from "@/data/poster-templates";
import { buildMerchantProfileFromListing, patchHeroDraftFromListing } from "@/lib/extraction/auto-fill";
import { extractTradeMeListingMultiLayer } from "@/lib/extraction/extraction-layers";
import { sanitizePastedTradeMeUrl } from "@/lib/extraction/trademe-url-sanitize";
import { proxyImagesToStorage } from "@/lib/extraction/image-proxy";
import { generatePosterBlurbs } from "@/lib/extraction/poster-blurb";
import type { TradeMeExtractLayer } from "@/lib/extraction/extract-listing";
import type { TradeMeListingData } from "@/lib/extraction/trademe-schema";
import { rawPropertyPromoObject, rawTrademeImageUrls } from "@/lib/merchant-profile/raw-json";
import { parseMerchantProfile, type MerchantContactV1, type MerchantProfileV1, type PropertyPromoV1 } from "@/types/merchant-profile";
import { isRenderModelV1 } from "@/types/render-model";

function clamp(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function nonEmptyContact(c: MerchantContactV1): MerchantContactV1 | undefined {
  const out: MerchantContactV1 = {};
  const phone = clamp(String(c.phone ?? ""), 40);
  const email = clamp(String(c.email ?? ""), 200);
  const address = clamp(String(c.address ?? ""), 500);
  const whatsapp = clamp(String(c.whatsapp ?? ""), 40);
  const wechat_qr_url = clamp(String(c.wechat_qr_url ?? ""), 2000);
  const xiaohongshu_url = clamp(String(c.xiaohongshu_url ?? ""), 500);
  if (phone) {
    out.phone = phone;
  }
  if (email) {
    out.email = email;
  }
  if (address) {
    out.address = address;
  }
  if (whatsapp) {
    out.whatsapp = whatsapp;
  }
  if (wechat_qr_url) {
    out.wechat_qr_url = wechat_qr_url;
  }
  if (xiaohongshu_url) {
    out.xiaohongshu_url = xiaohongshu_url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildPropertyPromoFromForm(
  formData: FormData,
  existingPromo: PropertyPromoV1 | undefined,
  rawMerchantProfile: unknown,
): PropertyPromoV1 | undefined {
  const headline = clamp(String(formData.get("promo_headline") ?? ""), 200);
  const details = clamp(String(formData.get("promo_details") ?? ""), 2000);
  const listing_address = clamp(String(formData.get("listing_address") ?? ""), 500);
  const listing_price_hint = clamp(String(formData.get("listing_price_hint") ?? ""), 160);
  const bedsRaw = String(formData.get("listing_bedrooms") ?? "").trim();
  const bathsRaw = String(formData.get("listing_bathrooms") ?? "").trim();
  const listing_bedrooms =
    bedsRaw === "" ? undefined : Number.isFinite(Number.parseInt(bedsRaw, 10)) && Number.parseInt(bedsRaw, 10) >= 0
      ? Number.parseInt(bedsRaw, 10)
      : undefined;
  const listing_bathrooms =
    bathsRaw === "" ? undefined : Number.isFinite(Number.parseInt(bathsRaw, 10)) && Number.parseInt(bathsRaw, 10) >= 0
      ? Number.parseInt(bathsRaw, 10)
      : undefined;
  const image_url = clamp(String(formData.get("promo_image_url") ?? ""), 2000);
  const trademe_url = clamp(sanitizePastedTradeMeUrl(String(formData.get("promo_trademe_url") ?? "")), 500);
  const poster_template_id = normalizePosterTemplateId(String(formData.get("poster_template_id") ?? ""));
  const poster_locale = String(formData.get("poster_locale") ?? "zh") === "en" ? "en" : "zh";
  const listing_agent_name = clamp(String(formData.get("listing_agent_name") ?? ""), 120);
  const listing_agent_company = clamp(String(formData.get("listing_agent_company") ?? ""), 120);
  const listing_agent_phone = clamp(String(formData.get("listing_agent_phone") ?? ""), 40);
  const listing_agent_photo_url = clamp(String(formData.get("listing_agent_photo_url") ?? ""), 2000);

  const prevUrl = (existingPromo?.trademe_url ?? "").trim();
  const nextUrl = trademe_url.trim();
  const fromParse = existingPromo?.trademe_image_urls;
  const fromRaw = rawTrademeImageUrls(rawMerchantProfile);
  let trademe_image_urls =
    fromParse && fromParse.length > 0 ? fromParse : fromRaw;
  if (!nextUrl) {
    trademe_image_urls = undefined;
  } else if (prevUrl !== nextUrl) {
    trademe_image_urls = undefined;
  }

  const merged: PropertyPromoV1 = {
    ...existingPromo,
    headline: headline || undefined,
    details: details || undefined,
    listing_address: listing_address || undefined,
    listing_price_hint: listing_price_hint || undefined,
    listing_bedrooms,
    listing_bathrooms,
    image_url: image_url || undefined,
    trademe_url: nextUrl || undefined,
    poster_template_id,
    trademe_image_urls,
    poster_locale,
    listing_agent_name: listing_agent_name || undefined,
    listing_agent_company: listing_agent_company || undefined,
    listing_agent_phone: listing_agent_phone || undefined,
    listing_agent_photo_url: listing_agent_photo_url || undefined,
  };

  const hasAny =
    Boolean(merged.headline) ||
    Boolean(merged.details) ||
    Boolean(merged.listing_address) ||
    Boolean(merged.listing_price_hint) ||
    merged.listing_bedrooms != null ||
    merged.listing_bathrooms != null ||
    Boolean(merged.image_url) ||
    Boolean(merged.trademe_url) ||
    Boolean(merged.trademe_image_urls?.length) ||
    Boolean(merged.poster_template_id) ||
    Boolean(merged.poster_blurb_zh) ||
    Boolean(merged.poster_blurb_en) ||
    Boolean(merged.listing_agent_name) ||
    Boolean(merged.listing_agent_company) ||
    Boolean(merged.listing_agent_phone) ||
    Boolean(merged.listing_agent_photo_url);

  return hasAny ? merged : undefined;
}

export async function updateMerchantProfileFromForm(formData: FormData): Promise<void> {
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

  const contact = nonEmptyContact({
    phone: String(formData.get("contact_phone") ?? ""),
    email: String(formData.get("contact_email") ?? ""),
    address: String(formData.get("contact_address") ?? ""),
  });

  const { data: ms, error: msErr } = await supabase
    .from("microsites")
    .select("id, slug, published_at, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (msErr || !ms) {
    redirect(`/app/projects/${projectId}?notice=merchant_no_microsite`);
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  const hasPromoFields = formData.has("promo_headline");

  let property_promo: PropertyPromoV1 | undefined;
  if (hasPromoFields) {
    property_promo = buildPropertyPromoFromForm(formData, existing?.property_promo, ms.merchant_profile);
  } else {
    property_promo = existing?.property_promo;
  }

  const profile: MerchantProfileV1 = {
    ...(existing ?? { schema_version: 1 }),  // ✅ 保留所有现有字段（skeleton_id, theme, module_visibility 等）
    schema_version: 1,
    // 仅当表单提交了新数据时才覆盖，否则继承现有值
    ...(contact && { contact }),
    ...(property_promo && { property_promo }),
    // 保留 hero_image_url
    hero_image_url: existing?.hero_image_url,
  };

  // ✅ 仅当无现有数据且表单为空时才设为 null，否则保留所有字段
  const isEmpty = !existing && !contact && !property_promo;

  const { error: uErr } = await supabase
    .from("microsites")
    .update({
      merchant_profile: isEmpty ? null : profile,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  if (uErr) {
    redirect(`/app/projects/${projectId}?notice=merchant_save_error`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath(`/app/projects/${projectId}/poster`);
  if (ms.slug) {
    revalidatePath(`/site/${ms.slug}`);
  }

  redirect(`/app/projects/${projectId}?notice=merchant_saved`);
}

export async function updateBuilderIntegrationFromForm(formData: FormData): Promise<void> {
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

  const { data: ms, error: msErr } = await supabase
    .from("microsites")
    .select("id, slug, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (msErr || !ms) {
    redirect(`/app/projects/${projectId}?notice=builder_no_microsite`);
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  const enabled = formData.get("builder_section_enabled") === "on";
  const positionRaw = String(formData.get("builder_section_position") ?? "before");
  const position: "before" | "after" = positionRaw === "after" ? "after" : "before";
  const overrideRaw = clamp(String(formData.get("builder_url_path_override") ?? ""), 500);

  const profile: MerchantProfileV1 = {
    ...(existing ?? { schema_version: 1 }),
    schema_version: 1,
  };

  if (enabled) {
    profile.builder_section_enabled = true;
    profile.builder_section_position = position;
    if (overrideRaw) {
      profile.builder_url_path_override = overrideRaw;
    } else {
      delete profile.builder_url_path_override;
    }
  } else {
    delete profile.builder_section_enabled;
    delete profile.builder_url_path_override;
    delete profile.builder_section_position;
  }

  const { error: uErr } = await supabase
    .from("microsites")
    .update({
      merchant_profile: profile as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  if (uErr) {
    redirect(`/app/projects/${projectId}?notice=builder_save_error`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  if (ms.slug) {
    revalidatePath(`/site/${ms.slug}`);
  }

  redirect(`/app/projects/${projectId}?notice=builder_saved`);
}

/** 导入完成后跳回项目页、海报页，或留在「TradeMe → 海报」捷径页。 */
export type ImportListingReturnTo = "project" | "trademe-poster" | "poster";

function importListingBasePath(projectId: string, returnTo: ImportListingReturnTo): string {
  if (returnTo === "trademe-poster") {
    return `/app/projects/${projectId}/trademe-poster`;
  }
  if (returnTo === "poster") {
    return `/app/projects/${projectId}/poster`;
  }
  return `/app/projects/${projectId}`;
}

/**
 * 从 TradeMe 链接提取房源信息（Jina + LLM）并写入 merchant_profile；若有草稿则同步 hero。
 * `urlFromInput`：可选，与输入框一致；非空时优先于库里已保存的链接。
 * `redirectErrorBase` / `redirectSuccessBase`：可选；用于「无项目上下文」入口（错误回独立页，成功进海报）。
 */
export async function importListingFromUrl(
  projectId: string,
  urlFromInput?: string | null,
  returnTo: ImportListingReturnTo = "project",
  redirectErrorBase?: string | null,
  redirectSuccessBase?: string | null,
): Promise<void> {
  if (typeof projectId !== "string" || projectId.length === 0) {
    redirect("/app/projects");
  }

  const defaultBase = importListingBasePath(projectId, returnTo);
  const errBase = (redirectErrorBase?.trim() || defaultBase).replace(/\/$/, "");
  const okBase = (redirectSuccessBase?.trim() || defaultBase).replace(/\/$/, "");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(errBase)}`);
  }

  const { data: ms, error: msErr } = await supabase
    .from("microsites")
    .select("id, slug, merchant_profile, draft_model")
    .eq("project_id", projectId)
    .maybeSingle();

  if (msErr || !ms) {
    redirect(`${errBase}?notice=merchant_no_microsite`);
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  const rawPromo = rawPropertyPromoObject(ms.merchant_profile);
  const fromDb =
    existing?.property_promo?.trademe_url?.trim() ??
    (typeof rawPromo?.trademe_url === "string" ? rawPromo.trademe_url.trim() : "");
  const fromInput = typeof urlFromInput === "string" ? clamp(sanitizePastedTradeMeUrl(urlFromInput), 500) : "";
  const fromDbSanitized = fromDb ? sanitizePastedTradeMeUrl(fromDb) : "";
  const url = (fromInput || fromDbSanitized).trim();
  if (!url) {
    redirect(`${errBase}?notice=trademe_no_url`);
  }

  let listing: TradeMeListingData;
  let markdown: string;
  let extractLayer: TradeMeExtractLayer;
  try {
    const extracted = await extractTradeMeListingMultiLayer(url);
    listing = extracted.listing;
    markdown = extracted.markdown;
    extractLayer = extracted.extractLayer;
  } catch {
    redirect(`${errBase}?notice=listing_import_fail`);
  }

  const originalImages = [...listing.images];
  const proxiedImages = await proxyImagesToStorage(listing.images, projectId, supabase);
  listing = {
    ...listing,
    images: proxiedImages.length > 0 ? proxiedImages : originalImages,
  };

  let posterBlurbs: { zh: string; en: string };
  try {
    posterBlurbs = await generatePosterBlurbs(markdown, listing);
  } catch {
    posterBlurbs = { zh: "", en: "" };
  }

  const profilePayload = buildMerchantProfileFromListing(existing, listing, url, { posterBlurbs });

  const updatePayload: {
    merchant_profile: typeof profilePayload;
    draft_model?: unknown;
    updated_at: string;
  } = {
    merchant_profile: profilePayload,
    updated_at: new Date().toISOString(),
  };

  if (ms.draft_model && isRenderModelV1(ms.draft_model)) {
    updatePayload.draft_model = patchHeroDraftFromListing(ms.draft_model, listing);
  }

  const { data: updatedRow, error: uErr } = await supabase
    .from("microsites")
    .update(updatePayload)
    .eq("id", ms.id)
    .select("id")
    .maybeSingle();

  if (uErr || !updatedRow?.id) {
    redirect(`${errBase}?notice=merchant_save_error`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath(`/app/projects/${projectId}/trademe-poster`);
  revalidatePath(`/app/projects/${projectId}/poster`);
  if (ms.slug) {
    revalidatePath(`/site/${ms.slug}`);
  }

  redirect(`${okBase}?notice=listing_imported&extract_layer=${encodeURIComponent(extractLayer)}`);
}
