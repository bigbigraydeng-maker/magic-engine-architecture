import type { TradeMeListingData } from "@/lib/extraction/trademe-schema";
import type { MerchantProfileV1, PropertyPromoV1 } from "@/types/merchant-profile";
import type { RenderModelV1 } from "@/types/render-model";

const HERO_TITLE_MAX = 80;
const HERO_SUBTITLE_MAX = 200;
const PROMO_HEADLINE_MAX = 200;
const PROMO_DETAILS_MAX = 2000;

/** 从 listing URL 取末段数字 listingId，作标题兜底（避免免微站项目名「TradeMe 海报」占满海报主标题） */
function headlineFallbackFromTrademeUrl(trademeUrl: string): string | null {
  try {
    const u = new URL(trademeUrl.trim());
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    if (last && /^\d+$/.test(last)) {
      return `TradeMe 房源 · #${last}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 写入 property_promo.headline：优先标题，其次正文首行（常为营销句）、地址、价格/卧室、URL 末段 ID。
 */
export function resolvePromoHeadlineFromListing(listing: TradeMeListingData, trademeUrl: string): string {
  const t = listing.title.trim();
  if (t.length > 0) {
    return t.slice(0, PROMO_HEADLINE_MAX);
  }
  const desc = listing.description.trim();
  if (desc.length >= 20) {
    const firstLine =
      desc
        .split(/\r?\n+/)
        .map((s) => s.trim())
        .find((s) => s.length >= 15 && !/^(listed|auction|closing|open home|contact)\b/i.test(s)) ?? "";
    if (firstLine.length > 0) {
      return firstLine.slice(0, PROMO_HEADLINE_MAX);
    }
  }
  const addr = listing.address?.trim() ?? "";
  if (addr.length > 0) {
    return addr.slice(0, PROMO_HEADLINE_MAX);
  }
  const hints: string[] = [];
  if (listing.price_hint?.trim()) {
    hints.push(listing.price_hint.trim());
  }
  if (listing.bedrooms !== null && listing.bedrooms !== undefined) {
    hints.push(`${listing.bedrooms} 卧`);
  }
  if (hints.length > 0) {
    return hints.join(" · ").slice(0, PROMO_HEADLINE_MAX);
  }
  return headlineFallbackFromTrademeUrl(trademeUrl)?.slice(0, PROMO_HEADLINE_MAX) ?? "TradeMe 房源";
}

function resolvePromoDetailsFromListing(listing: TradeMeListingData): string {
  const body = listing.description.trim();
  if (body.length > 0) {
    return body.slice(0, PROMO_DETAILS_MAX);
  }
  const addr = listing.address?.trim();
  const price = listing.price_hint?.trim();
  const lines = [addr, price].filter((x): x is string => Boolean(x && x.length > 0));
  return lines.join("\n\n").slice(0, PROMO_DETAILS_MAX);
}

export interface BuildListingProfileOptions {
  /** 二次 LLM 生成的中英海报要点正文 */
  posterBlurbs?: { zh: string; en: string };
}

/**
 * 用提取结果填充商家资料：保留 contact 与 poster_template_id；`trademeUrl` 为用户粘贴的原始链接。
 */
export function buildMerchantProfileFromListing(
  existing: MerchantProfileV1 | null,
  listing: TradeMeListingData,
  trademeUrl: string,
  options?: BuildListingProfileOptions,
): MerchantProfileV1 {
  const prevPromo = existing?.property_promo;
  const locale = prevPromo?.poster_locale === "en" ? "en" : "zh";

  const headline = resolvePromoHeadlineFromListing(listing, trademeUrl);
  const details = resolvePromoDetailsFromListing(listing);

  const addr = listing.address?.trim() ?? "";
  const price = listing.price_hint?.trim() ?? "";

  const property_promo: PropertyPromoV1 = {
    ...prevPromo,
    headline,
    details,
    ...(addr ? { listing_address: addr.slice(0, 500) } : {}),
    ...(price ? { listing_price_hint: price.slice(0, 160) } : {}),
    ...(listing.bedrooms != null && listing.bedrooms >= 0 ? { listing_bedrooms: listing.bedrooms } : {}),
    ...(listing.bathrooms != null && listing.bathrooms >= 0 ? { listing_bathrooms: listing.bathrooms } : {}),
    trademe_image_urls: listing.images,
    trademe_url: trademeUrl.trim(),
    poster_locale: locale,
    ...(listing.images[0] ? { image_url: listing.images[0] } : {}),
    ...(listing.agent_name?.trim() ? { listing_agent_name: listing.agent_name.trim() } : {}),
    ...(listing.agent_company?.trim() ? { listing_agent_company: listing.agent_company.trim() } : {}),
    ...(listing.agent_phone?.trim()
      ? { listing_agent_phone: listing.agent_phone.trim() }
      : {}),
    ...(listing.agent_photo_url?.trim() ? { listing_agent_photo_url: listing.agent_photo_url.trim() } : {}),
    ...(options?.posterBlurbs
      ? {
          poster_blurb_zh: options.posterBlurbs.zh,
          poster_blurb_en: options.posterBlurbs.en,
        }
      : {}),
  };

  if (!addr) {
    delete property_promo.listing_address;
  }
  if (!price) {
    delete property_promo.listing_price_hint;
  }
  if (listing.bedrooms == null || listing.bedrooms < 0) {
    delete property_promo.listing_bedrooms;
  }
  if (listing.bathrooms == null || listing.bathrooms < 0) {
    delete property_promo.listing_bathrooms;
  }

  return {
    schema_version: 1,
    ...(existing?.contact ? { contact: { ...existing.contact } } : {}),
    property_promo,
  };
}

/**
 * 更新草稿中的 hero 文案与图片 alt；无 hero 模块时原样返回（同一引用，未修改）。
 */
export function patchHeroDraftFromListing(currentDraftModel: RenderModelV1, listing: TradeMeListingData): RenderModelV1 {
  const hasHero = currentDraftModel.modules.some((m) => m.type === "hero");
  if (!hasHero) {
    return currentDraftModel;
  }

  const heroTitle = resolvePromoHeadlineFromListing(listing, "");
  const titleSlice = heroTitle.slice(0, HERO_TITLE_MAX);
  const subtitleSlice = listing.description.trim().slice(0, HERO_SUBTITLE_MAX);
  const altText = heroTitle.slice(0, 120);

  return {
    ...currentDraftModel,
    modules: currentDraftModel.modules.map((mod) => {
      if (mod.type !== "hero") {
        return mod;
      }
      return {
        ...mod,
        content: {
          ...mod.content,
          title: titleSlice.length > 0 ? titleSlice : mod.content.title,
          subtitle: subtitleSlice.length > 0 ? subtitleSlice : mod.content.subtitle,
          image: {
            ...mod.content.image,
            alt: altText.length > 0 ? altText : mod.content.image.alt,
          },
        },
      };
    }),
  };
}
