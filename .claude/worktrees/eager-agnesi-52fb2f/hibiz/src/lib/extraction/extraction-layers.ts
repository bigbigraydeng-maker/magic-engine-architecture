import type { ExtractTradeMeListingResult } from "@/lib/extraction/extract-listing";
import { extractTradeMeListing } from "@/lib/extraction/extract-listing";
import { extractFromNextData } from "@/lib/extraction/extract-next-data";
import { filterAndRankListingImageUrls } from "@/lib/extraction/image-url-filters";
import { fetchListingFromApi } from "@/lib/extraction/trademe-api";

/**
 * Layer 0: TradeMe Official API（最可靠）
 * → Layer 1: HTML `__NEXT_DATA__`（零 LLM）
 * → Layer 2: Jina + OpenAI（备选）
 */
export async function extractTradeMeListingMultiLayer(url: string): Promise<ExtractTradeMeListingResult> {
  // Layer 0: TradeMe API（如果已配置 consumer credentials）
  const fromApi = await fetchListingFromApi(url);
  if (fromApi) {
    const images = filterAndRankListingImageUrls(fromApi.images, 12);
    return { listing: { ...fromApi, images }, markdown: "", extractLayer: "trademe_api" };
  }

  // Layer 1: __NEXT_DATA__（零成本）
  const fromNext = await extractFromNextData(url);
  if (fromNext) {
    const images = filterAndRankListingImageUrls(fromNext.images, 12);
    return { listing: { ...fromNext, images }, markdown: "", extractLayer: "next_data" };
  }

  // Layer 2: Jina + OpenAI
  return extractTradeMeListing(url);
}
