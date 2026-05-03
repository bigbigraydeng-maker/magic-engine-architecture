/**
 * Unsplash API 客户端（仅服务端 / Server Actions 调用）
 *
 * 归属：摄影师姓名 + Unsplash 链接 + utm；选择图片时触发 download_location。
 */

const UNSPLASH_API = "https://api.unsplash.com";
const UTM = "utm_source=hibiz&utm_medium=referral";

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  user: {
    name: string;
    username: string;
    links: { html: string };
  };
  links: {
    download_location: string;
  };
}

export interface UnsplashSearchResult {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}

function getAccessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key?.trim()) {
    throw new Error("Missing UNSPLASH_ACCESS_KEY in environment");
  }
  return key.trim();
}

export async function searchUnsplashPhotos(
  query: string,
  options: { page?: number; perPage?: number; orientation?: "landscape" | "portrait" | "squarish" } = {},
): Promise<UnsplashSearchResult> {
  const { page = 1, perPage = 20, orientation } = options;

  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(perPage),
  });
  if (orientation) {
    params.set("orientation", orientation);
  }

  const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${getAccessKey()}` },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Unsplash API error: ${res.status}`);
  }

  return res.json() as Promise<UnsplashSearchResult>;
}

/** 触发下载统计（用户选择图片时调用）— 需要域名白名单校验（HIGH-1: SSRF 防护） */
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  // 校验 URL 格式和域名（SSRF 防护）
  const url = new URL(downloadLocation);
  if (url.protocol !== "https:") {
    throw new Error("Invalid download URL: must use HTTPS.");
  }
  if (url.hostname !== "api.unsplash.com") {
    throw new Error("Invalid download URL: must be api.unsplash.com.");
  }

  const res = await fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${getAccessKey()}` },
    signal: AbortSignal.timeout(8000), // 超时保护（LOW-2）
  });
  if (!res.ok) {
    throw new Error(`Unsplash download trigger failed: ${res.status}`);
  }
}

export function photographerUrl(username: string): string {
  return `https://unsplash.com/@${encodeURIComponent(username)}?${UTM}`;
}

export function unsplashAttributionUrl(): string {
  return `https://unsplash.com?${UTM}`;
}
