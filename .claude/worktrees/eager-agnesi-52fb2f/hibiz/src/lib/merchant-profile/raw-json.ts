/**
 * merchant_profile 在库里是自由 JSON；读库解析可能丢掉部分字段，写回时必须从原始对象合并，避免整列替换时误删。
 */

export function rawPropertyPromoObject(rawProfile: unknown): Record<string, unknown> | null {
  if (rawProfile == null || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
    return null;
  }
  const pp = (rawProfile as Record<string, unknown>).property_promo;
  if (pp == null || typeof pp !== "object" || Array.isArray(pp)) {
    return null;
  }
  return { ...(pp as Record<string, unknown>) };
}

/** 不经过 parseMerchantProfile，直接取出已存的 trademe 图链（字符串数组）。 */
export function rawTrademeImageUrls(rawProfile: unknown): string[] | undefined {
  const promo = rawPropertyPromoObject(rawProfile);
  if (!promo) {
    return undefined;
  }
  const arr = promo.trademe_image_urls;
  if (!Array.isArray(arr)) {
    return undefined;
  }
  const out = arr.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}
