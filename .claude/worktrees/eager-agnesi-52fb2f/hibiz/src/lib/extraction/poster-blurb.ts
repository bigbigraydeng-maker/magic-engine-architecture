import OpenAI from "openai";
import type { TradeMeListingData } from "@/lib/extraction/trademe-schema";

const SYSTEM = `You write real-estate POSTER body copy for a printed A4 flyer (not a web page).

Return a single JSON object with exactly two string keys:
- "blurb_zh": Simplified Chinese. 4–8 short lines (use line breaks or • bullets). Core facts: bedrooms, bathrooms, land, parking, key chattels, location/suburb, price style (auction / by negotiation / range) if present. NO URLs, NO "URL Source", NO pasted http links, NO metadata lines. Do not repeat the headline as the only line.
- "blurb_en": Same structure and facts in English.

Max 650 characters per field.

CRITICAL: If the Listing JSON has no usable facts (no title, no description body, no address, no bedroom/bathroom numbers, no price hint), you MUST return both blurb_zh and blurb_en as exactly "" (empty strings). Do NOT invent filler such as 待确认, 信息缺失, 请联系代理, or generic bullet lists — empty is correct.

If some facts exist, summarise only those facts — do not invent compliance claims (e.g. "guaranteed visa").`;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置。");
  }
  return new OpenAI({ apiKey });
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export interface PosterBlurbs {
  zh: string;
  en: string;
}

/**
 * 无足够事实时不调摘要模型，避免模型编造「待确认」「信息缺失请联系代理」等话术。
 * 例外：标题较长（多为真房源标题）时仍尝试结合 Markdown 生成摘要。
 */
function shouldSkipPosterBlurb(listing: TradeMeListingData): boolean {
  const title = listing.title.trim();
  const desc = listing.description.trim();
  const hasStructured =
    listing.bedrooms != null ||
    listing.bathrooms != null ||
    Boolean(listing.price_hint?.trim()) ||
    Boolean(listing.address?.trim());
  if (hasStructured) {
    return false;
  }
  if (desc.length >= 100) {
    return false;
  }
  if (title.length >= 22) {
    return false;
  }
  return true;
}

/**
 * 从 listing 结构化字段 + Markdown 节选生成中英海报正文（提炼要点，非全文照搬）。
 */
export async function generatePosterBlurbs(
  markdownExcerpt: string,
  listing: TradeMeListingData,
): Promise<PosterBlurbs> {
  if (shouldSkipPosterBlurb(listing)) {
    return { zh: "", en: "" };
  }

  const payload = {
    title: listing.title,
    description_excerpt: listing.description.slice(0, 8000),
    address: listing.address,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    price_hint: listing.price_hint,
    agent_name: listing.agent_name,
    agent_company: listing.agent_company,
  };

  const md = markdownExcerpt.trim();
  const userContent =
    md.length === 0
      ? "Listing JSON:\n" + JSON.stringify(payload, null, 2)
      : "Listing JSON:\n" +
        JSON.stringify(payload, null, 2) +
        "\n\nMarkdown excerpt (may contain noise; ignore site chrome and URLs):\n---\n" +
        markdownExcerpt.slice(0, 25_000);

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: getModel(),
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: userContent,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.25,
    max_tokens: 2000,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw?.trim()) {
    throw new Error("海报摘要：OpenAI 返回空内容。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("海报摘要：OpenAI 返回的不是合法 JSON。");
  }

  if (!parsed || typeof parsed !== "object") {
    return { zh: "", en: "" };
  }

  const o = parsed as Record<string, unknown>;
  const zh = typeof o.blurb_zh === "string" ? o.blurb_zh.trim().slice(0, 700) : "";
  const en = typeof o.blurb_en === "string" ? o.blurb_en.trim().slice(0, 700) : "";

  return { zh, en };
}
