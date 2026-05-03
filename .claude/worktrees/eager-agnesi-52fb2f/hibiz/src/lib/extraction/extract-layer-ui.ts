import type { TradeMeExtractLayer } from "@/lib/extraction/extract-listing";

const VALID_LAYERS: readonly TradeMeExtractLayer[] = ["trademe_api", "next_data", "jina_openai"];

function isTradeMeExtractLayer(v: string): v is TradeMeExtractLayer {
  return (VALID_LAYERS as readonly string[]).includes(v);
}

/** 从 URL query 解析 `extract_layer`（导入成功页展示用） */
export function normalizeExtractLayerParam(
  raw: string | string[] | undefined,
): TradeMeExtractLayer | undefined {
  const s = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (!s || !isTradeMeExtractLayer(s)) {
    return undefined;
  }
  return s;
}

/** 面向运营/用户的简短说明 */
export function extractLayerUserLabel(layer: TradeMeExtractLayer): string {
  switch (layer) {
    case "trademe_api":
      return "本次抓取：TradeMe 官方 API（OAuth）";
    case "next_data":
      return "本次抓取：房源页内嵌数据（__NEXT_DATA__），未走 Jina/LLM";
    case "jina_openai":
      return "本次抓取：Jina Reader + OpenAI 结构化提取";
    default:
      return "";
  }
}
