import Link from "next/link";
import { PosterFromTradeMeForm } from "./poster-from-trademe-form";
import { extractLayerUserLabel, normalizeExtractLayerParam } from "@/lib/extraction/extract-layer-ui";

export const metadata = {
  title: "TradeMe → 海报（免微站）— HiBiz",
};

/** TradeMe 抓取 + 图床代理可能较慢（须放在 page，不能放在 "use server" actions 文件） */
export const maxDuration = 120;

export const dynamic = "force-dynamic";

const NOTICE_COPY: Record<string, string> = {
  no_url: "请粘贴 TradeMe 房源链接。",
  create_project_failed: "无法创建草稿项目，请稍后重试。",
  create_microsite_failed: "无法创建存储记录，请稍后重试。",
  trademe_no_url: "链接为空，请重新粘贴后再提交。",
  listing_import_fail:
    "未能从链接提取房源信息。请确认链接为 trademe.co.nz 房源页；部署环境需配置 OPENAI_API_KEY，并建议配置 JINA_API_KEY 以提高成功率。",
  merchant_no_microsite: "内部错误：未找到存储记录。请重试。",
  merchant_save_error: "保存失败，请重试。",
  listing_imported: "已生成海报素材；打开海报页后可在「提示词建议」里复制给外部 LLM 继续润色。",
};

interface PosterFromTradeMePageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default function PosterFromTradeMePage({ searchParams }: PosterFromTradeMePageProps) {
  const noticeRaw = searchParams.notice;
  const notice = typeof noticeRaw === "string" ? noticeRaw : undefined;
  const noticeMessage = notice ? (NOTICE_COPY[notice] ?? notice) : null;
  const importExtractLayer = normalizeExtractLayerParam(searchParams.extract_layer);

  const isError = notice && notice !== "listing_imported";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-2xl font-semibold text-stone-900">TradeMe → 海报</h1>
      <p className="mt-2 text-sm text-stone-600">
        无需生成微站：粘贴客户提供的 TradeMe 链接即可抓取并写入海报素材；海报页会附带「基于本次链接的提示词建议」，便于你再交给
        LLM 微调。后台会创建一个名为「TradeMe 海报」的草稿项目用于存图，可在项目列表中忽略或删除。
      </p>

      {noticeMessage ? (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 text-sm leading-relaxed ${
            isError ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"
          }`}
        >
          <p>{noticeMessage}</p>
          {notice === "listing_imported" && importExtractLayer ? (
            <p className={`mt-2 text-xs ${isError ? "text-amber-900/90" : "text-emerald-900/85"}`}>
              {extractLayerUserLabel(importExtractLayer)}
            </p>
          ) : null}
        </div>
      ) : null}

      <PosterFromTradeMeForm />

      <p className="mt-8 text-center text-sm text-stone-500">
        <Link href="/app/projects" className="text-emerald-800 underline hover:text-emerald-950">
          项目列表
        </Link>
      </p>
    </div>
  );
}
