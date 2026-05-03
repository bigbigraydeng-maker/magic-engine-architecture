/**
 * 读库兼容：历史 TradeMe 图片 URL 的规范化（旧管线已移除，仍用于解析已存 JSON）。
 */

function tradeMeImageHostOk(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "trademe.co.nz" ||
    h.endsWith(".trademe.co.nz") ||
    h === "tmsandbox.co.nz" ||
    h.endsWith(".tmsandbox.co.nz") ||
    h.includes("trademe.co.nz") ||
    h.includes("tmsandbox.co.nz") ||
    h.includes("tmcdn") ||
    h.includes("images.trademe") ||
    h.includes("trademeproperty") ||
    h.includes("trademe-images")
  );
}

function normalizeTradeMeListingImageUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) {
    return null;
  }
  s = s.replace(/&amp;/gi, "&");

  if (s.startsWith("//")) {
    s = `https:${s}`;
  }

  if (s.startsWith("http://")) {
    try {
      const u = new URL(s);
      if (!tradeMeImageHostOk(u.hostname)) {
        return null;
      }
      u.protocol = "https:";
      s = u.toString();
    } catch {
      return null;
    }
  }

  if (!s.startsWith("https://")) {
    return null;
  }

  try {
    const u = new URL(s);
    if (!tradeMeImageHostOk(u.hostname)) {
      return null;
    }
    const p = u.pathname.toLowerCase();
    const h = u.hostname.toLowerCase();
    if (
      (h === "www.trademe.co.nz" || h === "trademe.co.nz") &&
      /^\/a\/(property|motors|jobs|services|community|onehub)\b/i.test(p)
    ) {
      return null;
    }
    if (s.length > 2000) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function looksLikeTradeMeImageRequest(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const p = u.pathname.toLowerCase();
  const hay = `${p}${u.search}`.toLowerCase();

  if (/\.(js|mjs|css|html|svg|json|map|woff2?)(\?|#|$)/i.test(p)) {
    return false;
  }
  if (
    (host === "www.trademe.co.nz" || host.endsWith(".trademe.co.nz")) &&
    /\/a\/(property|motors|jobs|services|community)/i.test(p)
  ) {
    return false;
  }

  if (tradeMeImageHostOk(host)) {
    return true;
  }

  return (
    /\.(jpe?g|png|webp|gif|bmp)(\?|#|$)/i.test(p) ||
    /\/images?\//i.test(p) ||
    /photo|thumbnail|gallery|resize|resized|picture|listingimage|listing-photo|tmphoto/i.test(hay)
  );
}

/** 读库时用：先严格规范化；再按路径/主机判断是否为图片请求（不要求 URL 里出现 .jpg）。 */
export function coercePersistedTradeMeImageUrl(raw: string): string | null {
  const strict = normalizeTradeMeListingImageUrl(raw);
  if (strict) {
    return strict;
  }

  let t = raw.trim().replace(/&amp;/gi, "&");
  if (t.startsWith("//")) {
    t = `https:${t}`;
  }
  if (t.startsWith("http://")) {
    try {
      const u = new URL(t);
      u.protocol = "https:";
      t = u.toString();
    } catch {
      return null;
    }
  }
  if (!t.startsWith("https://") || t.length > 2000) {
    return null;
  }

  try {
    const u = new URL(t);
    if (u.pathname.length < 2) {
      return null;
    }
    if (!looksLikeTradeMeImageRequest(u)) {
      return null;
    }
    return t;
  } catch {
    return null;
  }
}
