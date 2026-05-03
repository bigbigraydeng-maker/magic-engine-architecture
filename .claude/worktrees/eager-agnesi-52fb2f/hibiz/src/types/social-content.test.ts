import { describe, expect, it } from "vitest";
import { parseSocialCaptionsV1 } from "@/types/social-content";

describe("parseSocialCaptionsV1", () => {
  it("parses optional image_plan", () => {
    const raw = {
      schema_version: 1,
      platforms: {
        facebook: { en: "a", zh: "啊" },
        instagram: { en: "b", zh: "吧" },
        linkedin: { en: "c", zh: "从" },
        xiaohongshu: { en: "d", zh: "的" },
      },
      image_plan: { zh: "封面用图一", en: "Use image 1 as cover" },
    };
    const out = parseSocialCaptionsV1(raw);
    expect(out?.image_plan?.zh).toBe("封面用图一");
    expect(out?.image_plan?.en).toBe("Use image 1 as cover");
  });

  it("works without image_plan", () => {
    const raw = {
      schema_version: 1,
      platforms: {
        facebook: { en: "a", zh: "啊" },
        instagram: { en: "b", zh: "吧" },
        linkedin: { en: "c", zh: "从" },
        xiaohongshu: { en: "d", zh: "的" },
      },
    };
    const out = parseSocialCaptionsV1(raw);
    expect(out?.image_plan).toBeUndefined();
  });
});
