/**
 * 海报页：展示 7 块映射对应的数据库/计算后取值，便于排查「海报为何仍是占位」。
 */

function emptyLabel(v: string | null | undefined): string {
  const t = v?.trim() ?? "";
  return t.length > 0 ? t : "（空）";
}

function shortenUrl(u: string, max = 72): string {
  return u.length <= max ? u : `${u.slice(0, max)}…`;
}

export interface PosterMappingDebugPanelProps {
  /** 实际传给版面的主标题（可能与 raw headline 一致） */
  headlineDisplay: string;
  listingAddress: string | null;
  /** 海报主图区使用的 URL（最多 3 条） */
  posterImageUrls: string[];
  /** 排序后可用于海报的图总数（含未展示的） */
  totalRankedImages: number;
  listingPriceHint: string | null;
  listingBedrooms: number | null;
  listingBathrooms: number | null;
  /** 传给版面的短正文 */
  shortDetails: string;
  /** 短正文取自哪个字段 */
  detailsSourceLabel: string;
  agentName: string | null;
  agentCompany: string | null;
  agentPhone: string | null;
  agentPhotoUrl: string | null;
  trademeUrl: string | null;
}

export function PosterMappingDebugPanel({
  headlineDisplay,
  listingAddress,
  posterImageUrls,
  totalRankedImages,
  listingPriceHint,
  listingBedrooms,
  listingBathrooms,
  shortDetails,
  detailsSourceLabel,
  agentName,
  agentCompany,
  agentPhone,
  agentPhotoUrl,
  trademeUrl,
}: PosterMappingDebugPanelProps) {
  const rows: { k: string; v: string }[] = [
    { k: "1. 地址 listing_address", v: emptyLabel(listingAddress) },
    { k: "2. 标题 headline（版面）", v: emptyLabel(headlineDisplay) },
    {
      k: "3. 主图（前 3 张）",
      v:
        posterImageUrls.length > 0
          ? posterImageUrls.map((u, i) => `[${i + 1}] ${shortenUrl(u)}`).join("\n")
          : `（空）— 排序池共 ${totalRankedImages} 张`,
    },
    {
      k: "4. 价格 listing_price_hint",
      v: emptyLabel(listingPriceHint),
    },
    {
      k: "5. 房型 listing_bedrooms / listing_bathrooms",
      v:
        listingBedrooms != null || listingBathrooms != null
          ? `${listingBedrooms ?? "—"} 卧 / ${listingBathrooms ?? "—"} 卫`
          : "（空）",
    },
    {
      k: "6. 短摘要（版面）",
      v: `${emptyLabel(shortDetails)}\n来源：${detailsSourceLabel}`,
    },
    {
      k: "7. 中介 listing_agent_*",
      v: [
        `姓名：${emptyLabel(agentName)}`,
        `公司：${emptyLabel(agentCompany)}`,
        `电话：${emptyLabel(agentPhone)}`,
        `头像 URL：${agentPhotoUrl?.trim() ? shortenUrl(agentPhotoUrl.trim(), 80) : "（空）"}`,
      ].join("\n"),
    },
    {
      k: "TradeMe 链接（二维码）",
      v: emptyLabel(trademeUrl),
    },
  ];

  return (
    <details className="mt-6 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-800 shadow-sm">
      <summary className="cursor-pointer font-semibold text-stone-900 outline-none marker:text-emerald-800">
        数据源检查 · 7 块映射（展开查看当前值）
      </summary>
      <p className="mt-2 text-xs text-stone-500">
        以下为写入 `merchant_profile.property_promo` 后、经解析用于本页海报的字段。若某项为「（空）」，版面对应区域不会显示或会回退为占位。
      </p>
      <dl className="mt-3 space-y-3 border-t border-stone-100 pt-3">
        {rows.map(({ k, v }) => (
          <div key={k}>
            <dt className="font-mono text-[11px] font-medium uppercase tracking-wide text-stone-500">{k}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-stone-800">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
