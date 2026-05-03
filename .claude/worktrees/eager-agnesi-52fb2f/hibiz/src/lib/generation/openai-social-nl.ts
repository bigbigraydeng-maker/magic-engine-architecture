import OpenAI from "openai";
import { parseSocialCaptionsFromJson } from "@/lib/generation/openai-social-copy";
import { validateImageUpload } from "@/lib/upload/validate-image";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { SocialCaptionsV1 } from "@/types/social-content";

const MAX_USER_PROMPT = 4000;
const MAX_TEXT_CHARS = 24_000;
const MAX_IMAGES = 6;
const MAX_FILES = 12;

function profileSummary(profile: MerchantProfileV1, projectName: string): string {
  const lines = [
    `Project / brand: ${projectName}`,
    profile.display_name ? `Agent name: ${profile.display_name}` : "",
    profile.company_name ? `Company: ${profile.company_name}` : "",
    profile.contact?.phone ? `Phone: ${profile.contact.phone}` : "",
    profile.contact?.email ? `Email: ${profile.contact.email}` : "",
    profile.bio_en ? `Bio (EN): ${profile.bio_en.slice(0, 400)}` : "",
    profile.bio_zh ? `Bio (ZH): ${profile.bio_zh.slice(0, 400)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function isProbablyTextFile(file: File): boolean {
  const t = file.type.toLowerCase();
  if (t === "text/plain" || t === "text/markdown" || t === "application/json") {
    return true;
  }
  const n = file.name.toLowerCase();
  return n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".json");
}

async function readTextFileSlice(file: File, budget: { remaining: number }): Promise<string | null> {
  if (file.size > 512 * 1024) {
    return `[Skipped ${file.name}: text file too large (max 512KB)]`;
  }
  const buf = await file.arrayBuffer();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const take = text.slice(0, Math.min(budget.remaining, MAX_TEXT_CHARS));
  budget.remaining -= take.length;
  return `--- File: ${file.name} ---\n${take}`;
}

export async function generateNlSocialCopy(input: {
  userPrompt: string;
  profile: MerchantProfileV1;
  projectName: string;
  files: File[];
}): Promise<SocialCaptionsV1> {
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

  const prompt = input.userPrompt.trim().slice(0, MAX_USER_PROMPT);
  if (prompt.length < 3) {
    throw new Error("Prompt too short");
  }

  const userFiles = input.files.slice(0, MAX_FILES);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

  const textBudget = { remaining: MAX_TEXT_CHARS };
  let imageCount = 0;

  for (const file of userFiles) {
    if (file.size <= 0) {
      continue;
    }
    if (isProbablyTextFile(file)) {
      const block = await readTextFileSlice(file, textBudget);
      if (block) {
        content.push({ type: "text", text: block });
      }
      continue;
    }

    if (imageCount >= MAX_IMAGES) {
      content.push({
        type: "text",
        text: `[Skipped image ${file.name}: max ${MAX_IMAGES} images per request]`,
      });
      continue;
    }

    const validated = await validateImageUpload(file, 6 * 1024 * 1024);
    if (!validated) {
      content.push({
        type: "text",
        text: `[Skipped ${file.name}: not a valid JPEG/PNG/WebP image]`,
      });
      continue;
    }

    const b64 = validated.buffer.toString("base64");
    const dataUrl = `data:${validated.mime};base64,${b64}`;
    content.push({
      type: "image_url",
      image_url: { url: dataUrl, detail: "auto" },
    });
    imageCount += 1;
  }

  const header = `User instructions (natural language):\n${prompt}\n\nBusiness context (may be sparse):\n${profileSummary(input.profile, input.projectName)}\n\nProduce social copy for Australia/New Zealand small businesses where relevant; stay compliant (no misleading guarantees, no exaggerated immigration/property outcomes).`;

  const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: header },
    ...content,
    {
      type: "text",
      text: `Return a single JSON object only (no markdown). Include:
1) "platforms" with facebook, instagram, linkedin, xiaohongshu — each { "en": string, "zh": string }.
2) "image_plan": { "zh": string, "en": string } with concise bullet-style guidance on which uploaded image to use as cover, carousel order for Instagram, and any text-only post notes. If no images were provided, suggest composition ideas only (do not invent photos). Keep each language under 2000 characters.

Hard character limits per language string (approximate):
- facebook: 500
- instagram: 2200
- linkedin: 3000
- xiaohongshu: 1000`,
    },
  ];

  const system = `You write social media marketing copy for AU/NZ and Chinese-audience platforms.
Output JSON only. Tone: professional, warm, compliant. Provide BOTH English (en) and Simplified Chinese (zh) for every platform field.
小红书 zh copy should read natural for 新西兰/澳洲华人读者.`;

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userParts },
    ],
    temperature: 0.7,
    max_tokens: 4500,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty response from OpenAI");
  }

  return parseSocialCaptionsFromJson(raw);
}
