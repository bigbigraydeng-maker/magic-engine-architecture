const JINA_READER_BASE = "https://r.jina.ai/";
const FETCH_TIMEOUT_MS = 60_000;

const TRADEME_HOST = /\.trademe\.co\.nz$/i;
const SANDBOX_HOST = /\.tmsandbox\.co\.nz$/i;

function isAllowedTradeMeHost(hostname: string): boolean {
  return TRADEME_HOST.test(hostname) || SANDBOX_HOST.test(hostname);
}

function buildJinaReaderUrl(targetUrl: string): string {
  return `${JINA_READER_BASE}${encodeURIComponent(targetUrl)}`;
}

/**
 * 通过 Jina Reader 将页面转为 Markdown（GET r.jina.ai/{encodedUrl}）。
 * 若 JINA_API_KEY 已配置，启用 Pro 功能（JS 渲染等待、更长超时）。
 */
export async function fetchMarkdownFromUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("URL 不能为空。");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("URL 格式不正确。");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("仅支持 http(s) 链接。");
  }

  if (!isAllowedTradeMeHost(parsed.hostname)) {
    throw new Error("仅允许 trademe.co.nz 或 tmsandbox.co.nz 域名。");
  }

  const headers: Record<string, string> = {
    Accept: "text/markdown",
  };

  const jinaKey = process.env.JINA_API_KEY?.trim();
  if (jinaKey) {
    headers["Authorization"] = `Bearer ${jinaKey}`;
    // 等待 gallery / listing 正文 DOM 加载完毕再抓取
    headers["X-Wait-For-Selector"] = ".tm-property-listing-body, .gallery, .listing__photo, [data-testid=\"gallery\"], .o-carousel";
    headers["X-Timeout"] = "45";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(buildJinaReaderUrl(trimmed), {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Jina Reader 请求失败（HTTP ${res.status}）。`);
    }

    const text = await res.text();
    if (!text.trim()) {
      throw new Error("Jina Reader 返回空内容。");
    }

    return text;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Jina Reader 请求超时（${FETCH_TIMEOUT_MS / 1000} 秒）。`);
    }
    if (e instanceof Error && e.message.startsWith("Jina Reader")) {
      throw e;
    }
    if (e instanceof Error && e.message.startsWith("仅允许")) {
      throw e;
    }
    if (e instanceof Error && e.message.startsWith("URL")) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Jina Reader 请求失败：${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
