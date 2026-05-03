import { describe, expect, it } from "vitest";
import { applyRuleGuard, runRuleGuardSync } from "@/lib/compiler/rule-guard";

describe("runRuleGuardSync", () => {
  it("rejects very short input", () => {
    const r = runRuleGuardSync("短");
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("input_too_short");
  });

  it("rejects blacklist", () => {
    const r = runRuleGuardSync("This is long enough but viagra spam here");
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toBe("blacklist");
  });

  it("rejects unsupported industry (restaurant)", () => {
    const r = runRuleGuardSync("I need a landing page for my restaurant in Auckland with menu");
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("unsupported_industry");
  });

  it("passes Auckland real estate hint", () => {
    const r = runRuleGuardSync(
      "We are real estate agents in Auckland and want a listing promotion page with open home leads.",
    );
    expect(r.passed).toBe(true);
    expect(r.industry_hint).toBe("real_estate");
    expect(r.city).toMatch(/Auckland/i);
    expect(r.language_hint).toBe("en");
  });

  it("passes immigration hint (English)", () => {
    const r = runRuleGuardSync(
      "Student visa and immigration consultation in Wellington — need lead capture form for IELTS clients.",
    );
    expect(r.passed).toBe(true);
    expect(r.industry_hint).toBe("immigration");
    expect(r.city).toMatch(/Wellington/i);
  });

  it("marks ambiguous when both signals present", () => {
    const r = runRuleGuardSync(
      "Property investment visa pathway in Christchurch: real estate and immigration advice combined.",
    );
    expect(r.passed).toBe(true);
    expect(r.industry_hint).toBeUndefined();
    expect(r.reasons).toContain("ambiguous_industry");
  });

  it("applyRuleGuard resolves to same as sync", async () => {
    const raw = "请帮我做一个移民咨询页面在新西兰奥克兰需要留资表单";
    const a = await applyRuleGuard(raw);
    const b = runRuleGuardSync(raw);
    expect(a).toEqual(b);
    expect(a.passed).toBe(true);
    expect(a.industry_hint).toBe("immigration");
    expect(a.language_hint).toBe("zh");
  });
});
