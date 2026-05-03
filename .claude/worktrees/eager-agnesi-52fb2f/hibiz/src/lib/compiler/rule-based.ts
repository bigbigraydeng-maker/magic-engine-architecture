import type { ClarificationPayload, CompiledIntentV1 } from "@/types/compiled-intent";
import type { IndustryId } from "@/types/hibiz";

const NZ_CITIES = [
  "auckland",
  "wellington",
  "christchurch",
  "hamilton",
  "tauranga",
  "dunedin",
  "palmerston north",
  "napier",
  "nelson",
  "rotorua",
  "new plymouth",
  "whangarei",
  "invercargill",
  "queenstown",
];

function normalize(text: string): string {
  return text.toLowerCase();
}

function inferCity(prompt: string): string | null {
  const n = normalize(prompt);
  for (const c of NZ_CITIES) {
    if (n.includes(c)) {
      return c
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return null;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** Unsupported industry (e.g. restaurant) — user must not proceed to templates. */
function looksUnsupported(prompt: string): boolean {
  const n = normalize(prompt);
  const restaurant =
    /\b(restaurant|cafe|coffee|menu|dining|takeaway|bistro|bar|eatery|food truck)\b/i.test(prompt) ||
    (n.includes("餐厅") && n.length < 200);
  return restaurant;
}

function inferIndustryFromText(prompt: string, hint: string | null): IndustryId | "ambiguous" | "unsupported" {
  if (looksUnsupported(prompt)) {
    return "unsupported";
  }

  if (hint === "immigration_education" || hint === "real_estate") {
    return hint;
  }

  const n = normalize(prompt);
  const imm =
    /\b(immigration|visa|student visa|work visa|residency|nzqa|ielts|university enrol|留学|移民|签证)\b/i.test(
      prompt,
    ) || n.includes("移民") || n.includes("留学");

  const re =
    /\b(real estate|realtor|listing|open home|property|auction|mortgage|valuation|appraisal|buyer|vendor)\b/i.test(
      prompt,
    ) || n.includes("房源") || n.includes("地产") || n.includes("open home");

  if (imm && !re) {
    return "immigration_education";
  }
  if (re && !imm) {
    return "real_estate";
  }
  if (imm && re) {
    return "ambiguous";
  }

  return "ambiguous";
}

function sceneRealEstate(prompt: string): CompiledIntentV1["scene"] {
  const n = normalize(prompt);
  if (/\bopen home|open house|看房日\b/i.test(prompt) || n.includes("open home")) {
    return "open_home_registration";
  }
  if (/\bappraisal|valuation|market appraisal|estimate|估价\b/i.test(prompt) || n.includes("估价")) {
    return "free_appraisal";
  }
  if (/\bbuyer|purchase|pre-approval|buyers list|买家\b/i.test(prompt)) {
    return "buyer_registration";
  }
  return "listing_promotion";
}

function sceneImmigration(prompt: string): CompiledIntentV1["scene"] {
  if (/\bseminar|webinar|讲座|说明会\b/i.test(prompt)) {
    return "seminar_registration";
  }
  if (/\bbook|consultation|appointment|预约|咨询\b/i.test(prompt)) {
    return "consultation_booking";
  }
  if (/\bprogram|course|pathway|项目|课程\b/i.test(prompt)) {
    return "program_lead_capture";
  }
  return "free_assessment";
}

function goalFromScene(scene: CompiledIntentV1["scene"]): CompiledIntentV1["goal"] {
  if (scene === "consultation_booking") {
    return "booking";
  }
  if (scene === "seminar_registration" || scene === "open_home_registration") {
    return "event_signup";
  }
  if (scene === "free_assessment" || scene === "free_appraisal") {
    return "assessment";
  }
  return "lead_gen";
}

export type CompileRuleResult =
  | { kind: "ok"; compiled: CompiledIntentV1 }
  | { kind: "needs_clarification"; clarification: ClarificationPayload };

const COMPILER_VERSION = "compiler@0.2.0-rule";

export function getCompilerVersion(): string {
  return COMPILER_VERSION;
}

export function compileRuleBased(rawPrompt: string, industryHint: string | null): CompileRuleResult {
  const trimmed = rawPrompt.trim();
  const industry = inferIndustryFromText(trimmed, industryHint);

  if (industry === "unsupported") {
    return {
      kind: "needs_clarification",
      clarification: {
        schema_version: 1,
        questions: [
          {
            id: "unsupported_industry",
            type: "single_choice",
            prompt: "We currently support immigration & education and real estate only. What would you like to do?",
            options: [
              { value: "retry_immigration", label: "I'll describe an immigration / education page instead" },
              { value: "retry_real_estate", label: "I'll describe a real estate page instead" },
            ],
          },
        ],
      },
    };
  }

  if (industry === "ambiguous") {
    return {
      kind: "needs_clarification",
      clarification: {
        schema_version: 1,
        questions: [
          {
            id: "pick_industry",
            type: "single_choice",
            prompt: "Which industry fits best?",
            options: [
              { value: "immigration_education", label: "Immigration & education" },
              { value: "real_estate", label: "Real estate" },
            ],
          },
        ],
      },
    };
  }

  const city = inferCity(trimmed);
  const language_mode: CompiledIntentV1["language_mode"] = hasChinese(trimmed) ? "en_bilingual_zh" : "en";

  const scene = industry === "real_estate" ? sceneRealEstate(trimmed) : sceneImmigration(trimmed);

  const compiled: CompiledIntentV1 = {
    schema_version: 1,
    industry,
    scene,
    city,
    language_mode,
    goal: goalFromScene(scene),
    needs_form: true,
    tone: "professional",
    target_customer: [],
    nz: {
      default_country: "NZ",
      region_hint: city,
    },
  };

  return { kind: "ok", compiled };
}
