import OpenAI from "openai";
import type { MerchantProfileV1, PropertyListing } from "@/types/merchant-profile";
import type { PlatformCaptions, SocialCaptionsV1, SocialContentType, SocialImagePlan } from "@/types/social-content";

const PLATFORM_MAX: Record<keyof SocialCaptionsV1["platforms"], { en: number; zh: number }> = {
  facebook: { en: 500, zh: 500 },
  instagram: { en: 2200, zh: 2200 },
  linkedin: { en: 3000, zh: 3000 },
  xiaohongshu: { en: 1000, zh: 1000 },
};

const CONTENT_LABELS: Record<SocialContentType, { en: string; zh: string }> = {
  just_listed: { en: "Just listed — new property on the market", zh: "新上市房源" },
  just_sold: { en: "Just sold — celebrate a successful sale", zh: "成功售出 / 成交喜报" },
  open_home: { en: "Open home invitation", zh: "开放看房日邀请" },
  market_update: { en: "Local market snapshot / weekly update", zh: "本地楼市简报 / 周报" },
  buying_tips: { en: "Practical tips for buyers in NZ", zh: "新西兰买房实用贴士" },
  nl_upload: { en: "User-directed post from own files", zh: "自然语言 + 用户自有素材" },
};

function truncateToMaxChars(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) {
    return s;
  }
  return chars.slice(0, max).join("");
}

function clampPlatform(c: PlatformCaptions, max: { en: number; zh: number }): PlatformCaptions {
  return {
    en: truncateToMaxChars(c.en, max.en),
    zh: truncateToMaxChars(c.zh, max.zh),
  };
}

/** Exported for nl_upload multimodal flow (same JSON shape + optional image_plan). */
export function parseSocialCaptionsFromJson(raw: string): SocialCaptionsV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI JSON root must be an object");
  }
  const o = parsed as Record<string, unknown>;
  const platforms = o.platforms;
  if (!platforms || typeof platforms !== "object") {
    throw new Error("Missing platforms object");
  }
  const p = platforms as Record<string, unknown>;

  function readPl(key: keyof SocialCaptionsV1["platforms"]): PlatformCaptions {
    const block = p[key];
    if (!block || typeof block !== "object") {
      return { en: "", zh: "" };
    }
    const b = block as Record<string, unknown>;
    const en = typeof b.en === "string" ? b.en.trim() : "";
    const zh = typeof b.zh === "string" ? b.zh.trim() : "";
    return { en, zh };
  }

  const keys: (keyof SocialCaptionsV1["platforms"])[] = ["facebook", "instagram", "linkedin", "xiaohongshu"];
  const out: SocialCaptionsV1["platforms"] = {
    facebook: clampPlatform(readPl("facebook"), PLATFORM_MAX.facebook),
    instagram: clampPlatform(readPl("instagram"), PLATFORM_MAX.instagram),
    linkedin: clampPlatform(readPl("linkedin"), PLATFORM_MAX.linkedin),
    xiaohongshu: clampPlatform(readPl("xiaohongshu"), PLATFORM_MAX.xiaohongshu),
  };

  for (const k of keys) {
    if (!out[k].en && !out[k].zh) {
      throw new Error(`Empty captions for ${k}`);
    }
  }

  let image_plan: SocialImagePlan | undefined;
  const ip = o.image_plan;
  if (ip && typeof ip === "object") {
    const im = ip as Record<string, unknown>;
    const zh = typeof im.zh === "string" ? im.zh.trim() : "";
    const en = typeof im.en === "string" ? im.en.trim() : "";
    if (zh || en) {
      image_plan = {
        zh: truncateToMaxChars(zh, 2000),
        en: truncateToMaxChars(en, 2000),
      };
    }
  }

  return { schema_version: 1, platforms: out, ...(image_plan ? { image_plan } : {}) };
}

function listingSummary(listing: PropertyListing | null | undefined): string {
  if (!listing) {
    return "";
  }
  const parts = [
    listing.name,
    listing.address,
    listing.price_hint ? `Price hint: ${listing.price_hint}` : "",
    listing.description ? listing.description.slice(0, 800) : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function profileSummary(profile: MerchantProfileV1, projectName: string): string {
  const lines = [
    `Project / brand: ${projectName}`,
    profile.display_name ? `Agent name: ${profile.display_name}` : "",
    profile.company_name ? `Company: ${profile.company_name}` : "",
    profile.contact?.phone ? `Phone: ${profile.contact.phone}` : "",
    profile.contact?.email ? `Email: ${profile.contact.email}` : "",
    profile.bio_en ? `Bio (EN): ${profile.bio_en.slice(0, 400)}` : "",
    profile.bio_zh ? `Bio (ZH): ${profile.bio_zh.slice(0, 400)}` : "",
    profile.property_promo?.headline ? `Promo headline: ${profile.property_promo.headline}` : "",
    profile.property_promo?.details ? `Promo details: ${profile.property_promo.details.slice(0, 500)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function generateSocialCopy(input: {
  contentType: SocialContentType;
  profile: MerchantProfileV1;
  projectName: string;
  listing?: PropertyListing | null;
}): Promise<SocialCaptionsV1> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const client = new OpenAI({
    apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });

  const typeLabel = CONTENT_LABELS[input.contentType];
  const listingBlock = listingSummary(input.listing);

  const system = `You write social media marketing copy for real estate agents in New Zealand.
Output a single JSON object only (no markdown, no code fences).
Tone: professional, warm, compliant — no guaranteed returns, no misleading price claims, no "guaranteed visa" style promises.
Provide BOTH English (en) and Simplified Chinese (zh) for every platform field.
Chinese must sound natural and locally appropriate (新西兰华人读者), not machine-translated stiffness.
Each platform has its own character limit (count Unicode scalar values / extended grapheme clusters approximately as characters — stay clearly under the limit).
Include soft CTAs (DM, open home RSVP, link in bio) where suitable without inventing URLs.`;

  const user = `Content theme: ${typeLabel.en} (${typeLabel.zh})

Business context:
${profileSummary(input.profile, input.projectName)}

${listingBlock ? `Listing focus (use only facts given; do not invent specs):\n${listingBlock}\n` : ""}

Return JSON with this exact shape (all keys required):
{
  "platforms": {
    "facebook": { "en": string, "zh": string },
    "instagram": { "en": string, "zh": string },
    "linkedin": { "en": string, "zh": string },
    "xiaohongshu": { "en": string, "zh": string }
  }
}

Hard limits (per language string):
- facebook: max 500 characters each for en and zh
- instagram: max 2200 characters each
- linkedin: max 3000 characters each
- xiaohongshu: max 1000 characters each for en and zh (note: 小红书 primary audience reads zh; en can be a shorter parallel or key phrases)`;

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.75,
    max_tokens: 4000,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty response from OpenAI");
  }

  return parseSocialCaptionsFromJson(raw);
}
