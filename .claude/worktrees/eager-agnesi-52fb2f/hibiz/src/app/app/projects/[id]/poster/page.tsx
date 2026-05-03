import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizePosterTemplateId } from "@/data/poster-templates";
import { listingUrlToQrDataUrl } from "@/lib/poster/qr";
import { collectPosterImageUrls } from "@/lib/merchant-profile/poster-images";
import { buildPosterContactFromProfile } from "@/lib/generation/skeleton-fill";
import { parseMerchantProfile, type PropertyPromoV1 } from "@/types/merchant-profile";
import { PosterDesignedLayout } from "@/components/poster/PosterDesignedLayout";
import { PosterPromptPanel } from "@/components/poster/PosterPromptPanel";
import { buildPosterLlmPromptSuggestionFromPromo } from "@/lib/poster/poster-llm-prompt-suggestion";
import { PosterMappingDebugPanel } from "@/components/poster/PosterMappingDebugPanel";
import { PosterPrintBar } from "./poster-print-bar";
import { extractLayerUserLabel, normalizeExtractLayerParam } from "@/lib/extraction/extract-layer-ui";

function posterDetailsSourceLabel(promo: PropertyPromoV1 | undefined): string {
  if (!promo) {
    return "无 property_promo";
  }
  const loc = promo.poster_locale === "en" ? "en" : "zh";
  if (loc === "en") {
    if (promo.poster_blurb_en?.trim()) {
      return "poster_blurb_en";
    }
    if (promo.details?.trim()) {
      return "details（无英文摘要）";
    }
    return "（空）";
  }
  if (promo.poster_blurb_zh?.trim()) {
    return "poster_blurb_zh";
  }
  if (promo.details?.trim()) {
    return "details（无中文摘要）";
  }
  return "（空）";
}

function resolvePosterBody(promo: PropertyPromoV1 | undefined): string {
  if (!promo) {
    return "";
  }
  const loc = promo.poster_locale === "en" ? "en" : "zh";
  const raw = promo.details?.trim() ?? "";
  if (loc === "en") {
    return (promo.poster_blurb_en?.trim() || raw).slice(0, 4000);
  }
  return (promo.poster_blurb_zh?.trim() || raw).slice(0, 4000);
}

const POSTER_NOTICE_COPY: Record<string, string> = {
  /** 仅在「就绪」评估通过时展示；弱数据见下方琥珀说明 */
  listing_imported: "已从 TradeMe 链接写入资料，当前预览具备常见发布要素，印刷前仍请自行核对文案与合规。",
};

interface PosterReadiness {
  level: "ok" | "weak";
  reasons: string[];
}

/**
 * 对外可发放的房产海报：通常需要可读标题（非纯编号兜底）、至少一张实拍级主图、足够长的卖点正文。
 * 不满足时只应视为「内部草稿」，不得用成功态误导为可印刷物料。
 */
function assessPropertyPosterReadiness(args: {
  headline: string;
  posterBody: string;
  imageUrls: string[];
  projectName: string;
  listingAddress?: string | null;
  hasTrademeUrl: boolean;
}): PosterReadiness {
  const reasons: string[] = [];
  const h = args.headline.trim();
  const isFallbackListingId =
    /^TradeMe\s*房源\s*[·•]\s*#\d{5,15}$/i.test(h) ||
    /^TradeMe\s*房源\s*#\d{5,15}$/i.test(h) ||
    /^#\d{5,15}$/.test(h);
  const looksLikeGenericProject =
    h === args.projectName.trim() && (args.projectName === "TradeMe 海报" || args.projectName.trim().length < 4);
  if (isFallbackListingId || looksLikeGenericProject || h.length < 10) {
    reasons.push("标题仍是占位或仅 listing 编号，缺少街道/城区或一句话卖点。");
  }
  if (args.hasTrademeUrl && !(args.listingAddress?.trim() ?? "")) {
    reasons.push("未写入结构化「房源地址」行；请重新导入或在项目页手动填写，以便海报与 TradeMe 信息架构一致。");
  }
  if (args.imageUrls.length === 0) {
    reasons.push("没有可用的房源主图（印刷物料一般需要至少一张外观或客厅实拍）。");
  }
  if (args.posterBody.trim().length < 80) {
    reasons.push("正文过短，通常还需要房型、价格或议价、开放日、亮点等发布级信息。");
  }
  return { level: reasons.length > 0 ? "weak" : "ok", reasons };
}

interface PosterPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export const metadata = {
  title: "Promotion poster — HiBiz",
};

export default async function PosterPage({ params, searchParams }: PosterPageProps) {
  const supabase = createClient();
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();

  if (pErr || !project) {
    notFound();
  }

  const { data: ms, error: mErr } = await supabase
    .from("microsites")
    .select("merchant_profile")
    .eq("project_id", params.id)
    .maybeSingle();

  if (mErr || !ms) {
    notFound();
  }

  const mp = parseMerchantProfile(ms.merchant_profile);
  const promo = mp?.property_promo;
  const contact = mp?.contact;
  const posterContact = mp ? buildPosterContactFromProfile(mp) : null;
  const templateId = normalizePosterTemplateId(promo?.poster_template_id);
  const headline = promo?.headline?.trim() || project.name;
  const posterBody = resolvePosterBody(promo);
  const posterDetailsShort = posterBody.trim().slice(0, 560);
  const trademe = promo?.trademe_url?.trim() ?? null;
  const rankedImages = collectPosterImageUrls(promo, 12);
  const posterImageUrls = rankedImages.slice(0, 3);
  const listingAgentName = promo?.listing_agent_name?.trim() ?? posterContact?.name?.trim() ?? null;
  const listingAgentCompany = promo?.listing_agent_company?.trim() ?? null;
  const listingAgentPhotoUrl = promo?.listing_agent_photo_url?.trim() ?? null;
  const listingAgentPhone = promo?.listing_agent_phone?.trim() || contact?.phone?.trim() || null;

  let listingQrDataUrl: string | null = null;
  if (trademe?.startsWith("http://") || trademe?.startsWith("https://")) {
    try {
      listingQrDataUrl = await listingUrlToQrDataUrl(trademe);
    } catch {
      listingQrDataUrl = null;
    }
  }

  const noticeRaw = searchParams.notice;
  const notice = typeof noticeRaw === "string" ? noticeRaw : undefined;
  const posterDebugRaw = searchParams.poster_debug;
  const showPosterDebug =
    typeof posterDebugRaw === "string" && (posterDebugRaw === "1" || posterDebugRaw.toLowerCase() === "true");
  const posterNotice = notice ? (POSTER_NOTICE_COPY[notice] ?? null) : null;
  const importExtractLayer = normalizeExtractLayerParam(searchParams.extract_layer);
  const listingDerivedPrompt = buildPosterLlmPromptSuggestionFromPromo(promo);
  const readiness = assessPropertyPosterReadiness({
    headline,
    posterBody,
    imageUrls: rankedImages,
    projectName: project.name,
    listingAddress: promo?.listing_address ?? null,
    hasTrademeUrl: Boolean(trademe),
  });

  return (
    <div>
      <div className="poster-no-print mb-6">
        <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">Promotion poster</h1>
        <p className="mt-1 max-w-xl text-sm text-stone-600">
          海报内容<strong>只来自</strong>项目里已保存的房源资料（TradeMe 导入或手工填写）。若导入失败或字段为空，版面上就会缺图、缺地址——这不是“生成失败”，而是<strong>没有数据可渲染</strong>。扫码可在 TradeMe 上查看完整信息。
        </p>
        {!showPosterDebug ? (
          <p className="mt-2 text-xs text-stone-500">
            技术排查：在 URL 后加 <code className="rounded bg-stone-100 px-1">?poster_debug=1</code> 可展开「7 块字段」数据源检查。
          </p>
        ) : null}
        {readiness.level === "weak" ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold text-amber-950">当前预览仅为草稿，不适合作为开放日/朋友圈可发放海报</p>
            <p className="mt-2 text-amber-900/95">
              可发布级物料通常需要：实拍主图、可读标题（地址或卖点）、价格或议价说明、卧室卫浴、开放日与合规表述、清晰的中介与联系方式。以下为系统检测到的缺口：
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-amber-900/95">
              {readiness.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-amber-900/90">
              请到项目页「Business details / 房源推广」补全标题、主图与描述，或换一条抓取更完整的 TradeMe
              链接后重新导入；再使用下方「提示词建议」交给外部工具精修版式与文案。
            </p>
          </div>
        ) : null}
        {posterNotice && !(notice === "listing_imported" && readiness.level === "weak") ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{posterNotice}</p>
        ) : notice === "listing_imported" && readiness.level === "weak" ? (
          <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
            导入流程已结束并写入了当前能解析到的字段；在补齐上述缺口前，请勿把本页当作定稿对外发放。
          </p>
        ) : null}
        {notice === "listing_imported" && importExtractLayer ? (
          <p className="mt-2 text-xs text-stone-600">{extractLayerUserLabel(importExtractLayer)}</p>
        ) : null}
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/app/poster-from-trademe" className="font-medium text-emerald-800 underline hover:text-emerald-950">
            免微站：再贴一条 TradeMe → 海报
          </Link>
          <Link href={`/app/projects/${project.id}/trademe-poster`} className="text-stone-600 underline hover:text-stone-900">
            本项目内 TradeMe 导入
          </Link>
        </p>
        <PosterPrintBar />
        {showPosterDebug ? (
          <PosterMappingDebugPanel
            headlineDisplay={headline}
            listingAddress={promo?.listing_address?.trim() ?? null}
            posterImageUrls={posterImageUrls}
            totalRankedImages={rankedImages.length}
            listingPriceHint={promo?.listing_price_hint?.trim() ?? null}
            listingBedrooms={promo?.listing_bedrooms ?? null}
            listingBathrooms={promo?.listing_bathrooms ?? null}
            shortDetails={posterDetailsShort}
            detailsSourceLabel={posterDetailsSourceLabel(promo)}
            agentName={listingAgentName}
            agentCompany={listingAgentCompany}
            agentPhone={listingAgentPhone}
            agentPhotoUrl={listingAgentPhotoUrl}
            trademeUrl={trademe}
          />
        ) : null}
        <PosterPromptPanel
          templateId={templateId}
          listingDerivedPrompt={listingDerivedPrompt}
          projectEditHref={`/app/projects/${project.id}`}
        />
      </div>

      <PosterDesignedLayout
        templateId={templateId}
        headline={headline}
        details={posterDetailsShort}
        imageUrls={posterImageUrls}
        listingAddress={promo?.listing_address?.trim() ?? null}
        listingPriceHint={promo?.listing_price_hint?.trim() ?? null}
        listingBedrooms={promo?.listing_bedrooms ?? null}
        listingBathrooms={promo?.listing_bathrooms ?? null}
        posterLocale={promo?.poster_locale === "en" ? "en" : "zh"}
        contact={contact}
        listingQrDataUrl={listingQrDataUrl}
        listingAgentName={listingAgentName}
        listingAgentCompany={listingAgentCompany}
        listingAgentPhone={listingAgentPhone}
        listingAgentPhotoUrl={listingAgentPhotoUrl}
        brandLogoUrl={mp?.logo_url?.trim() ?? null}
        wechatQrUrl={posterContact?.wechat_qr_url ?? null}
        whatsappUrl={posterContact?.whatsapp_url ?? null}
      />
    </div>
  );
}
