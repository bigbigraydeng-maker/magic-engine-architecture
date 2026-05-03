import type { PropertyPromoV1 } from "@/types/merchant-profile";

/**
 * 根据已写入的 TradeMe 导入结果拼一段「给 LLM / 设计师」的海报提示词草稿，供用户复制微调。
 * 不做质量拦截，仅聚合已有字段。
 */
export function buildPosterLlmPromptSuggestionFromPromo(promo: PropertyPromoV1 | undefined): string | null {
  if (!promo) {
    return null;
  }
  const url = promo.trademe_url?.trim();
  const headline = promo.headline?.trim();
  const details = promo.details?.trim();
  const addr = promo.listing_address?.trim();
  const price = promo.listing_price_hint?.trim();
  const zh = promo.poster_blurb_zh?.trim();
  const en = promo.poster_blurb_en?.trim();
  if (
    !url &&
    !headline &&
    !details &&
    !zh &&
    !en &&
    !addr &&
    !price &&
    promo.listing_bedrooms == null &&
    promo.listing_bathrooms == null
  ) {
    return null;
  }

  const lines: string[] = [
    "你是熟悉新西兰房产中英文营销的写手。请基于下列从 TradeMe 页面整理出的信息，生成可印 A4 海报的：主标题（中英文可分行）+ 4–8 条要点（中英对照或分段）；语气专业、克制；不要编造未在材料中出现的数字、面积或法律/移民承诺。",
    "",
  ];
  if (url) {
    lines.push(`房源链接：${url}`);
  }
  if (addr) {
    lines.push(`地址：${addr}`);
  }
  if (headline) {
    lines.push(`标题：${headline}`);
  }
  if (price) {
    lines.push(`价格/议价：${price}`);
  }
  if (promo.listing_bedrooms != null || promo.listing_bathrooms != null) {
    lines.push(
      `房型：${promo.listing_bedrooms != null ? `${promo.listing_bedrooms} 卧` : ""}${promo.listing_bedrooms != null && promo.listing_bathrooms != null ? " · " : ""}${promo.listing_bathrooms != null ? `${promo.listing_bathrooms} 卫` : ""}`,
    );
  }
  if (details) {
    lines.push("");
    lines.push("描述摘录：");
    lines.push(details.slice(0, 3500));
  }
  if (zh || en) {
    lines.push("");
    lines.push("系统已生成的海报要点草稿（可改写、可弃用）：");
    if (zh) {
      lines.push("【中文】");
      lines.push(zh.slice(0, 1200));
    }
    if (en) {
      lines.push("【English】");
      lines.push(en.slice(0, 1200));
    }
  }
  lines.push("");
  lines.push("输出：先给中文海报文案，再给英文；每条要点一行，便于排版。");

  return lines.join("\n");
}
