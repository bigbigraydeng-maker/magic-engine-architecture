import { describe, expect, it } from "vitest";
import { sanitizePastedTradeMeUrl } from "./trademe-url-sanitize";

describe("sanitizePastedTradeMeUrl", () => {
  it("fixes trademehttps:// typo and takes first /a/.../listing/ id when two URLs are glued", () => {
    const pasted =
      "https://www.trademehttps://www.trademe.co.nz/a/property/residential/lifestyle-property/canterbury/selwyn/prebbleton/listing/5838241272.co.nz/a/motors/cars/toyota/ist/listing/5798475113";
    expect(sanitizePastedTradeMeUrl(pasted)).toBe(
      "https://www.trademe.co.nz/a/property/residential/lifestyle-property/canterbury/selwyn/prebbleton/listing/5838241272",
    );
  });

  it("leaves a single clean URL unchanged", () => {
    const u = "https://www.trademe.co.nz/a/motors/cars/toyota/ist/listing/5798475113";
    expect(sanitizePastedTradeMeUrl(u)).toBe(u);
  });

  it("handles legacy /listing/ path", () => {
    const u = "https://www.trademe.co.nz/listing/1234567";
    expect(sanitizePastedTradeMeUrl(u)).toBe(u);
  });
});
