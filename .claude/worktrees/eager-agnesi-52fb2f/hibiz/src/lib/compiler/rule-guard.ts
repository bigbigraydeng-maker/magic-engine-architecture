import type { RuleGuardConfig, RuleGuardResult } from "@/types/rule-guard";

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasLatin(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

function inferLanguageHint(prompt: string): "en" | "zh" | "both" {
  const c = hasChinese(prompt);
  const l = hasLatin(prompt);
  if (c && l) {
    return "both";
  }
  if (c) {
    return "zh";
  }
  return "en";
}

/** 扩展 NZ 城市/城镇名（小写），用于子串匹配。 */
export const DEFAULT_NZ_CITIES: readonly string[] = [
  "auckland",
  "wellington",
  "christchurch",
  "hamilton",
  "tauranga",
  "napier",
  "hastings",
  "dunedin",
  "palmerston north",
  "nelson",
  "rotorua",
  "new plymouth",
  "whangarei",
  "invercargill",
  "whanganui",
  "gisborne",
  "timaru",
  "taupo",
  "masterton",
  "levin",
  "ashburton",
  "blenheim",
  "greymouth",
  "queenstown",
  "wanaka",
  "oamaru",
  "cambridge",
  "te awamutu",
  "tokoroa",
  "hawera",
  "feilding",
  "upper hutt",
  "lower hutt",
  "porirua",
  "paraparaumu",
  "kapiti",
  "dannevirke",
  "marton",
  "foxton",
  "thames",
  "whakatane",
  "kerikeri",
  "paihia",
  "russell",
  "kaitaia",
  "dargaville",
  "pukekohe",
  "papakura",
  "manukau",
  "north shore",
  "howick",
  "otahuhu",
  "onehunga",
  "epsom",
  "remuera",
  "ponsonby",
  "newmarket",
  "albany",
  "henderson",
  "waitakere",
  "riccarton",
  "hornby",
  "rolleston",
  "kaiapoi",
  "rangiora",
  "temuka",
  "twizel",
  "alexandra",
  "cromwell",
  "arrowtown",
  "invercargill city",
];

const DEFAULT_BLACKLIST: readonly string[] = [
  "viagra",
  "cialis",
  "casino",
  "click here",
  "buy now",
  "winner",
  "congratulations you won",
];

const IMMIGRATION_PATTERNS: readonly RegExp[] = [
  /\b(immigration|visa|student visa|work visa|residency|nzqa|ielts|pte|university enrol|pathway|pr\b)\b/i,
];

const REAL_ESTATE_PATTERNS: readonly RegExp[] = [
  /\b(real estate|realtor|listing|open home|open house|property|auction|mortgage|valuation|appraisal|buyer|vendor)\b/i,
];

const UNSUPPORTED_INDUSTRY_PATTERNS: readonly RegExp[] = [
  /\b(restaurant|cafe|coffee shop|menu|dining|takeaway|bistro|bar|eatery|food truck)\b/i,
];

function titleCaseCity(slug: string): string {
  return slug
    .split(" ")
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function inferCity(prompt: string, cities: readonly string[]): string | undefined {
  const n = normalize(prompt);
  const sorted = [...cities].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (n.includes(c)) {
      return titleCaseCity(c);
    }
  }
  return undefined;
}

function matchesAnyPattern(prompt: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(prompt));
}

function hitImmigration(prompt: string): boolean {
  const n = normalize(prompt);
  if (n.includes("移民") || n.includes("留学") || n.includes("签证")) {
    return true;
  }
  return matchesAnyPattern(prompt, IMMIGRATION_PATTERNS);
}

function hitRealEstate(prompt: string): boolean {
  const n = normalize(prompt);
  if (n.includes("房源") || n.includes("地产") || n.includes("open home") || n.includes("看房")) {
    return true;
  }
  return matchesAnyPattern(prompt, REAL_ESTATE_PATTERNS);
}

function looksUnsupportedIndustry(prompt: string, patterns: readonly RegExp[]): boolean {
  const n = normalize(prompt);
  if (n.includes("餐厅") && prompt.length < 200) {
    return true;
  }
  return matchesAnyPattern(prompt, patterns);
}

function hitBlacklist(prompt: string, words: readonly string[]): string | null {
  const n = normalize(prompt);
  for (const w of words) {
    if (n.includes(w)) {
      return w;
    }
  }
  return null;
}

export const DEFAULT_RULE_GUARD_CONFIG: RuleGuardConfig = {
  min_input_length: 5,
  max_input_length: 8000,
  blacklist_words: DEFAULT_BLACKLIST,
  nz_cities: DEFAULT_NZ_CITIES,
  immigration_keywords: [], // 使用正则 + 中文子串，此项保留扩展
  real_estate_keywords: [],
  unsupported_industry_patterns: UNSUPPORTED_INDUSTRY_PATTERNS,
};

/**
 * 同步规则守卫（零网络）。{@link applyRuleGuard} 为其 async 包装。
 */
export function runRuleGuardSync(rawPrompt: string, config: RuleGuardConfig = DEFAULT_RULE_GUARD_CONFIG): RuleGuardResult {
  const trimmed = rawPrompt.trim();
  const input_length = trimmed.length;
  const reasons: string[] = [];
  const keywords: string[] = [];

  if (input_length < config.min_input_length) {
    return {
      passed: false,
      reasons: ["input_too_short"],
      input_length,
    };
  }

  if (input_length > config.max_input_length) {
    return {
      passed: false,
      reasons: ["input_too_long"],
      input_length,
    };
  }

  const blocked = hitBlacklist(trimmed, config.blacklist_words);
  if (blocked) {
    return {
      passed: false,
      reasons: ["blacklist", `hit:${blocked}`],
      input_length,
    };
  }

  if (looksUnsupportedIndustry(trimmed, config.unsupported_industry_patterns)) {
    return {
      passed: false,
      reasons: ["unsupported_industry"],
      language_hint: inferLanguageHint(trimmed),
      input_length,
    };
  }

  const city = inferCity(trimmed, config.nz_cities);
  if (city) {
    keywords.push(`city:${city.toLowerCase()}`);
  }

  const imm = hitImmigration(trimmed);
  const re = hitRealEstate(trimmed);
  if (imm) {
    keywords.push("immigration_signal");
  }
  if (re) {
    keywords.push("real_estate_signal");
  }

  let industry_hint: RuleGuardResult["industry_hint"];
  if (imm && !re) {
    industry_hint = "immigration";
  } else if (re && !imm) {
    industry_hint = "real_estate";
  } else if (imm && re) {
    reasons.push("ambiguous_industry");
  } else {
    reasons.push("weak_industry_signal");
  }

  return {
    passed: true,
    reasons,
    industry_hint,
    language_hint: inferLanguageHint(trimmed),
    city,
    input_length,
    contains_keywords: keywords.length > 0 ? keywords : undefined,
  };
}

/**
 * Rule Guard（Phase 1）：预过滤 + 城市/行业/语言线索。供后续 LLM Compiler V2 使用。
 */
export async function applyRuleGuard(
  rawPrompt: string,
  config: RuleGuardConfig = DEFAULT_RULE_GUARD_CONFIG,
): Promise<RuleGuardResult> {
  return runRuleGuardSync(rawPrompt, config);
}
