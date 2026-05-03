import OpenAI from "openai";
import { fetchMarkdownFromUrl } from "@/lib/extraction/jina-reader";
import { filterAndRankListingImageUrls, isJunkListingImageUrl } from "@/lib/extraction/image-url-filters";
import { parseTradeMeListingData, type TradeMeListingData } from "@/lib/extraction/trademe-schema";

const MAX_IMAGES = 12;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;

const SYSTEM_PROMPT = `You extract New Zealand TradeMe PROPERTY listing data from Markdown (from Jina Reader).

CRITICAL DISTINCTIONS:
- "title" MUST be the PROPERTY listing headline: address line, suburb, bedrooms + property type, or the main listing title shown for the HOME. It must NOT be the sales agent's personal name alone.
- If the page shows an agent name prominently but also a property address or listing title, use the property/address line as title.
- "description" is the FULL property listing body: features, land size, chattels, open home text — as plain text (no HTML). Use multiple paragraphs joined by newlines if needed. Never leave description empty if the Markdown contains listing body text.
- "agent_name" / "agent_company": the real estate agent salesperson and agency (e.g. Bayleys, Harcourts).
- "agent_phone": optional NZ phone string if visible (mobile or office).
- "agent_photo_url": optional. If the Markdown contains a clear https URL for the agent's profile photo (small headshot, not property photos), set it; otherwise null.

Other JSON keys (use null where unknown):
address (string|null), bedrooms (number|null), bathrooms (number|null), price_hint (string|null).

Never put Jina/metadata lines like "URL Source:" or bare listing URLs inside "description" — only prose about the property.

Do NOT include an "images" key — images are extracted separately from Markdown.

Return a single JSON object only.`;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置。");
  }
  return new OpenAI({ apiKey });
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function looksLikeHttpsImageUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (IMAGE_EXT_RE.test(parsed.pathname)) {
      return true;
    }
    if (/trademe|tmcdn|tmsandbox/i.test(parsed.hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function extractHttpsImageUrlsFromMarkdown(markdown: string): string[] {
  const found = new Set<string>();
  const md = markdown.replace(/\\\//g, "/");

  const patterns: RegExp[] = [
    /!\[[^\]]*]\((https:\/\/[^)\s]+)\)/g,
    /\(https:\/\/[^)\s]+\.(?:jpe?g|png|webp|gif)(?:\?[^)\s]*)?\)/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      const candidate = m[1] ?? m[0].replace(/^\(|\)$/g, "");
      const trimmed = candidate.trim();
      if (looksLikeHttpsImageUrl(trimmed) && !isJunkListingImageUrl(trimmed)) {
        found.add(trimmed);
      }
    }
  }

  const loose = /https:\/\/[a-zA-Z0-9./?&=_%-]+\.(?:jpe?g|png|webp|gif)(?:\?[^"'\s]*)?/gi;
  let lm: RegExpExecArray | null;
  loose.lastIndex = 0;
  while ((lm = loose.exec(md)) !== null) {
    const v = lm[0];
    if (v.length < 500 && looksLikeHttpsImageUrl(v) && !isJunkListingImageUrl(v)) {
      found.add(v);
    }
  }

  const cdnLoose =
    /https:\/\/[^"'\s<>\\]+(?:trademe\.co\.nz|tmsandbox\.co\.nz|tmcdn[^"'\s<>\\]*)[^"'\s<>\\]*/gi;
  cdnLoose.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = cdnLoose.exec(md)) !== null) {
    const v = cm[0].replace(/[,;)\]}>'"]+$/, "");
    if (v.length >= 24 && v.length < 500 && looksLikeHttpsImageUrl(v) && !isJunkListingImageUrl(v)) {
      found.add(v);
    }
  }

  return Array.from(found);
}

/** 去掉 Jina/元数据行与整行 URL，避免 description 只剩「URL Source: …」 */
export function sanitizeListingDescription(raw: string): string {
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^URL\s*Source:/i.test(t)) {
      continue;
    }
    if (/^source:\s*https?:\/\//i.test(t)) {
      continue;
    }
    if (/^https?:\/\/[^\s]+\s*$/i.test(t) && t.length < 500) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** LLM 未写出描述时，从 Markdown 正文取最长段落作回退 */
export function extractDescriptionFallbackFromMarkdown(markdown: string): string {
  const stripped = markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ");
  const chunks = stripped
    .split(/\n\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60 && !/^#{1,6}\s/.test(p));
  chunks.sort((a, b) => b.length - a.length);
  const best = chunks[0];
  return best ? best.slice(0, 3500) : "";
}

/** OpenAI 失败时：从 Markdown 取一行作标题兜底 */
export function extractTitleFallbackFromMarkdown(markdown: string): string {
  const md = markdown.replace(/^\uFEFF/, "").trim();
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1?.[1]) {
    const t = h1[1].trim();
    if (t.length >= 5 && t.length <= 200) {
      return t;
    }
  }
  const anyHeading = md.match(/^#{1,3}\s+(.+)$/m);
  if (anyHeading?.[1]) {
    const t = anyHeading[1].trim();
    if (t.length >= 5 && t.length <= 200) {
      return t;
    }
  }
  const line = md
    .split("\n")
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 8 &&
        l.length <= 200 &&
        !/^url\s*source:/i.test(l) &&
        !/^https?:\/\//i.test(l) &&
        !/^#{1,6}\s/.test(l),
    );
  return line ? line.slice(0, 200) : "";
}

function buildListingFromMarkdownFallback(markdown: string, images: string[]): TradeMeListingData {
  let description = sanitizeListingDescription(extractDescriptionFallbackFromMarkdown(markdown));
  if (!description) {
    description = sanitizeListingDescription(markdown.slice(0, 3500));
  }
  let title = extractTitleFallbackFromMarkdown(markdown).trim();
  if (!title && description.length > 24) {
    title = description.slice(0, 100).trim();
  }
  return {
    title,
    description,
    address: null,
    bedrooms: null,
    bathrooms: null,
    price_hint: null,
    images,
    agent_name: null,
    agent_company: null,
    agent_phone: null,
    agent_photo_url: null,
  };
}

function sanitizeAgentPhotoUrl(raw: string | null): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const u = raw.trim();
  if (!u.startsWith("https://")) {
    return null;
  }
  if (isJunkListingImageUrl(u)) {
    return null;
  }
  if (/\.(svg|ico)(\?|#|$)/i.test(u)) {
    return null;
  }
  return u.length <= 2000 ? u : null;
}

async function extractListingJsonFromMarkdown(markdown: string): Promise<unknown> {
  const client = getOpenAIClient();
  const model = getModel();

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Extract the property listing fields from this Markdown.\n\n---\n\n" +
          markdown.slice(0, 120_000),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.15,
    max_tokens: 4096,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw?.trim()) {
    throw new Error("OpenAI 返回空内容。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("OpenAI 返回的不是合法 JSON。");
  }

  return parsed;
}

/** 本次抓取实际走通的管线（用于导入成功页展示，便于排查空字段） */
export type TradeMeExtractLayer = "trademe_api" | "next_data" | "jina_openai";

export interface ExtractTradeMeListingResult {
  listing: TradeMeListingData;
  /** 原始 Markdown，供海报摘要等二次 LLM 使用（非 Jina 管线可为空串） */
  markdown: string;
  extractLayer: TradeMeExtractLayer;
}

/**
 * TradeMe 房源：Jina Reader → Markdown → OpenAI JSON 提取 → 校验；图片 URL 从 Markdown 解析、过滤 logo 噪声后排序。
 */
export async function extractTradeMeListing(url: string): Promise<ExtractTradeMeListingResult> {
  const markdown = await fetchMarkdownFromUrl(url);
  const rawUrls = extractHttpsImageUrlsFromMarkdown(markdown);
  const images = filterAndRankListingImageUrls(rawUrls, MAX_IMAGES);

  let parsed: TradeMeListingData;
  try {
    const rawListing = await extractListingJsonFromMarkdown(markdown);
    parsed = parseTradeMeListingData(rawListing);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[extractTradeMeListing] LLM JSON extract failed:", msg);
    if (markdown.trim().length < 120) {
      throw e instanceof Error ? e : new Error(msg);
    }
    return {
      listing: buildListingFromMarkdownFallback(markdown, images),
      markdown,
      extractLayer: "jina_openai",
    };
  }

  let description = sanitizeListingDescription(parsed.description.trim());
  if (!description) {
    description = sanitizeListingDescription(extractDescriptionFallbackFromMarkdown(markdown));
  }

  let title = parsed.title.trim();
  if (!title && parsed.address?.trim()) {
    title = parsed.address.trim();
  }

  const agent_photo_url = sanitizeAgentPhotoUrl(parsed.agent_photo_url);

  const listing: TradeMeListingData = {
    ...parsed,
    title,
    description,
    images,
    agent_photo_url,
  };

  return { listing, markdown, extractLayer: "jina_openai" };
}
