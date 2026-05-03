/**
 * LLM Compiler V2 — 混合编译器的 LLM 层（Rule Guard 之后）。
 * 依赖 OPENAI_API_KEY；模型默认 gpt-4o-mini（可用 OPENAI_MODEL 覆盖）。
 */

import OpenAI from "openai";
import type {
  CompiledIntentV2,
  GoalV2,
  ImmigrationSceneV2,
  IndustryV2,
  LanguageV2,
  PageTypeV2,
  RealEstateSceneV2,
  SceneV2,
  ToneV2,
} from "@/types/compiled-intent-v2";
import type { RuleGuardResult } from "@/types/rule-guard";

const REAL_ESTATE_SCENES: readonly RealEstateSceneV2[] = [
  "property_listing",
  "open_home_event",
  "market_update",
];

const IMMIGRATION_SCENES: readonly ImmigrationSceneV2[] = [
  "visa_consultation",
  "school_info",
  "program_enrollment",
];

function isIndustryV2(v: unknown): v is IndustryV2 {
  return v === "real_estate" || v === "immigration";
}

function isLanguageV2(v: unknown): v is LanguageV2 {
  return v === "en" || v === "zh" || v === "both";
}

function isPageTypeV2(v: unknown): v is PageTypeV2 {
  return v === "landing" || v === "showcase" || v === "form" || v === "multi_section";
}

function isToneV2(v: unknown): v is ToneV2 {
  return v === "professional" || v === "friendly" || v === "urgent";
}

function isGoalV2(v: unknown): v is GoalV2 {
  return (
    v === "lead_generation" ||
    v === "info_display" ||
    v === "event_registration" ||
    v === "consultation_booking"
  );
}

function coerceIndustry(parsed: Record<string, unknown>, guard: RuleGuardResult): IndustryV2 {
  const v = parsed.industry;
  if (isIndustryV2(v)) {
    return v;
  }
  if (guard.industry_hint) {
    return guard.industry_hint;
  }
  return "real_estate";
}

function coerceScene(industry: IndustryV2, sceneRaw: unknown): SceneV2 {
  const s = typeof sceneRaw === "string" ? sceneRaw.trim() : "";
  if (industry === "real_estate") {
    if ((REAL_ESTATE_SCENES as readonly string[]).includes(s)) {
      return s as RealEstateSceneV2;
    }
    if (s.includes("open") || s.includes("home") || s.includes("看房")) {
      return "open_home_event";
    }
    if (s.includes("market") || s.includes("周报")) {
      return "market_update";
    }
    return "property_listing";
  }
  if ((IMMIGRATION_SCENES as readonly string[]).includes(s)) {
    return s as ImmigrationSceneV2;
  }
  if (s.includes("school") || s.includes("学校") || s.includes("课程")) {
    return "school_info";
  }
  if (s.includes("program") || s.includes("enrol") || s.includes("申请")) {
    return "program_enrollment";
  }
  return "visa_consultation";
}

function coerceLanguage(parsed: Record<string, unknown>, guard: RuleGuardResult): LanguageV2 {
  const v = parsed.language;
  if (isLanguageV2(v)) {
    return v;
  }
  if (guard.language_hint && isLanguageV2(guard.language_hint)) {
    return guard.language_hint;
  }
  return "en";
}

function newIntentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `intent_${c.randomUUID()}`;
  }
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 将 LLM 返回的 JSON 规范为 {@link CompiledIntentV2}（含枚举回退，不调用网络）。
 */
export function buildCompiledIntentV2FromLlmJson(
  parsed: unknown,
  ruleGuardResult: RuleGuardResult,
): CompiledIntentV2 {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM output must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  const industry = coerceIndustry(o, ruleGuardResult);
  const scene = coerceScene(industry, o.scene);
  const language = coerceLanguage(o, ruleGuardResult);

  const page_type = isPageTypeV2(o.page_type) ? o.page_type : undefined;
  const tone = isToneV2(o.tone) ? o.tone : undefined;
  const goal = isGoalV2(o.goal) ? o.goal : undefined;
  const description = typeof o.description === "string" ? o.description.trim().slice(0, 2000) : undefined;

  const city =
    typeof o.city === "string" && o.city.trim().length > 0
      ? o.city.trim()
      : ruleGuardResult.city ?? null;

  const now = new Date().toISOString();

  return {
    id: newIntentId(),
    industry,
    scene,
    language,
    page_type,
    tone,
    goal,
    description,
    city,
    compiler_version: "hybrid_v2",
    rule_guard_result: ruleGuardResult,
    user_confirmed: false,
    created_at: now,
    updated_at: now,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface CompileLlmV2Options {
  maxRetries?: number;
}

/**
 * 调用 OpenAI，将用户意图编译为 {@link CompiledIntentV2}。
 */
export async function compileLLMV2(
  rawPrompt: string,
  ruleGuardResult: RuleGuardResult,
  options?: CompileLlmV2Options,
): Promise<CompiledIntentV2> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const maxRetries = options?.maxRetries ?? 2;
  const client = new OpenAI({
    apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });

  const system = `You are an intent compiler for a New Zealand microsite builder (HiBiz).
Output a single JSON object only (no markdown). Fields must match the user message and the rule-guard hints.

Rules:
- industry: "real_estate" for property, listings, open homes, appraisals; "immigration" for visas, study abroad, education migration, 留学, 移民.
- scene (use exactly one string):
  - real_estate: "property_listing" | "open_home_event" | "market_update"
  - immigration: "visa_consultation" | "school_info" | "program_enrollment"
- language: "en" | "zh" | "both" — match the user's writing.
- page_type: "landing" | "showcase" | "form" | "multi_section" — pick the best layout.
- tone: "professional" | "friendly" | "urgent"
- goal: "lead_generation" | "info_display" | "event_registration" | "consultation_booking"
- description: one short sentence summarizing the request (English or Chinese is fine).

Do not invent URLs or guaranteed outcomes. Stay conservative on compliance (NZ context).`;

  const user = `User input:
${rawPrompt.trim()}

Rule guard (hints; may be partial):
${JSON.stringify(
  {
    industry_hint: ruleGuardResult.industry_hint ?? null,
    language_hint: ruleGuardResult.language_hint ?? null,
    city: ruleGuardResult.city ?? null,
    keywords: ruleGuardResult.contains_keywords ?? null,
  },
  null,
  2,
)}

Return JSON with keys: industry, scene, language, and optionally page_type, tone, goal, description, city (only if clearly stated).`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.35,
        max_tokens: 1200,
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw?.trim()) {
        throw new Error("Empty response from OpenAI");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("OpenAI returned invalid JSON");
      }

      return buildCompiledIntentV2FromLlmJson(parsed, ruleGuardResult);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 400);
      }
    }
  }

  throw new Error(
    `compileLLMV2 failed after ${maxRetries + 1} attempt(s): ${lastError?.message ?? "unknown error"}`,
  );
}

/**
 * Rule Guard 必须通过后再调用 LLM 编译。
 */
export async function compileIntentHybrid(
  rawPrompt: string,
  ruleGuardResult: RuleGuardResult,
  options?: CompileLlmV2Options,
): Promise<CompiledIntentV2> {
  if (!ruleGuardResult.passed) {
    throw new Error(`Rule Guard failed: ${ruleGuardResult.reasons.join("; ")}`);
  }
  return compileLLMV2(rawPrompt, ruleGuardResult, options);
}
