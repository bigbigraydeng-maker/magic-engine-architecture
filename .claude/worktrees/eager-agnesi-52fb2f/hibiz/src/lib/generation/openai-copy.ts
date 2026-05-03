import OpenAI from "openai";
import type { CompiledIntentV1 } from "@/types/compiled-intent";
import { SCENE_LABELS } from "@/lib/compiler/scene-labels";

export interface GeneratedCopyV1 {
  hero: {
    eyebrow: string | null;
    title: string;
    subtitle: string;
    subtitle_secondary?: string | null;
    primary_cta_label: string;
    secondary_cta_label: string | null;
  };
  offer: {
    heading: string;
    bullets: string[];
    footnote: string | null;
  };
  faq: {
    heading: string;
    items: { q: string; a: string }[];
  };
  about: {
    heading: string;
    body: string;
    badge: string | null;
  };
  contact: {
    heading: string;
    lines: string[];
    hours: string | null;
  };
  form_section: {
    heading: string;
    description: string | null;
    submit_label: string;
  };
  seo_title: string;
  seo_description: string;
}

function coerceString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function parseGeneratedCopy(raw: string): GeneratedCopyV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI JSON root must be an object");
  }
  const o = parsed as Record<string, unknown>;
  const hero = (o.hero ?? {}) as Record<string, unknown>;
  const offer = (o.offer ?? {}) as Record<string, unknown>;
  const faq = (o.faq ?? {}) as Record<string, unknown>;
  const about = (o.about ?? {}) as Record<string, unknown>;
  const contact = (o.contact ?? {}) as Record<string, unknown>;
  const form_section = (o.form_section ?? {}) as Record<string, unknown>;

  const bullets = Array.isArray(offer.bullets) ? offer.bullets.filter((b): b is string => typeof b === "string") : [];
  const itemsRaw = Array.isArray(faq.items) ? faq.items : [];
  const items = itemsRaw.map((it) => {
    const x = it as Record<string, unknown>;
    return {
      q: coerceString(x.q, ""),
      a: coerceString(x.a, ""),
    };
  });

  return {
    hero: {
      eyebrow: typeof hero.eyebrow === "string" ? hero.eyebrow : null,
      title: coerceString(hero.title, "Your business, online"),
      subtitle: coerceString(hero.subtitle, "Tell us how we can help."),
      subtitle_secondary: typeof hero.subtitle_secondary === "string" ? hero.subtitle_secondary : null,
      primary_cta_label: coerceString(hero.primary_cta_label, "Get in touch"),
      secondary_cta_label: typeof hero.secondary_cta_label === "string" ? hero.secondary_cta_label : null,
    },
    offer: {
      heading: coerceString(offer.heading, "Why choose us"),
      bullets: bullets.slice(0, 6),
      footnote: typeof offer.footnote === "string" ? offer.footnote : null,
    },
    faq: {
      heading: coerceString(faq.heading, "Common questions"),
      items: items.filter((i) => i.q && i.a).slice(0, 6),
    },
    about: {
      heading: coerceString(about.heading, "About"),
      body: coerceString(about.body, "We serve clients across New Zealand."),
      badge: typeof about.badge === "string" ? about.badge : null,
    },
    contact: {
      heading: coerceString(contact.heading, "Contact"),
      lines: Array.isArray(contact.lines)
        ? (contact.lines as unknown[]).filter((l): l is string => typeof l === "string")
        : ["Add your phone and email in the editor soon."],
      hours: typeof contact.hours === "string" ? contact.hours : businessHoursNz(),
    },
    form_section: {
      heading: coerceString(form_section.heading, "Request a callback"),
      description: typeof form_section.description === "string" ? form_section.description : null,
      submit_label: coerceString(form_section.submit_label, "Send"),
    },
    seo_title: coerceString(o.seo_title, "Landing page"),
    seo_description: coerceString(o.seo_description, "Contact us for more information."),
  };
}

function businessHoursNz(): string {
  return "Mon–Fri 9:00–17:00 NZST (example — replace with your hours)";
}

export async function generateCopyWithOpenAI(input: {
  rawPrompt: string;
  compiled: CompiledIntentV1;
  projectName: string;
}): Promise<GeneratedCopyV1> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const client = new OpenAI({
    apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });

  const sceneLabel = SCENE_LABELS[input.compiled.scene] ?? input.compiled.scene;
  const bilingual =
    input.compiled.language_mode === "en_bilingual_zh"
      ? "Also set hero.subtitle_secondary to one short line in Simplified Chinese (key info only)."
      : "Use English only.";

  const system = `You write concise, trustworthy marketing copy for small businesses in New Zealand.
Output a single JSON object only (no markdown). Tone: ${input.compiled.tone}.
Do not claim guaranteed outcomes (no "guaranteed visa", "definite price rise", etc.).
Keep hero title under 80 chars, subtitle under 200 chars.
FAQ: exactly 4 items unless impossible, practical NZ-oriented.
${bilingual}`;

  const user = `Project name: ${input.projectName}
User request: ${input.rawPrompt}
Compiled intent (trust these labels):
- industry: ${input.compiled.industry}
- page type: ${sceneLabel}
- city/region hint: ${input.compiled.city ?? "not specified"}
- goal: ${input.compiled.goal}

JSON shape (all keys required; use null where optional):
{
  "hero": {
    "eyebrow": string | null,
    "title": string,
    "subtitle": string,
    "subtitle_secondary": string | null,
    "primary_cta_label": string,
    "secondary_cta_label": string | null
  },
  "offer": { "heading": string, "bullets": string[], "footnote": string | null },
  "faq": { "heading": string, "items": [ { "q": string, "a": string } ] },
  "about": { "heading": string, "body": string, "badge": string | null },
  "contact": { "heading": string, "lines": string[], "hours": string | null },
  "form_section": { "heading": string, "description": string | null, "submit_label": string },
  "seo_title": string,
  "seo_description": string
}`;

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty response from OpenAI");
  }

  return parseGeneratedCopy(raw);
}
