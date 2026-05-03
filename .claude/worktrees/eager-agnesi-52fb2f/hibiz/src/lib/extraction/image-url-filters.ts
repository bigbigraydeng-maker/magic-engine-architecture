/**
 * TradeMe 页 Markdown 里常混入站点 logo / UI 图，需过滤并优先保留房源照片 URL。
 */

const JUNK_SUBSTRINGS = [
  "/logo",
  "logo-2025",
  "tm-logo",
  "spotlight",
  "spotlight-202",
  "/brand",
  "favicon",
  "apple-touch",
  "/icons/",
  "/icon/",
  "sprite",
  "badge",
  "wordmark",
  "kiwi",
  "/images/common/",
  "nav-",
  "mascot",
  "illustration",
  "tmspark",
  "trust-badge",
  "empty-state",
  "onboarding",
];

function pathnameLower(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** 明显为站点品牌/UI，非房源图 */
export function isJunkListingImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u.startsWith("https://")) {
    return true;
  }
  const lower = u.toLowerCase();
  const path = pathnameLower(u);

  if (/\.(svg|ico)(\?|#|$)/i.test(path)) {
    return true;
  }

  for (const s of JUNK_SUBSTRINGS) {
    if (lower.includes(s)) {
      return true;
    }
  }

  // 主站 /images/ 下的品牌、导航、Kiwi 标（非房源图）
  if (/trademe\.co\.nz\/images\//i.test(lower) && /logo|spotlight|brand|nav|kiwi|wordmark|tm-logo|common\//i.test(lower)) {
    return true;
  }

  if (/www\.trademe\.co\.nz\/images\/[^/]*logo/i.test(lower)) {
    return true;
  }

  /** 主站 /images/ 下多为 UI、吉祥物、信任标，非房源相册（真图多在 tmcdn photoserver / images.trademe） */
  if (/^https:\/\/www\.trademe\.co\.nz\/images\//i.test(lower) && !/photoserver/i.test(lower)) {
    return true;
  }

  /** 房源/分类页 HTML 链接被误抓成「图」——不是图片直链，必须从列表剔除 */
  if (/\.trademe\.co\.nz\/a\/property/i.test(lower) || /\.tmsandbox\.co\.nz\/a\/property/i.test(lower)) {
    return true;
  }

  return false;
}

/** 分数越高越像房源图（启发式） */
export function scoreListingImageUrl(url: string): number {
  let score = 0;
  const lower = url.toLowerCase();

  if (/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(lower)) {
    score += 8;
  }

  /** 勿用裸子串 `image`：会匹配几乎所有路径里的 /images/，把站点吉祥物图误判成高分房源图 */
  if (
    /listing|gallery|photoserver|listingphoto|propertyimage|listingimage|property|resize|cdn|tmcdn|cloudfront|trademe-images|trademeproperty/i.test(
      lower,
    )
  ) {
    score += 12;
  }

  if (/tmcdn|images\.trademe|trademeproperty|photoserver|photo(?![a-z])/i.test(lower)) {
    score += 6;
  }

  if (/logo|spotlight|brand|favicon|wordmark|sprite|badge|kiwi|icon\/|icons\//i.test(lower)) {
    score -= 50;
  }

  if (/tmcdn|cloudfront|trademe-images|listingimage|propertyimage|gallery|resize|photoserver|listingphoto/i.test(lower)) {
    score += 15;
  }

  // 已通过 image-proxy 写入 Supabase 的房源图：路径不含 tmcdn 等关键词，原先会低于 minScore 被整页过滤掉
  if (/listing-images\//i.test(lower) || /\/object\/public\/listing-images\//i.test(lower)) {
    score += 55;
  }

  return score;
}

/**
 * 去噪、按分数排序、截断数量。
 * `minScore`：低于此分的 URL 丢弃，避免仅剩站点品牌图（分数往往仍 >0）被当成「房源图」。
 */
const FALLBACK_MIN_SCORE = 12;

export function filterAndRankListingImageUrls(urls: string[], max = 12, minScore = 18): string[] {
  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    const t = u.trim();
    if (!t || seen.has(t)) {
      return false;
    }
    if (isJunkListingImageUrl(t)) {
      return false;
    }
    seen.add(t);
    return true;
  });

  const ranked = unique.sort((a, b) => scoreListingImageUrl(b) - scoreListingImageUrl(a));
  const strict = ranked.filter((u) => scoreListingImageUrl(u) >= minScore).slice(0, max);
  if (strict.length > 0) {
    return strict;
  }
  /** 放宽时仍要求最低分，避免把站点装饰图（分数 ~8–12）当成房源主图 */
  const relaxed = ranked.filter((u) => scoreListingImageUrl(u) >= FALLBACK_MIN_SCORE).slice(0, max);
  if (relaxed.length > 0) {
    return relaxed;
  }
  return [];
}
