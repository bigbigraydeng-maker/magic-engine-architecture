import { describe, expect, it } from "vitest";
import { extractListingId } from "./trademe-api";

describe("extractListingId", () => {
  it("parses legacy /listing/ path", () => {
    expect(extractListingId("https://www.trademe.co.nz/listing/1234567")).toBe("1234567");
  });

  it("parses property residential sale tail id", () => {
    const u =
      "https://www.trademe.co.nz/a/property/residential/sale/auckland/auckland-city/westmere/3512345678";
    expect(extractListingId(u)).toBe("3512345678");
  });

  it("falls back to last numeric path segment", () => {
    expect(extractListingId("https://www.trademe.co.nz/a/auction/987654321")).toBe("987654321");
  });
});
