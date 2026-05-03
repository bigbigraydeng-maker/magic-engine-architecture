/** Stored in microsites.merchant_profile (JSONB). */

import { normalizePosterTemplateId, type PosterTemplateId } from "@/data/poster-templates";
import { coercePersistedTradeMeImageUrl } from "@/lib/extraction/legacy-url";

function newListingId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export interface MerchantContactV1 {
  phone?: string;
  email?: string;
  address?: string;
  whatsapp?: string;
  wechat_qr_url?: string;
  xiaohongshu_url?: string;
}

/** Manual property cards (no new DB table). */
export interface PropertyListing {
  id: string;
  name: string;
  address: string;
  description: string;
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  price_hint?: string;
  trademe_url?: string;
  sort_order: number;
}

export interface MerchantThemeOverridesV1 {
  palette_id?: string;
  primary?: string;
  accent?: string;
  background?: string;
}

/** Real estate: manual promo — no listing feed; image via HTTPS URL (upload to Storage later). */
export interface PropertyPromoV1 {
  /** TradeMe 房源页标题（海报主标题应与之一致） */
  headline?: string;
  /** 原始长描述（导入）；海报「短说明」优先 poster_blurb */
  details?: string;
  /** 与 TradeMe 页地址行一致；与 headline 分列展示 */
  listing_address?: string;
  /** 页面上标价/议价/周租等原文案；无则海报不显示价格区 */
  listing_price_hint?: string;
  listing_bedrooms?: number;
  listing_bathrooms?: number;
  image_url?: string;
  trademe_url?: string;
  /** 海报选用的设计模板 */
  poster_template_id?: PosterTemplateId;
  /** 从 TradeMe 页缓存的图片（服务端抓取） */
  trademe_image_urls?: string[];
  /** 从 listing 导入的中介展示（海报/预览；可与 contact 手工电话并存） */
  listing_agent_name?: string;
  listing_agent_company?: string;
  /** 海报上优先展示；可与上方 Contact 电话不同（如 listing 上分机号） */
  listing_agent_phone?: string;
  listing_agent_photo_url?: string;
  /** 导入生成的海报正文（提炼要点）；海报优先显示对应语言 */
  poster_blurb_zh?: string;
  poster_blurb_en?: string;
  /** 海报摘要语言（打印用） */
  poster_locale?: "en" | "zh";
}

export interface MerchantProfileV1 {
  schema_version: 1;
  contact?: MerchantContactV1;
  property_promo?: PropertyPromoV1;
  /** 站点 Hero 主图（HTTPS URL）；优先于 property_promo.image_url / avatar。 */
  hero_image_url?: string;
  display_name?: string;
  company_name?: string;
  logo_url?: string;
  avatar_url?: string;
  bio_zh?: string;
  bio_en?: string;
  skeleton_id?: string;
  theme_overrides?: MerchantThemeOverridesV1;
  /** module id → visible (hero/footer ignored when forcing on) */
  module_visibility?: Record<string, boolean>;
  property_listings?: PropertyListing[];
  /** When true, load optional Builder.io section for this microsite (requires `NEXT_PUBLIC_BUILDER_API_KEY`). */
  builder_section_enabled?: boolean;
  /** Override Builder targeting `urlPath` (default: `/site/{microsite slug}`). Max 500 chars. */
  builder_url_path_override?: string;
  /** Where to render the Builder section relative to `RenderMicrosite`. Default `before`. */
  builder_section_position?: "before" | "after";
}

function clampStr(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

function parsePropertyListing(raw: unknown, fallbackOrder: number): PropertyListing | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const name = clampStr(o.name, 200);
  const address = clampStr(o.address, 500);
  if (!name || !address) {
    return null;
  }
  const idRaw = clampStr(o.id, 80);
  const id = idRaw || newListingId();
  const images = Array.isArray(o.images)
    ? o.images
        .map((x) => (typeof x === "string" ? coercePersistedTradeMeImageUrl(x) : null))
        .filter((x): x is string => x !== null)
        .slice(0, 24)
    : [];
  const bedrooms = typeof o.bedrooms === "number" && Number.isFinite(o.bedrooms) ? Math.floor(o.bedrooms) : undefined;
  const bathrooms =
    typeof o.bathrooms === "number" && Number.isFinite(o.bathrooms) ? Math.floor(o.bathrooms) : undefined;
  const sort_order =
    typeof o.sort_order === "number" && Number.isFinite(o.sort_order) ? Math.floor(o.sort_order) : fallbackOrder;
  return {
    id,
    name,
    address,
    description: clampStr(o.description, 8000),
    images,
    bedrooms,
    bathrooms,
    price_hint: clampStr(o.price_hint, 80) || undefined,
    trademe_url: clampStr(o.trademe_url, 500) || undefined,
    sort_order,
  };
}

export function parseMerchantProfile(raw: unknown): MerchantProfileV1 | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;

  const contact: MerchantContactV1 = {};
  if (o.contact && typeof o.contact === "object") {
    const c = o.contact as Record<string, unknown>;
    if (typeof c.phone === "string" && c.phone.trim()) {
      contact.phone = c.phone.trim();
    }
    if (typeof c.email === "string" && c.email.trim()) {
      contact.email = c.email.trim();
    }
    if (typeof c.address === "string" && c.address.trim()) {
      contact.address = c.address.trim();
    }
    if (typeof c.whatsapp === "string" && c.whatsapp.trim()) {
      contact.whatsapp = c.whatsapp.trim();
    }
    if (typeof c.wechat_qr_url === "string" && c.wechat_qr_url.trim()) {
      contact.wechat_qr_url = c.wechat_qr_url.trim();
    }
    if (typeof c.xiaohongshu_url === "string" && c.xiaohongshu_url.trim()) {
      contact.xiaohongshu_url = c.xiaohongshu_url.trim();
    }
  }

  const property_promo: PropertyPromoV1 = {};
  if (o.property_promo && typeof o.property_promo === "object") {
    const p = o.property_promo as Record<string, unknown>;
    if (typeof p.headline === "string" && p.headline.trim()) {
      property_promo.headline = p.headline.trim();
    }
    if (typeof p.details === "string" && p.details.trim()) {
      property_promo.details = p.details.trim();
    }
    if (typeof p.listing_address === "string" && p.listing_address.trim()) {
      property_promo.listing_address = p.listing_address.trim().slice(0, 500);
    }
    if (typeof p.listing_price_hint === "string" && p.listing_price_hint.trim()) {
      property_promo.listing_price_hint = p.listing_price_hint.trim().slice(0, 160);
    }
    const lb = p.listing_bedrooms;
    if (typeof lb === "number" && Number.isFinite(lb) && lb >= 0) {
      property_promo.listing_bedrooms = Math.floor(lb);
    }
    const lba = p.listing_bathrooms;
    if (typeof lba === "number" && Number.isFinite(lba) && lba >= 0) {
      property_promo.listing_bathrooms = Math.floor(lba);
    }
    if (typeof p.image_url === "string" && p.image_url.trim()) {
      property_promo.image_url = p.image_url.trim();
    }
    if (typeof p.trademe_url === "string" && p.trademe_url.trim()) {
      property_promo.trademe_url = p.trademe_url.trim();
    }
    if (typeof p.poster_template_id === "string") {
      property_promo.poster_template_id = normalizePosterTemplateId(p.poster_template_id);
    }
    if (Array.isArray(p.trademe_image_urls)) {
      const urls = p.trademe_image_urls
        .map((x) => (typeof x === "string" ? coercePersistedTradeMeImageUrl(x) : null))
        .filter((x): x is string => x !== null);
      if (urls.length > 0) {
        property_promo.trademe_image_urls = urls.slice(0, 12);
      }
    }
    if (typeof p.listing_agent_name === "string" && p.listing_agent_name.trim()) {
      property_promo.listing_agent_name = p.listing_agent_name.trim();
    }
    if (typeof p.listing_agent_company === "string" && p.listing_agent_company.trim()) {
      property_promo.listing_agent_company = p.listing_agent_company.trim();
    }
    if (typeof p.listing_agent_photo_url === "string" && p.listing_agent_photo_url.trim()) {
      property_promo.listing_agent_photo_url = p.listing_agent_photo_url.trim();
    }
    if (typeof p.listing_agent_phone === "string" && p.listing_agent_phone.trim()) {
      property_promo.listing_agent_phone = p.listing_agent_phone.trim();
    }
    if (typeof p.poster_blurb_zh === "string" && p.poster_blurb_zh.trim()) {
      property_promo.poster_blurb_zh = p.poster_blurb_zh.trim();
    }
    if (typeof p.poster_blurb_en === "string" && p.poster_blurb_en.trim()) {
      property_promo.poster_blurb_en = p.poster_blurb_en.trim();
    }
    if (p.poster_locale === "en" || p.poster_locale === "zh") {
      property_promo.poster_locale = p.poster_locale;
    }
  }

  const hero_image_url = clampStr(o.hero_image_url, 2000) || undefined;
  const display_name = clampStr(o.display_name, 120) || undefined;
  const company_name = clampStr(o.company_name, 120) || undefined;
  const logo_url = clampStr(o.logo_url, 2000) || undefined;
  const avatar_url = clampStr(o.avatar_url, 2000) || undefined;
  const bio_zh = clampStr(o.bio_zh, 4000) || undefined;
  const bio_en = clampStr(o.bio_en, 4000) || undefined;
  const skeleton_id = clampStr(o.skeleton_id, 80) || undefined;

  let theme_overrides: MerchantThemeOverridesV1 | undefined;
  if (o.theme_overrides && typeof o.theme_overrides === "object") {
    const t = o.theme_overrides as Record<string, unknown>;
    const palette_id = clampStr(t.palette_id, 80) || undefined;
    const primary = clampStr(t.primary, 32) || undefined;
    const accent = clampStr(t.accent, 32) || undefined;
    const background = clampStr(t.background, 32) || undefined;
    if (palette_id || primary || accent || background) {
      theme_overrides = {
        ...(palette_id ? { palette_id } : {}),
        ...(primary ? { primary } : {}),
        ...(accent ? { accent } : {}),
        ...(background ? { background } : {}),
      };
    }
  }

  let module_visibility: Record<string, boolean> | undefined;
  if (o.module_visibility && typeof o.module_visibility === "object" && !Array.isArray(o.module_visibility)) {
    const mv = o.module_visibility as Record<string, unknown>;
    const entries = Object.entries(mv).filter(
      ([k, v]) => k.length > 0 && k.length < 120 && typeof v === "boolean",
    );
    if (entries.length > 0) {
      module_visibility = Object.fromEntries(entries) as Record<string, boolean>;
    }
  }

  let property_listings: PropertyListing[] | undefined;
  if (Array.isArray(o.property_listings)) {
    const parsed = o.property_listings
      .map((item, idx) => parsePropertyListing(item, idx))
      .filter((x): x is PropertyListing => x !== null);
    if (parsed.length > 0) {
      property_listings = parsed.sort((a, b) => a.sort_order - b.sort_order);
    }
  }

  const builder_section_enabled = o.builder_section_enabled === true;
  const builder_url_path_override = clampStr(o.builder_url_path_override, 500) || undefined;
  const builder_section_position =
    o.builder_section_position === "after"
      ? "after"
      : o.builder_section_position === "before"
        ? "before"
        : undefined;

  const hasContact = Object.keys(contact).length > 0;
  const hasPromo = Object.keys(property_promo).length > 0;
  const hasTop =
    Boolean(hero_image_url) ||
    Boolean(display_name) ||
    Boolean(company_name) ||
    Boolean(logo_url) ||
    Boolean(avatar_url) ||
    Boolean(bio_zh) ||
    Boolean(bio_en) ||
    Boolean(skeleton_id) ||
    Boolean(theme_overrides) ||
    Boolean(module_visibility) ||
    Boolean(property_listings?.length) ||
    builder_section_enabled;

  if (!hasContact && !hasPromo && !hasTop) {
    return null;
  }

  return {
    schema_version: 1,
    ...(hasContact ? { contact } : {}),
    ...(hasPromo ? { property_promo } : {}),
    ...(hero_image_url ? { hero_image_url } : {}),
    ...(display_name ? { display_name } : {}),
    ...(company_name ? { company_name } : {}),
    ...(logo_url ? { logo_url } : {}),
    ...(avatar_url ? { avatar_url } : {}),
    ...(bio_zh ? { bio_zh } : {}),
    ...(bio_en ? { bio_en } : {}),
    ...(skeleton_id ? { skeleton_id } : {}),
    ...(theme_overrides ? { theme_overrides } : {}),
    ...(module_visibility ? { module_visibility } : {}),
    ...(property_listings ? { property_listings } : {}),
    ...(builder_section_enabled ? { builder_section_enabled: true } : {}),
    ...(builder_url_path_override ? { builder_url_path_override } : {}),
    ...(builder_section_position ? { builder_section_position } : {}),
  };
}
