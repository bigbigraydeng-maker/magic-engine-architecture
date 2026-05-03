import { describe, expect, it } from "vitest";
import {
  filterAndRankListingImageUrls,
  isJunkListingImageUrl,
  scoreListingImageUrl,
} from "./image-url-filters";

describe("scoreListingImageUrl", () => {
  it("scores Supabase listing-images proxy URLs above strict threshold", () => {
    const u =
      "https://abcdefgh.supabase.co/storage/v1/object/public/listing-images/proj-1/a1b2c3d4-e5f6.jpg";
    expect(scoreListingImageUrl(u)).toBeGreaterThanOrEqual(14);
  });
});

describe("isJunkListingImageUrl", () => {
  it("rejects TradeMe listing page URLs mistaken for images", () => {
    const pageUrl =
      "https://www.trademe.co.nz/a/property/residential/sale/canterbury/selwyn/prebbleton/listing/5838241272";
    expect(isJunkListingImageUrl(pageUrl)).toBe(true);
  });
});

describe("filterAndRankListingImageUrls", () => {
  it("keeps proxied Supabase images for poster pipeline", () => {
    const u =
      "https://abcdefgh.supabase.co/storage/v1/object/public/listing-images/proj-1/a1b2c3d4-e5f6.jpg";
    expect(filterAndRankListingImageUrls([u], 6)).toEqual([u]);
  });

  it("returns empty when every URL is low-confidence (avoids showing arbitrary icons as listing photos)", () => {
    const low = "https://example.org/a.jpg";
    expect(scoreListingImageUrl(low)).toBeLessThan(18);
    const out = filterAndRankListingImageUrls([low], 3);
    expect(out).toEqual([]);
  });
});
