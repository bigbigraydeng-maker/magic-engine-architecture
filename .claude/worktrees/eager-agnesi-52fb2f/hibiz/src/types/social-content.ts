/** Social marketing content (stored in social_posts.captions JSONB). */

export const SOCIAL_CONTENT_TYPES = [
  "just_listed",
  "just_sold",
  "open_home",
  "market_update",
  "buying_tips",
  /** User prompt + own files (images / text) → multi-platform copy */
  "nl_upload",
] as const;

export type SocialContentType = (typeof SOCIAL_CONTENT_TYPES)[number];

export function isSocialContentType(v: string): v is SocialContentType {
  return (SOCIAL_CONTENT_TYPES as readonly string[]).includes(v);
}

export interface PlatformCaptions {
  en: string;
  zh: string;
}

/** Optional: how to pair user-uploaded images with each platform (not auto-posted). */
export interface SocialImagePlan {
  zh: string;
  en: string;
}

export interface SocialCaptionsV1 {
  schema_version: 1;
  platforms: {
    facebook: PlatformCaptions;
    instagram: PlatformCaptions;
    linkedin: PlatformCaptions;
    xiaohongshu: PlatformCaptions;
  };
  /** Present when generated from nl_upload flow */
  image_plan?: SocialImagePlan;
}

function coerceImagePlan(o: unknown): SocialImagePlan | undefined {
  if (!o || typeof o !== "object") {
    return undefined;
  }
  const x = o as Record<string, unknown>;
  const zh = typeof x.zh === "string" ? x.zh.trim() : "";
  const en = typeof x.en === "string" ? x.en.trim() : "";
  if (!zh && !en) {
    return undefined;
  }
  return { zh, en };
}

function coercePlatform(o: unknown): PlatformCaptions | null {
  if (!o || typeof o !== "object") {
    return null;
  }
  const x = o as Record<string, unknown>;
  const en = typeof x.en === "string" ? x.en.trim() : "";
  const zh = typeof x.zh === "string" ? x.zh.trim() : "";
  if (!en && !zh) {
    return null;
  }
  return { en, zh };
}

export function parseSocialCaptionsV1(raw: unknown): SocialCaptionsV1 | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const root = raw as Record<string, unknown>;
  if (root.schema_version !== 1) {
    return null;
  }
  const pl = root.platforms;
  if (!pl || typeof pl !== "object") {
    return null;
  }
  const p = pl as Record<string, unknown>;
  const facebook = coercePlatform(p.facebook);
  const instagram = coercePlatform(p.instagram);
  const linkedin = coercePlatform(p.linkedin);
  const xiaohongshu = coercePlatform(p.xiaohongshu);
  if (!facebook || !instagram || !linkedin || !xiaohongshu) {
    return null;
  }
  const image_plan = coerceImagePlan(root.image_plan);
  return {
    schema_version: 1,
    platforms: { facebook, instagram, linkedin, xiaohongshu },
    ...(image_plan ? { image_plan } : {}),
  };
}

export interface SocialPostRow {
  id: string;
  project_id: string;
  content_type: SocialContentType;
  captions: SocialCaptionsV1;
  poster_url: string | null;
  status: "active" | "deleted";
  deleted_at: string | null;
  created_at: string;
}
