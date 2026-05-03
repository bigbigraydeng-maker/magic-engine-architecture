import { describe, expect, it } from "vitest";
import { buildFormFieldsFromRules } from "@/lib/generation/llm-form-builder";
import type { SceneV2 } from "@/types/compiled-intent-v2";

describe("buildFormFieldsFromRules", () => {
  it("returns property listing fields for real_estate property_listing", () => {
    const result = buildFormFieldsFromRules("real_estate", "property_listing");

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("name");
    expect(result.field_order).toContain("email");
    expect(result.field_order).toContain("property_address");
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it("returns visa consultation fields for immigration visa_consultation", () => {
    const result = buildFormFieldsFromRules("immigration", "visa_consultation");

    expect(result.selected_fields.length).toBeGreaterThan(0);
    expect(result.field_order).toContain("visa_type");
    expect(result.field_order).toContain("current_location");
    expect(result.confidence).toBeGreaterThanOrEqual(88);
  });

  it("falls back to universal fields for unknown scene", () => {
    const result = buildFormFieldsFromRules("real_estate", "unknown_scene" as unknown as SceneV2);

    expect(result.confidence).toBeLessThan(70);
    expect(result.field_order).toEqual(["name", "email", "phone"]);
  });
});
