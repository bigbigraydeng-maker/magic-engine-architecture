import { filterAndRankListingImageUrls } from "@/lib/extraction/image-url-filters";
import { safeExternalImageUrl } from "@/lib/merchant-profile/render-merge";
import type { PropertyPromoV1 } from "@/types/merchant-profile";

/** 主图 URL 优先，其次 TradeMe 列表；去重、过滤 logo 噪声、排序。`max` 默认 12；海报主图区可传 3。 */
export function collectPosterImageUrls(promo: PropertyPromoV1 | undefined, max = 12): string[] {
  const raw: string[] = [];
  const push = (url: string | undefined) => {
    const u = safeExternalImageUrl(url);
    if (u && !raw.includes(u)) {
      raw.push(u);
    }
  };
  push(promo?.image_url);
  for (const u of promo?.trademe_image_urls ?? []) {
    push(u);
  }
  const cap = max >= 1 && max <= 24 ? max : 12;
  return filterAndRankListingImageUrls(raw, cap);
}
