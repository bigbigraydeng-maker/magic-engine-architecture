/**
 * 从 TradeMe 房源 HTML 中的 __NEXT_DATA__ 解析结构化数据（零 LLM）。
 * 页面结构可能变更，解析失败时返回 null，由 Jina + LLM 降级。
 */

import { filterAndRankListingImageUrls, isJunkListingImageUrl } from "@/lib/extraction/image-url-filters";
import type { TradeMeListingData } from "@/lib/extraction/trademe-schema";

const NEXT_DATA_RE = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const FETCH_TIMEOUT_MS = 15_000;

const TRADEME_HOST = /\.trademe\.co\.nz$/i;
const SANDBOX_HOST = /\.tmsandbox\.co\.nz$/i;

function hostAllowed(hostname: string): boolean {
  return TRADEME_HOST.test(hostname) || SANDBOX_HOST.test(hostname);
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return "";
}

function numOrNull(v: unknown): number | null {
  if (v == null) {
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function scoreListingCandidate(o: Record<string, unknown>): number {
  let s = 0;
  if (typeof o.ListingId === "number" || typeof o.ListingId === "string") {
    s += 25;
  }
  if (typeof o.listingId === "number" || typeof o.listingId === "string") {
    s += 20;
  }
  const t = pickStr(o.Title, o.title, o.DisplayTitle);
  if (t.length > 8) {
    s += 25;
  }
  const body = pickStr(o.Body, o.Description, o.AdditionalDetails, o.Summary, o.Subtitle);
  if (body.length > 40) {
    s += 20;
  }
  if (Array.isArray(o.Photos) && o.Photos.length > 0) {
    s += 15;
  }
  if (Array.isArray(o.PhotoUrls) && o.PhotoUrls.length > 0) {
    s += 15;
  }
  if (o.Property !== null && typeof o.Property === "object") {
    s += 10;
  }
  return s;
}

function findBestListingNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 40 || node == null) {
    return null;
  }
  if (typeof node !== "object") {
    return null;
  }
  const nextDepth = depth + 1;
  if (Array.isArray(node)) {
    let best: Record<string, unknown> | null = null;
    let bestScore = 0;
    for (const item of node) {
      const f = findBestListingNode(item, nextDepth);
      if (f) {
        const sc = scoreListingCandidate(f);
        if (sc > bestScore) {
          bestScore = sc;
          best = f;
        }
      }
    }
    return best;
  }

  const o = node as Record<string, unknown>;
  const selfScore = scoreListingCandidate(o);
  let best: Record<string, unknown> | null = selfScore >= 45 ? o : null;
  let bestScore = selfScore;

  for (const k of Object.keys(o)) {
    const child = findBestListingNode(o[k], nextDepth);
    if (child) {
      const sc = scoreListingCandidate(child);
      if (sc > bestScore) {
        bestScore = sc;
        best = child;
      }
    }
  }

  return best;
}

function collectHttpsImageUrls(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 25 || v == null) {
    return;
  }
  if (typeof v === "string" && v.startsWith("https://") && v.length < 2500) {
    if (!isJunkListingImageUrl(v) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(v)) {
      out.add(v);
    }
    return;
  }
  if (typeof v !== "object") {
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      collectHttpsImageUrls(item, out, depth + 1);
    }
    return;
  }
  const o = v as Record<string, unknown>;
  const urlKeys = [
    "Url",
    "url",
    "FullUrl",
    "fullUrl",
    "UrlLarge",
    "UrlMedium",
    "UrlSmall",
    "ImageUrl",
    "Src",
    "src",
  ];
  for (const key of urlKeys) {
    if (key in o) {
      collectHttpsImageUrls(o[key], out, depth + 1);
    }
  }
  for (const k of Object.keys(o)) {
    if (!urlKeys.includes(k)) {
      collectHttpsImageUrls(o[k], out, depth + 1);
    }
  }
}

function extractImagesFromPayload(payload: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const directArrays = [payload.Photos, payload.PhotoUrls, payload.Images, payload.Gallery, payload.photos];
  for (const arr of directArrays) {
    collectHttpsImageUrls(arr, found);
  }
  collectHttpsImageUrls(payload, found);
  return filterAndRankListingImageUrls(Array.from(found), 24);
}

function mapPayloadToListing(payload: Record<string, unknown>): TradeMeListingData {
  const prop =
    payload.Property && typeof payload.Property === "object"
      ? (payload.Property as Record<string, unknown>)
      : null;

  const title = pickStr(payload.Title, payload.title, payload.DisplayTitle);
  const description = pickStr(
    payload.Body,
    payload.Description,
    payload.AdditionalDetails,
    payload.Summary,
    prop ? pickStr(prop.Description, prop.Summary) : "",
  );

  const address = pickStr(
    payload.FullAddress,
    payload.Address,
    payload.address,
    prop ? pickStr(prop.Address, prop.FullAddress) : "",
  );

  const bedrooms = numOrNull(
    payload.Bedrooms ?? payload.bedrooms ?? prop?.Bedrooms ?? prop?.bedrooms,
  );
  const bathrooms = numOrNull(
    payload.Bathrooms ?? payload.bathrooms ?? prop?.Bathrooms ?? prop?.bathrooms,
  );

  const startPriceStr = (() => {
    const sp = payload.StartPrice;
    if (typeof sp === "string") {
      return sp.trim();
    }
    if (sp && typeof sp === "object") {
      const o = sp as Record<string, unknown>;
      return pickStr(o.DisplayPrice, o.Display, o.FormattedAmount, o.Amount);
    }
    return "";
  })();

  const price_hint =
    pickStr(
      payload.PriceDisplay,
      payload.Price,
      payload.CurrentPrice,
      payload.RentPerWeek,
      payload.WeeklyRent,
      payload.FormattedPrice,
      payload.DisplayPrice,
      payload.priceDisplay,
      payload.Auction,
      startPriceStr,
      prop
        ? pickStr(
            prop.PriceDisplay,
            prop.RentPerWeek,
            prop.WeeklyRent,
            prop.CurrentRent,
            prop.FormattedPrice,
          )
        : "",
    ) || null;

  const agentBlock =
    payload.Agent && typeof payload.Agent === "object"
      ? (payload.Agent as Record<string, unknown>)
      : payload.Members && Array.isArray(payload.Members) && payload.Members[0]
        ? (payload.Members[0] as Record<string, unknown>)
        : null;

  const agent_name = agentBlock ? pickStr(agentBlock.Name, agentBlock.name, agentBlock.FullName) || null : null;
  const agent_company = agentBlock
    ? pickStr(agentBlock.Agency, agentBlock.Company, agentBlock.company, agentBlock.BrandName) || null
    : null;
  const agent_phone = agentBlock
    ? pickStr(agentBlock.MobilePhone, agentBlock.PhoneNumber, agentBlock.phone) || null
    : null;
  const rawPhoto = agentBlock
    ? pickStr(agentBlock.Photo, agentBlock.PhotoUrl, agentBlock.ProfilePhotoUrl, agentBlock.ImageUrl)
    : "";
  const agent_photo_url =
    rawPhoto.startsWith("https://") && !isJunkListingImageUrl(rawPhoto) ? rawPhoto : null;

  const images = extractImagesFromPayload(payload);

  return {
    title,
    description,
    address: address || null,
    bedrooms,
    bathrooms,
    price_hint,
    images,
    agent_name,
    agent_company,
    agent_phone,
    agent_photo_url,
  };
}

/**
 * 直接 fetch 房源页并解析 `__NEXT_DATA__` → TradeMeListingData；失败返回 null。
 */
export async function extractFromNextData(url: string): Promise<TradeMeListingData | null> {
  const trimmed = url.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return null;
  }
  if (!hostAllowed(parsedUrl.hostname)) {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(trimmed, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn("[extractFromNextData] fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }

  if (!res.ok) {
    console.warn("[extractFromNextData] HTTP", res.status);
    return null;
  }

  const html = await res.text();
  const m = html.match(NEXT_DATA_RE);
  if (!m?.[1]) {
    console.warn("[extractFromNextData] no __NEXT_DATA__ script tag");
    return null;
  }

  let root: unknown;
  try {
    root = JSON.parse(m[1]) as unknown;
  } catch {
    console.warn("[extractFromNextData] JSON.parse __NEXT_DATA__ failed");
    return null;
  }

  const props =
    root && typeof root === "object" && "props" in (root as object)
      ? (root as { props?: unknown }).props
      : null;
  const pageProps =
    props && typeof props === "object" && "pageProps" in (props as object)
      ? (props as { pageProps?: unknown }).pageProps
      : null;

  const searchRoots: unknown[] = [pageProps, props, root].filter(Boolean);
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const r of searchRoots) {
    const node = findBestListingNode(r);
    if (node) {
      const sc = scoreListingCandidate(node);
      if (sc > bestScore) {
        bestScore = sc;
        best = node;
      }
    }
  }

  if (!best) {
    console.warn("[extractFromNextData] no listing candidate node");
    return null;
  }

  let listing = mapPayloadToListing(best);
  const images = filterAndRankListingImageUrls(listing.images, 12);
  listing = { ...listing, images };

  const signals = countListingSignals(listing);
  if (bestScore < 20 && signals < 1) {
    console.warn("[extractFromNextData] bestScore too low and no signals:", bestScore);
    return null;
  }
  if (signals < 1) {
    console.warn("[extractFromNextData] mapped listing has no usable fields, bestScore=", bestScore);
    return null;
  }
  if (signals < 2 && bestScore < 30) {
    console.warn("[extractFromNextData] weak mapping, bestScore=", bestScore, "signals=", signals);
    return null;
  }

  return listing;
}

function countListingSignals(listing: TradeMeListingData): number {
  let n = 0;
  if (listing.title.trim().length >= 5) {
    n++;
  }
  if (listing.description.trim().length >= 30) {
    n++;
  }
  if (listing.images.length > 0) {
    n++;
  }
  if ((listing.address?.trim().length ?? 0) >= 5) {
    n++;
  }
  if ((listing.price_hint?.trim().length ?? 0) >= 3) {
    n++;
  }
  return n;
}
