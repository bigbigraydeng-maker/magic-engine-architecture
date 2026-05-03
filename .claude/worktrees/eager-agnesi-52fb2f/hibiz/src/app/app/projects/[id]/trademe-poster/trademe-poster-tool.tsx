"use client";

import { ImportTradeMeButton } from "../import-trademe-button";

export interface TradeMePosterToolProps {
  projectId: string;
  defaultUrl: string;
}

export function TradeMePosterTool({ projectId, defaultUrl }: TradeMePosterToolProps) {
  const inputId = "trademe-poster-url";

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <label htmlFor={inputId} className="block text-sm font-medium text-stone-800">
        TradeMe 房源链接
      </label>
      <input
        id={inputId}
        name="trademe_url"
        type="url"
        defaultValue={defaultUrl}
        placeholder="https://www.trademe.co.nz/a/property/…"
        className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5 font-mono text-sm text-stone-900 outline-none ring-emerald-800 focus:ring-2"
        maxLength={500}
        autoComplete="off"
      />
      <p className="mt-2 text-xs text-stone-500">
        支持正式站与 sandbox；将依次尝试官方 API、页面数据与备用抓取，并自动生成中英海报要点。
      </p>
      <div className="mt-4">
        <ImportTradeMeButton projectId={projectId} trademeInputId={inputId} returnTo="trademe-poster" />
      </div>
    </div>
  );
}
