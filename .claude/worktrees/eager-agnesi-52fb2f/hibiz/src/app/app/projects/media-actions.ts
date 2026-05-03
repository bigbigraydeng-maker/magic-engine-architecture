"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  photographerUrl,
  searchUnsplashPhotos,
  triggerUnsplashDownload,
  type UnsplashPhoto,
} from "@/lib/media/unsplash-client";
import { isMediaCategory, parseMediaAsset, type MediaAsset, type MediaCategory } from "@/types/media-asset";
import { parseMerchantProfile, type MerchantProfileV1 } from "@/types/merchant-profile";
import { safeExternalImageUrl } from "@/lib/merchant-profile/render-merge";

async function assertProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return Boolean(data?.id);
}

// ── Unsplash 搜索 ─────────────────────────────────

export interface UnsplashSearchParams {
  query: string;
  page?: number;
  perPage?: number;
  orientation?: "landscape" | "portrait" | "squarish";
}

export async function searchUnsplash(params: UnsplashSearchParams) {
  // HIGH-2: 添加鉴权检查（API 配额保护）
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  return searchUnsplashPhotos(params.query, {
    page: params.page,
    perPage: params.perPage,
    orientation: params.orientation,
  });
}

// ── 保存 Unsplash 图片到素材库 ─────────────────────

export async function saveUnsplashToLibrary(
  projectId: string,
  photo: UnsplashPhoto,
  category: MediaCategory = "general",
): Promise<{ id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const ok = await assertProjectOwner(projectId, user.id);
  if (!ok) {
    throw new Error("Project not found or access denied.");
  }

  await triggerUnsplashDownload(photo.links.download_location);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      user_id: user.id,
      source: "unsplash",
      url: photo.urls.regular,
      thumbnail_url: photo.urls.small,
      width: photo.width,
      height: photo.height,
      unsplash_id: photo.id,
      unsplash_photographer: photo.user.name,
      unsplash_photographer_url: photographerUrl(photo.user.username),
      unsplash_download_location: photo.links.download_location,
      category,
      alt_text: photo.alt_description ?? photo.description,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save: ${error?.message ?? "unknown"}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
  return { id: data.id };
}

// ── 上传图片 ──────────────────────────────────────

export async function uploadImageToLibrary(projectId: string, formData: FormData): Promise<{ id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const ok = await assertProjectOwner(projectId, user.id);
  if (!ok) {
    throw new Error("Project not found or access denied.");
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    throw new Error("No file provided.");
  }

  const categoryRaw = formData.get("category") as string | null;
  const category: MediaCategory = categoryRaw && isMediaCategory(categoryRaw) ? categoryRaw : "general";

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Only JPEG, PNG, WebP allowed.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB).");
  }

  // HIGH-3: 从验证过的 MIME 类型推导扩展名，不信任用户上传的文件名
  const MIME_TO_EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = MIME_TO_EXT[file.type] ?? "jpg";
  const storagePath = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("media").upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      user_id: user.id,
      source: "upload",
      url: urlData.publicUrl,
      thumbnail_url: urlData.publicUrl,
      storage_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
      category,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Save failed: ${error?.message ?? "unknown"}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
  return { id: data.id };
}

// ── 删除图片 ──────────────────────────────────────

export async function deleteMediaAsset(projectId: string, assetId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const { data: asset } = await supabase
    .from("media_assets")
    .select("storage_path")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (asset?.storage_path) {
    await supabase.storage.from("media").remove([asset.storage_path]);
  }

  const { error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
}

// ── 更新分类 ──────────────────────────────────────

export async function updateMediaCategory(projectId: string, assetId: string, category: MediaCategory): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const { error } = await supabase
    .from("media_assets")
    .update({ category, updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Update failed: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
}

// ── 获取素材库（Server 侧可选用）───────────────────

export async function getMediaAssets(
  projectId: string,
  category?: MediaCategory,
): Promise<{ assets: MediaAsset[] }> {
  const supabase = createClient();

  let query = supabase
    .from("media_assets")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200); // MEDIUM-1: 防止返回无上界的行数

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Fetch failed: ${error.message}`);
  }

  const assets: MediaAsset[] = [];
  for (const row of data ?? []) {
    const parsed = parseMediaAsset(row);
    if (parsed) {
      assets.push(parsed);
    }
  }

  return { assets };
}

/** 将图片 URL 写入 merchant_profile.hero_image_url，预览与公开页 Hero 即更新。 */
export async function applyImageToHero(projectId: string, imageUrl: string): Promise<void> {
  const safe = safeExternalImageUrl(imageUrl);
  if (!safe) {
    throw new Error("Invalid image URL (must be http/https).");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const ok = await assertProjectOwner(projectId, user.id);
  if (!ok) {
    throw new Error("Project not found or access denied.");
  }

  const { data: ms, error: msErr } = await supabase
    .from("microsites")
    .select("id, merchant_profile")
    .eq("project_id", projectId)
    .maybeSingle();

  if (msErr || !ms) {
    throw new Error("Microsite not found. Generate a site draft first.");
  }

  const existing = parseMerchantProfile(ms.merchant_profile);
  const nextProfile: MerchantProfileV1 = {
    ...(existing ?? { schema_version: 1 }),
    schema_version: 1,
    hero_image_url: safe,
  };

  const { error } = await supabase
    .from("microsites")
    .update({
      merchant_profile: nextProfile as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ms.id);

  if (error) {
    throw new Error(`Failed to update hero: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath(`/app/projects/${projectId}/media`);
  revalidatePath(`/app/projects/${projectId}/toolkit`);
}
