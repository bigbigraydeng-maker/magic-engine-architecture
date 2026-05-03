/**
 * TradeMe 官方 API 集成（OAuth 1.0a，两脚模式：仅 consumer credentials）。
 * 环境变量：TRADEME_CONSUMER_KEY / TRADEME_CONSUMER_SECRET
 * API 文档：https://developer.trademe.co.nz
 */

import { createHmac, randomBytes } from "node:crypto";
import { isJunkListingImageUrl } from "@/lib/extraction/image-url-filters";
import type { TradeMeListingData } from "@/lib/extraction/trademe-schema";

const PROD_API = "https://api.trademe.co.nz/v1";
const SANDBOX_API = "https://api.tmsandbox.co.nz/v1";
const FETCH_TIMEOUT_MS = 15_000;

function getCredentials(): { key: string; secret: string } | null {
  const key = process.env.TRADEME_CONSUMER_KEY?.trim();
  const secret = process.env.TRADEME_CONSUMER_SECRET?.trim();
  if (!key || !secret) {
    return null;
  }
  return { key, secret };
}

function apiBaseForHost(hostname: string): string {
  if (/tmsandbox\.co\.nz$/i.test(hostname)) {
    return SANDBOX_API;
  }
  return PROD_API;
}

/**
 * 从 TradeMe listing URL 提取 listing ID（纯数字部分）。
 * 支持旧式 `/listing/123` 与房产页 `/property/.../.../351234567` 等路径。
 */
export function extractListingId(url: string): string | null {
  const legacy = url.match(/\/listing\/(\d{5,15})\b/i);
  if (legacy?.[1]) {
    return legacy[1];
  }

  const saleTail = url.match(
    /\/property\/[^/]+\/[^/]+\/[^/]+(?:\/[^/]+)*\/(\d{7,12})(?:\?|#|$|\/)/i,
  );
  if (saleTail?.[1]) {
    return saleTail[1];
  }

  try {
    const segs = new URL(url.trim()).pathname.split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= Math.max(0, segs.length - 4); i--) {
      const raw = segs[i].split("?")[0];
      if (/^\d{7,12}$/.test(raw)) {
        return raw;
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = new URLSearchParams({
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
  });

  oauthParams.sort();
  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(oauthParams.toString())}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  return [
    `OAuth oauth_consumer_key="${consumerKey}"`,
    `oauth_nonce="${nonce}"`,
    `oauth_signature="${encodeURIComponent(signature)}"`,
    `oauth_signature_method="HMAC-SHA1"`,
    `oauth_timestamp="${timestamp}"`,
    `oauth_version="1.0"`,
  ].join(", ");
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
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  return null;
}

function collectPhotos(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  const photos = data.Photos ?? data.PhotoUrls;
  if (Array.isArray(photos)) {
    for (const p of photos) {
      if (typeof p === "string" && p.startsWith("https://")) {
        urls.push(p);
      } else if (p && typeof p === "object") {
        const obj = p as Record<string, unknown>;
        const valueObj =
          obj.Value && typeof obj.Value === "object"
            ? (obj.Value as Record<string, unknown>)
            : undefined;
        const u = pickStr(
          valueObj?.FullSize,
          obj.FullSize,
          valueObj?.Large,
          obj.Large,
          valueObj?.Medium,
          obj.Medium,
          obj.Url,
          obj.url,
        );
        if (u.startsWith("https://")) {
          urls.push(u);
        }
      }
    }
  }

  // PictureHref 单张主图
  const hero = pickStr(data.PictureHref as string);
  if (hero.startsWith("https://") && !urls.includes(hero)) {
    urls.unshift(hero);
  }

  return urls.filter((u) => !isJunkListingImageUrl(u)).slice(0, 24);
}

function priceDisplayFromStartPrice(v: unknown): string {
  if (v == null) {
    return "";
  }
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return pickStr(o.DisplayPrice, o.Display, o.Amount, o.FormattedAmount);
  }
  return "";
}

function mapApiResponseToListing(data: Record<string, unknown>): TradeMeListingData {
  const title = pickStr(data.Title as string, data.Subtitle as string);
  const description = pickStr(data.Body as string);
  const address = pickStr(data.Address as string, data.Region as string);

  const bedrooms = numOrNull(data.Bedrooms);
  const bathrooms = numOrNull(data.Bathrooms);
  const price_hint =
    pickStr(
      data.PriceDisplay as string,
      data.RentPerWeek as string,
      data.WeeklyRent as string,
      data.FormattedPrice as string,
      priceDisplayFromStartPrice(data.StartPrice),
    ) || null;

  // Agent info
  const member = data.Member as Record<string, unknown> | undefined;
  const agent_name = member ? pickStr(member.Nickname as string, member.FirstName as string) || null : null;

  const agency = data.Agency as Record<string, unknown> | undefined;
  const agent_company = agency ? pickStr(agency.Name as string) || null : null;

  const agents = agency?.Agents;
  let agent_phone: string | null = null;
  let agent_photo_url: string | null = null;
  if (Array.isArray(agents) && agents.length > 0) {
    const a = agents[0] as Record<string, unknown>;
    agent_phone = pickStr(a.MobilePhoneNumber as string, a.PhoneNumber as string) || null;
    const photo = pickStr(a.Photo as string, a.FullPhoto as string);
    agent_photo_url = photo.startsWith("https://") && !isJunkListingImageUrl(photo) ? photo : null;
  }

  const images = collectPhotos(data);

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
 * 通过 TradeMe 官方 API 获取房源数据。
 * 返回 null 表示凭证未配置、listing 不存在或请求失败（调用者应 fallback）。
 */
export async function fetchListingFromApi(listingUrl: string): Promise<TradeMeListingData | null> {
  const creds = getCredentials();
  if (!creds) {
    return null;
  }

  const listingId = extractListingId(listingUrl);
  if (!listingId) {
    console.warn("[trademe-api] cannot extract listing ID from URL:", listingUrl);
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(listingUrl);
  } catch {
    return null;
  }

  const base = apiBaseForHost(parsed.hostname);
  const apiUrl = `${base}/Listings/${listingId}.json`;
  const authHeader = buildOAuthHeader("GET", apiUrl, creds.key, creds.secret);

  try {
    const res = await fetch(apiUrl, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[trademe-api] HTTP", res.status, body.slice(0, 300));
      return null;
    }

    const json = (await res.json()) as Record<string, unknown>;

    if (json.Error || json.ErrorDescription) {
      console.warn("[trademe-api] API error:", json.ErrorDescription ?? json.Error);
      return null;
    }

    return mapApiResponseToListing(json);
  } catch (e) {
    console.warn("[trademe-api] fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
