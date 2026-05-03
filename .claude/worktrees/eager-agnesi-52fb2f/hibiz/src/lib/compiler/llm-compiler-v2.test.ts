import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

import {
  buildCompiledIntentV2FromLlmJson,
  compileIntentHybrid,
  compileLLMV2,
} from "@/lib/compiler/llm-compiler-v2";
import type { RuleGuardResult } from "@/types/rule-guard";

const guardOk: RuleGuardResult = {
  passed: true,
  reasons: [],
  industry_hint: "real_estate",
  language_hint: "en",
  input_length: 40,
  city: "Auckland",
};

describe("buildCompiledIntentV2FromLlmJson", () => {
  it("builds intent from minimal valid LLM JSON", () => {
    const intent = buildCompiledIntentV2FromLlmJson(
      {
        industry: "real_estate",
        scene: "property_listing",
        language: "en",
        page_type: "landing",
        tone: "professional",
        goal: "lead_generation",
        description: "List a rental in Auckland.",
      },
      guardOk,
    );
    expect(intent.industry).toBe("real_estate");
    expect(intent.scene).toBe("property_listing");
    expect(intent.language).toBe("en");
    expect(intent.compiler_version).toBe("hybrid_v2");
    expect(intent.user_confirmed).toBe(false);
    expect(intent.city).toBe("Auckland");
    expect(intent.id?.startsWith("intent_")).toBe(true);
  });

  it("coerces invalid industry using rule guard hint", () => {
    const intent = buildCompiledIntentV2FromLlmJson(
      { scene: "visa_consultation", language: "zh" },
      {
        passed: true,
        reasons: [],
        industry_hint: "immigration",
        language_hint: "zh",
        input_length: 10,
      },
    );
    expect(intent.industry).toBe("immigration");
    expect(intent.scene).toBe("visa_consultation");
  });

  it("defaults real_estate scene when unknown", () => {
    const intent = buildCompiledIntentV2FromLlmJson(
      { industry: "real_estate", scene: "unknown_scene_xyz", language: "en" },
      { passed: true, reasons: [], input_length: 20 },
    );
    expect(intent.scene).toBe("property_listing");
  });

  it("throws on non-object JSON root", () => {
    expect(() => buildCompiledIntentV2FromLlmJson(null, guardOk)).toThrow(/JSON object/);
  });
});

describe("compileIntentHybrid", () => {
  it("throws when rule guard did not pass", async () => {
    const bad: RuleGuardResult = {
      passed: false,
      reasons: ["input_too_short"],
      input_length: 2,
    };
    await expect(compileIntentHybrid("hi", bad)).rejects.toThrow(/Rule Guard failed/);
  });
});

describe("compileLLMV2 with mocked OpenAI", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              industry: "immigration",
              scene: "visa_consultation",
              language: "both",
              page_type: "form",
              tone: "friendly",
              goal: "lead_generation",
              description: "Visa help in NZ",
            }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockCreate.mockReset();
  });

  it("calls OpenAI and returns CompiledIntentV2", async () => {
    const guard: RuleGuardResult = {
      passed: true,
      reasons: [],
      industry_hint: "immigration",
      language_hint: "both",
      input_length: 50,
    };

    const intent = await compileLLMV2("I need a student visa landing page", guard, { maxRetries: 0 });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(intent.industry).toBe("immigration");
    expect(intent.scene).toBe("visa_consultation");
    expect(intent.language).toBe("both");
    expect(intent.compiler_version).toBe("hybrid_v2");
  });
});
