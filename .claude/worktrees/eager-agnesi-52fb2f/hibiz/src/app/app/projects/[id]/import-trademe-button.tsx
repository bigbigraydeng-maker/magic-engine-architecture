"use client";

import { Fragment, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importListingFromUrl, type ImportListingReturnTo } from "../merchant-profile-actions";

interface ImportTradeMeButtonProps {
  projectId: string;
  /** 与 TradeMe 输入框的 id 一致，用于读取未保存的链接 */
  trademeInputId: string;
  /** 导入完成后跳转；默认回项目详情 */
  returnTo?: ImportListingReturnTo;
}

function isNextRedirectError(e: unknown): boolean {
  if (!e || typeof e !== "object") {
    return false;
  }
  const d = (e as { digest?: unknown }).digest;
  return typeof d === "string" && d.includes("NEXT_REDIRECT");
}

export function ImportTradeMeButton({ projectId, trademeInputId, returnTo = "project" }: ImportTradeMeButtonProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Fragment>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const el = document.getElementById(trademeInputId);
          const raw = el instanceof HTMLInputElement ? el.value : "";
          const override = raw.trim() ? raw : undefined;
          startTransition(async () => {
            try {
              await importListingFromUrl(projectId, override, returnTo);
            } catch (e: unknown) {
              if (isNextRedirectError(e)) {
                throw e;
              }
              console.error(e);
              router.refresh();
            }
          });
        }}
        className="rounded-lg border border-emerald-700 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "导入中…" : "从链接导入房源信息"}
      </button>
      {pending ? (
        <p className="mt-2 max-w-md text-xs font-medium text-amber-900" role="status" aria-live="polite">
          TradeMe 抓取与图床代理较慢时可达 1–2 分钟；请勿关闭页面或重复点击。
        </p>
      ) : null}
    </Fragment>
  );
}
