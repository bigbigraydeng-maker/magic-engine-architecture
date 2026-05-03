import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseMerchantProfile } from "@/types/merchant-profile";
import { TradeMePosterTool } from "./trademe-poster-tool";
import { extractLayerUserLabel, normalizeExtractLayerParam } from "@/lib/extraction/extract-layer-ui";

export const metadata = {
  title: "TradeMe → 要点 → 海报 — HiBiz",
};

export const dynamic = "force-dynamic";

const NOTICE_COPY: Record<string, string> = {
  trademe_no_url: "请先粘贴 TradeMe 房源链接，再点「从链接导入房源信息」。",
  listing_import_fail:
    "未能从链接提取房源信息。请确认链接为 trademe.co.nz 房源页；部署环境需 OPENAI_API_KEY，并建议配置 JINA_API_KEY。",
  listing_imported: "已抓取并写入标题、描述、图片与中英海报要点。可在下方核对，再打开可打印海报。",
  merchant_no_microsite: "本项目还没有微站记录。请先在项目页生成微站草稿，再使用此工具。",
  merchant_save_error: "保存失败，请重试。",
};

interface TradeMePosterPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function TradeMePosterPage({ params, searchParams }: TradeMePosterPageProps) {
  const supabase = createClient();
  const { data: project, error: pErr } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();

  if (pErr || !project) {
    notFound();
  }

  const { data: ms, error: mErr } = await supabase.from("microsites").select("merchant_profile").eq("project_id", params.id).maybeSingle();

  if (mErr || !ms) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-4 font-display text-xl font-semibold text-stone-900">尚无法使用 TradeMe 海报工具</h1>
        <p className="mt-2 text-sm text-stone-600">需要先有微站记录。请到项目页生成微站草稿后再试。</p>
      </div>
    );
  }

  const mp = parseMerchantProfile(ms.merchant_profile);
  const promo = mp?.property_promo;
  const noticeRaw = searchParams.notice;
  const notice = typeof noticeRaw === "string" ? noticeRaw : undefined;
  const noticeMessage = notice ? (NOTICE_COPY[notice] ?? notice) : null;
  const importExtractLayer = normalizeExtractLayerParam(searchParams.extract_layer);

  const zh = promo?.poster_blurb_zh?.trim() ?? "";
  const en = promo?.poster_blurb_en?.trim() ?? "";
  const headline = promo?.headline?.trim() ?? "";
  const trademeUrl = promo?.trademe_url?.trim() ?? "";
  const imageCount = promo?.trademe_image_urls?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">TradeMe 房源 → 要点 → 海报</h1>
      <p className="mt-2 text-sm text-stone-600">
        粘贴 listing 链接，一键抓取关键信息并生成中英海报正文（与项目里「从链接导入」相同引擎）。若尚未生成微站，请用顶部导航「TradeMe 海报」免微站入口。
      </p>
      <p className="mt-2 text-sm">
        <Link href="/app/poster-from-trademe" className="font-medium text-emerald-800 underline hover:text-emerald-950">
          免微站：TradeMe → 海报（新建草稿并导入）→
        </Link>
      </p>

      {noticeMessage ? (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            notice === "listing_imported"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <p>{noticeMessage}</p>
          {notice === "listing_imported" && importExtractLayer ? (
            <p className="mt-2 text-xs text-emerald-900/85">{extractLayerUserLabel(importExtractLayer)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8">
        <TradeMePosterTool projectId={project.id} defaultUrl={trademeUrl} />
      </div>

      {headline || zh || en ? (
        <div className="mt-10 space-y-6">
          <h2 className="font-display text-lg font-semibold text-stone-900">抓取结果与海报要点</h2>
          {headline ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">标题（写入海报主标题）</p>
              <p className="mt-1 text-sm font-medium text-stone-900">{headline}</p>
            </div>
          ) : null}
          {zh ? (
            <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-stone-500">海报要点 · 中文</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-stone-800">{zh}</pre>
            </div>
          ) : (
            <p className="text-sm text-stone-500">暂无中文要点（描述过短或模型跳过时可到项目页手动编辑海报正文）。</p>
          )}
          {en ? (
            <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-stone-500">Poster highlights · English</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-stone-800">{en}</pre>
            </div>
          ) : null}
          {imageCount > 0 ? (
            <p className="text-xs text-stone-500">已缓存 {imageCount} 张图供海报宫格使用。</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-10 flex flex-wrap gap-4 border-t border-stone-200 pt-8">
        <Link
          href={`/app/projects/${project.id}/poster`}
          className="inline-flex rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          打开可打印海报 →
        </Link>
        <Link href={`/app/projects/${project.id}`} className="inline-flex items-center text-sm text-stone-600 underline hover:text-stone-900">
          去项目页编辑商家信息
        </Link>
      </div>
    </div>
  );
}
