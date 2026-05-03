/** 海报页：房源结构化信息（地址 / 标价 / 房型），与 TradeMe 列表信息架构对齐 */

export type PosterListingFieldVariant = "light" | "dark" | "minimal";

function variantText(
  variant: PosterListingFieldVariant,
  role: "address" | "price" | "pill",
): string {
  if (variant === "dark") {
    if (role === "address") {
      return "text-center text-sm font-medium leading-snug text-teal-100/95";
    }
    if (role === "price") {
      return "text-center text-base font-semibold text-white";
    }
    return "rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-teal-50";
  }
  if (variant === "minimal") {
    if (role === "address") {
      return "text-center text-sm font-medium leading-snug text-stone-700";
    }
    if (role === "price") {
      return "text-center text-base font-semibold text-stone-900";
    }
    return "rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700";
  }
  if (role === "address") {
    return "text-center text-sm font-medium leading-snug text-stone-800";
  }
  if (role === "price") {
    return "text-center text-base font-semibold text-stone-900";
  }
  return "rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-800";
}

export function PosterListingAddressLine({
  listingAddress,
  variant,
}: {
  listingAddress?: string | null;
  variant: PosterListingFieldVariant;
}) {
  const addr = listingAddress?.trim() ?? "";
  if (!addr) {
    return null;
  }
  return <p className={`whitespace-pre-line ${variantText(variant, "address")}`}>{addr}</p>;
}

export function PosterListingPriceStats({
  listingPriceHint,
  listingBedrooms,
  listingBathrooms,
  variant,
  locale = "zh",
}: {
  listingPriceHint?: string | null;
  listingBedrooms?: number | null;
  listingBathrooms?: number | null;
  variant: PosterListingFieldVariant;
  locale?: "en" | "zh";
}) {
  const price = listingPriceHint?.trim() ?? "";
  const hasBeds = listingBedrooms != null && listingBedrooms >= 0;
  const hasBaths = listingBathrooms != null && listingBathrooms >= 0;
  if (!price && !hasBeds && !hasBaths) {
    return null;
  }
  const bedLabel = locale === "en" ? " bed" : " 卧";
  const bathLabel = locale === "en" ? " bath" : " 卫";
  return (
    <div className="space-y-2">
      {price ? <p className={variantText(variant, "price")}>{price}</p> : null}
      {hasBeds || hasBaths ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasBeds ? (
            <span className={variantText(variant, "pill")}>
              {listingBedrooms}
              {bedLabel}
            </span>
          ) : null}
          {hasBaths ? (
            <span className={variantText(variant, "pill")}>
              {listingBathrooms}
              {bathLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
