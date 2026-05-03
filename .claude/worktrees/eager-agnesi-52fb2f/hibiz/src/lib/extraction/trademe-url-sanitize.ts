/**
 * 清理用户粘贴的 TradeMe 链接：常见误拼「两条 URL 粘在一起」、缺域名等。
 */

const TRADEME_HOST = /^(?:www\.)?(?:trademe\.co\.nz|tmsandbox\.co\.nz)$/i;

/** `/a/.../listing/1234567890`；若后接 `.co.nz/...`（第二条链接误粘）则只保留第一条 */
const A_LISTING_RE =
  /(https:\/\/(?:www\.)?(?:trademe\.co\.nz|tmsandbox\.co\.nz)\/a\/[^?\s#]+?\/listing\/\d{6,15})(?=\.|$|https|[\s#]|\?)/i;

/** 旧式 `/listing/123` */
const LEGACY_LISTING_RE =
  /(https:\/\/(?:www\.)?(?:trademe\.co\.nz|tmsandbox\.co\.nz)\/listing\/\d{6,15})(?=\.|$|https|[\s#]|\?)/i;

function firstValidTrademeUrl(candidate: string): string | null {
  const t = candidate.trim();
  if (!t.startsWith("https://")) {
    return null;
  }
  try {
    const u = new URL(t);
    if (!TRADEME_HOST.test(u.hostname)) {
      return null;
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * 从粘贴文本中提取可用的 TradeMe 房源 URL（单条）。
 * 若无法识别则返回去空白后的原文（由上层校验 / 报错）。
 */
export function sanitizePastedTradeMeUrl(raw: string): string {
  let s = raw.trim().replace(/\s+/g, "");
  if (!s) {
    return s;
  }

  s = s.replace(/https:\/\/www\.trademehttps:\/\/www\.trademe\.co\.nz/gi, "https://www.trademe.co.nz");
  s = s.replace(/https:\/\/www\.trademehttps:\/\/www\.tmsandbox\.co\.nz/gi, "https://www.tmsandbox.co.nz");
  s = s.replace(/https:\/\/www\.trademe\.co\.nzhttps:\/\/www\.trademe\.co\.nz/gi, "https://www.trademe.co.nz");
  s = s.replace(/https:\/\/www\.tmsandbox\.co\.nzhttps:\/\/www\.tmsandbox\.co\.nz/gi, "https://www.tmsandbox.co.nz");

  const aMatch = s.match(A_LISTING_RE);
  if (aMatch?.[1]) {
    return aMatch[1];
  }

  const leg = s.match(LEGACY_LISTING_RE);
  if (leg?.[1]) {
    return leg[1];
  }

  const loose = s.match(/https:\/\/(?:www\.)?(?:trademe\.co\.nz|tmsandbox\.co\.nz)\/[^\s#]+/i);
  if (loose?.[0]) {
    let u = loose[0];
    u = u.replace(/(\d{6,15})\.co\.nz\/.*$/i, "$1");
    const fixed = firstValidTrademeUrl(u);
    if (fixed) {
      return fixed;
    }
  }

  return s;
}
