export const MEDIA_SOURCES = ["upload", "unsplash", "ai_generated"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export const MEDIA_CATEGORIES = [
  "general",
  "hero",
  "property",
  "portrait",
  "brand",
  "poster",
  "social",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MediaCategory, string> = {
  general: "通用",
  hero: "Hero 横幅",
  property: "房源",
  portrait: "人像",
  brand: "品牌",
  poster: "海报",
  social: "社媒",
};

export interface MediaAsset {
  id: string;
  project_id: string;
  user_id: string;
  source: MediaSource;
  url: string;
  thumbnail_url: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  unsplash_id: string | null;
  unsplash_photographer: string | null;
  unsplash_photographer_url: string | null;
  unsplash_download_location: string | null;
  ai_prompt: string | null;
  ai_provider: string | null;
  category: MediaCategory;
  tags: string[];
  alt_text: string | null;
  used_in: string[];
  created_at: string;
  updated_at: string;
}

export function isMediaCategory(v: unknown): v is MediaCategory {
  return typeof v === "string" && (MEDIA_CATEGORIES as readonly string[]).includes(v);
}

export function isMediaSource(v: unknown): v is MediaSource {
  return typeof v === "string" && (MEDIA_SOURCES as readonly string[]).includes(v);
}

/** Normalize a Supabase row into {@link MediaAsset} (best-effort). */
export function parseMediaAsset(row: unknown): MediaAsset | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const o = row as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.project_id !== "string" || typeof o.user_id !== "string") {
    return null;
  }
  if (!isMediaSource(o.source) || typeof o.url !== "string") {
    return null;
  }
  if (!isMediaCategory(o.category)) {
    return null;
  }
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [];
  const usedIn = Array.isArray(o.used_in) ? o.used_in.filter((t): t is string => typeof t === "string") : [];

  return {
    id: o.id,
    project_id: o.project_id,
    user_id: o.user_id,
    source: o.source,
    url: o.url,
    thumbnail_url: typeof o.thumbnail_url === "string" ? o.thumbnail_url : null,
    storage_path: typeof o.storage_path === "string" ? o.storage_path : null,
    width: typeof o.width === "number" ? o.width : null,
    height: typeof o.height === "number" ? o.height : null,
    file_size_bytes: typeof o.file_size_bytes === "number" ? o.file_size_bytes : null,
    mime_type: typeof o.mime_type === "string" ? o.mime_type : null,
    unsplash_id: typeof o.unsplash_id === "string" ? o.unsplash_id : null,
    unsplash_photographer: typeof o.unsplash_photographer === "string" ? o.unsplash_photographer : null,
    unsplash_photographer_url: typeof o.unsplash_photographer_url === "string" ? o.unsplash_photographer_url : null,
    unsplash_download_location:
      typeof o.unsplash_download_location === "string" ? o.unsplash_download_location : null,
    ai_prompt: typeof o.ai_prompt === "string" ? o.ai_prompt : null,
    ai_provider: typeof o.ai_provider === "string" ? o.ai_provider : null,
    category: o.category,
    tags,
    alt_text: typeof o.alt_text === "string" ? o.alt_text : null,
    used_in: usedIn,
    created_at: typeof o.created_at === "string" ? o.created_at : "",
    updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
  };
}
