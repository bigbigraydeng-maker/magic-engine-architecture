"use client";

import { useFormStatus } from "react-dom";
import { submitPosterFromTradeMeStandalone } from "./actions";

function PosterSubmitBlock() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="w-full rounded-lg bg-emerald-800 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-80 sm:w-auto sm:px-8"
      >
        {pending ? "正在抓取…（约 30–120 秒）" : "抓取并生成海报"}
      </button>
      {pending ? (
        <p className="mt-3 text-xs font-medium text-amber-900" role="status" aria-live="polite">
          正在创建草稿项目、拉取 TradeMe、代理图片并写入资料；请勿关闭本页或重复点击。
        </p>
      ) : null}
    </div>
  );
}

export function PosterFromTradeMeForm() {
  return (
    <form action={submitPosterFromTradeMeStandalone} className="mt-8 space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div>
        <label htmlFor="trademe_url" className="block text-sm font-medium text-stone-800">
          TradeMe 房源链接
        </label>
        <input
          id="trademe_url"
          name="trademe_url"
          type="url"
          required
          placeholder="https://www.trademe.co.nz/a/property/…"
          className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5 font-mono text-sm text-stone-900 outline-none ring-emerald-800 focus:ring-2"
          maxLength={500}
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-stone-500">
          每次请只粘贴一条房源链接。若两条误粘在一起（例如出现 <span className="font-mono">trademehttps://</span>
          ），保存前会自动尽量只保留第一条 <span className="font-mono">/listing/数字</span> 链接。
        </p>
      </div>
      <PosterSubmitBlock />
    </form>
  );
}
