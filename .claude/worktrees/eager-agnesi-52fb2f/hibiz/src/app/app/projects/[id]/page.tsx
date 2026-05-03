import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { compileIntentFromForm } from "../intent-actions";
import { publishProjectFromForm } from "../publish-actions";
import { updateHeroDraftFromForm } from "../draft-hero-actions";
import { updateMerchantProfileFromForm } from "../merchant-profile-actions";
import { BuilderMicrositeSection } from "@/components/builder/BuilderMicrositeSection";
import { BuilderIntegrationCard } from "@/components/builder/BuilderIntegrationCard";
import { createWebsiteBuilderDraftFromForm } from "../website-builder-actions";
import { ImportTradeMeButton } from "./import-trademe-button";
import { POSTER_TEMPLATES } from "@/data/poster-templates";
import { GenerateMicrositeForm } from "../generate-microsite-form";
import { isCompiledIntentV1 } from "@/lib/compiler/guards";
import { SCENE_LABELS } from "@/lib/compiler/scene-labels";
import type { ClarificationPayload } from "@/types/compiled-intent";
import { isRenderModelV1 } from "@/types/render-model";
import { RenderMicrosite } from "@/components/microsite/RenderMicrosite";
import { isFormFieldsFileV1 } from "@/lib/generation/form-presets";
import { safeExternalImageUrl } from "@/lib/merchant-profile/render-merge";
import { parseMerchantProfile } from "@/types/merchant-profile";
import { getSkeletonById } from "@/data/skeletons";
import { SkeletonPreviewPanel } from "@/components/skeleton-preview-panel";
import { FormPendingHint, FormSubmitPendingButton } from "@/components/ui/form-submit-pending";
import { ProjectCompileV2Card } from "@/components/project-compile-v2-card";
import { parseCompiledIntentV2 } from "@/types/compiled-intent-v2";
import { extractLayerUserLabel, normalizeExtractLayerParam } from "@/lib/extraction/extract-layer-ui";

interface ProjectDetailPageProps {
  params: { id: string };
  searchParams: { notice?: string; preview?: string; missing?: string; extract_layer?: string | string[] };
}

function isClarification(data: unknown): data is ClarificationPayload {
  if (!data || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.schema_version === 1 && Array.isArray(o.questions);
}

const INDUSTRY_LABEL: Record<string, string> = {
  real_estate: "Real estate",
  immigration_education: "Immigration & education",
};

/** Long-running OpenAI server action — raise on Vercel if needed. */
export const maxDuration = 120;

/** 避免抓取 TradeMe 后仍读到缓存的 merchant_profile */
export const dynamic = "force-dynamic";

const NOTICE_COPY: Record<string, string> = {
  generated: "Microsite draft generated. Open preview below.",
  gen_error: "Generation failed. Check OPENAI_API_KEY / billing / model name, then try again.",
  missing_openai: "Add OPENAI_API_KEY to .env.local and restart dev.",
  bad_state: "Project is not ready to generate from this state.",
  no_intent: "Compile the intent first (must be succeeded).",
  published: "Live site is published. Share the public links below.",
  publish_bad_state: "Publish only works once a draft exists and the project is ready.",
  publish_no_draft: "No valid draft to publish. Generate a microsite first.",
  publish_error: "Could not publish. Try again or check Supabase permissions.",
  hero_saved: "Hero section updated in your draft. Open preview to check; republish to update the live site.",
  hero_title_required: "Hero title cannot be empty.",
  hero_no_draft: "No draft microsite to edit.",
  hero_no_module: "No hero block found in the draft.",
  hero_save_error: "Could not save hero text. Try again.",
  merchant_saved: "Business details saved. They appear on the contact section and poster; republish to refresh the live site.",
  merchant_no_microsite: "Generate a microsite first, then add business details.",
  merchant_save_error: "Could not save business details. Try again.",
  builder_saved: "Builder.io 区块设置已保存。打开草稿预览或公开页查看。",
  builder_save_error: "无法保存 Builder 设置，请重试。",
  builder_no_microsite: "请先生成微站草稿，再配置 Builder。",
  builder_bootstrap_ready: "在线建站草稿已创建：Builder 模式已开启，可直接预览并开始编辑。",
  builder_bootstrap_error: "在线建站初始化失败，请重试。",
  trademe_no_url: "请先在「TradeMe listing URL」里粘贴房源链接（可直接点导入，成功后会写入资料；若仍提示此项说明输入框为空）。",
  listing_import_fail:
    "未能从链接提取房源信息。请确认链接为 trademe.co.nz 房源页；服务器需 OPENAI_API_KEY（及建议 JINA_API_KEY）。也可在下方手动填写。",
  listing_imported: "已从链接导入房源信息（标题、描述、图片）。可在下方编辑；海报页可查看「提示词建议」。",
  /** 旧书签可能仍带此 notice；已不再拦截写入 */
  listing_extraction_failed: "若仍看到此提示：请重新导入一次。当前版本不再因「质量分」拒绝写入。",
  listing_imported_partial: "已导入房源资料。建议在下方核对后再保存或打印海报。",
};

export default async function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  const supabase = createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, compiled_intent_v2")
    .eq("id", params.id)
    .maybeSingle();

  if (projectError || !project) {
    notFound();
  }

  if (searchParams.preview === "1") {
    const { data: ms } = await supabase
      .from("microsites")
      .select("draft_model, merchant_profile, slug")
      .eq("project_id", params.id)
      .maybeSingle();
    const { data: formForPreview } = await supabase.from("forms").select("fields").eq("project_id", params.id).limit(1).maybeSingle();

    const draft = ms?.draft_model;
    if (!draft || !isRenderModelV1(draft)) {
      return (
        <div className="p-6">
          <Link href={`/app/projects/${project.id}`} className="text-sm text-emerald-800 hover:underline">
            ← Back to project
          </Link>
          <p className="mt-6 text-sm text-stone-600">No draft microsite yet. Generate one from the project page.</p>
        </div>
      );
    }

    const formFields =
      formForPreview?.fields && isFormFieldsFileV1(formForPreview.fields) ? formForPreview.fields : null;

    const previewMerchant = parseMerchantProfile(ms?.merchant_profile);
    const previewSkeleton = previewMerchant?.skeleton_id ? getSkeletonById(previewMerchant.skeleton_id) : undefined;
    const builderUrlPath =
      previewMerchant?.builder_url_path_override?.trim() ||
      (ms?.slug ? `/site/${ms.slug}` : "/site/");
    const showBuilderInPreview = previewMerchant?.builder_section_enabled === true;
    const builderAfterPreview = previewMerchant?.builder_section_position === "after";
    const previewSearchParams = searchParams as unknown as Record<string, string | string[] | undefined>;
    const builderPreviewBlock = showBuilderInPreview ? (
      <BuilderMicrositeSection urlPath={builderUrlPath} searchParams={previewSearchParams} />
    ) : null;

    return (
      <>
        <div className="border-b border-stone-200 bg-white px-4 py-3">
          <Link href={`/app/projects/${project.id}`} className="text-sm font-medium text-emerald-800 hover:underline">
            ← Back to {project.name}
          </Link>
        </div>
        {previewSkeleton && previewMerchant ? (
          <SkeletonPreviewPanel projectId={project.id} skeleton={previewSkeleton} profile={previewMerchant} />
        ) : null}
        {!builderAfterPreview ? builderPreviewBlock : null}
        <RenderMicrosite
          model={draft}
          formFields={formFields}
          preview
          merchantProfile={previewMerchant}
          editableProjectId={previewMerchant?.skeleton_id ? project.id : null}
        />
        {builderAfterPreview ? builderPreviewBlock : null}
      </>
    );
  }

  const { data: microsite } = await supabase
    .from("microsites")
    .select("slug, draft_model, published_at, merchant_profile")
    .eq("project_id", params.id)
    .maybeSingle();

  const { data: formRow } = await supabase.from("forms").select("public_slug").eq("project_id", params.id).limit(1).maybeSingle();

  const { data: intents } = await supabase
    .from("project_intents")
    .select(
      "id, revision, raw_prompt, industry_hint, compile_status, compiled, clarification, confirmed_at, created_at, compiler_version",
    )
    .eq("project_id", params.id)
    .order("revision", { ascending: false });

  const latestIntent = intents?.[0] ?? null;
  const compiledIntentV2 = parseCompiledIntentV2(project.compiled_intent_v2);
  const compiled =
    latestIntent?.compiled && isCompiledIntentV1(latestIntent.compiled) ? latestIntent.compiled : null;
  const clarification =
    latestIntent?.clarification && isClarification(latestIntent.clarification)
      ? latestIntent.clarification
      : null;

  const canAnalyse =
    latestIntent &&
    (latestIntent.compile_status === "pending" || latestIntent.compile_status === "failed");

  const canGenerate =
    compiled &&
    latestIntent?.compile_status === "succeeded" &&
    ["intent_ready", "generation_failed", "ready_draft", "generating"].includes(project.status);

  const hasDraftMicrosite = microsite?.draft_model && isRenderModelV1(microsite.draft_model);
  const merchantProfile = parseMerchantProfile(microsite?.merchant_profile);
  const isPublished = project.status === "published" && Boolean(microsite?.published_at);
  const canPublish =
    hasDraftMicrosite && (project.status === "ready_draft" || project.status === "published");
  const draftForEdit =
    hasDraftMicrosite && microsite?.draft_model && isRenderModelV1(microsite.draft_model)
      ? microsite.draft_model
      : null;
  const heroForEdit = draftForEdit?.modules.find((m) => m.type === "hero");
  const heroPreviewUrl =
    safeExternalImageUrl(merchantProfile?.hero_image_url) ??
    safeExternalImageUrl(merchantProfile?.property_promo?.image_url);

  let notice: string | null = null;
  if (searchParams.notice) {
    const key = searchParams.notice;
    notice = NOTICE_COPY[key] ?? null;
  }
  const importExtractLayer = normalizeExtractLayerParam(searchParams.extract_layer);

  const noticeIsError =
    searchParams.notice === "gen_error" ||
    searchParams.notice === "missing_openai" ||
    searchParams.notice === "bad_state" ||
    searchParams.notice === "publish_bad_state" ||
    searchParams.notice === "publish_no_draft" ||
    searchParams.notice === "publish_error" ||
    searchParams.notice === "hero_title_required" ||
    searchParams.notice === "hero_no_draft" ||
    searchParams.notice === "hero_no_module" ||
    searchParams.notice === "hero_save_error" ||
    searchParams.notice === "merchant_no_microsite" ||
    searchParams.notice === "merchant_save_error" ||
    searchParams.notice === "builder_save_error" ||
    searchParams.notice === "builder_bootstrap_error" ||
    searchParams.notice === "listing_import_fail";

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← Projects
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">{project.name}</h1>
          <p className="mt-1 text-sm uppercase tracking-wide text-stone-500">{project.status}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={createWebsiteBuilderDraftFromForm}>
            <input type="hidden" name="project_id" value={project.id} />
            <FormSubmitPendingButton
              pendingLabel="启用中…"
              className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 shadow-sm hover:bg-violet-100"
            >
              启用在线建站（Builder）
            </FormSubmitPendingButton>
            <FormPendingHint>正在写入草稿与 Builder 占位，请勿重复点击。</FormPendingHint>
          </form>
          {hasDraftMicrosite ? (
            <Link
              href={`/app/projects/${project.id}/leads`}
              className="shrink-0 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm hover:bg-stone-50"
            >
              Submissions →
            </Link>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
            noticeIsError ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-950"
          }`}
        >
          {notice}
          {importExtractLayer ? (
            <p className={`mt-2 text-xs ${noticeIsError ? "text-red-800/90" : "text-emerald-900/85"}`}>
              {extractLayerUserLabel(importExtractLayer)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 1: Compile Intent with v0.4 Hybrid Engine */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="workflow-compile-v2" className="scroll-mt-28">
        <div className="mb-3">
          <div className="inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
            STEP 1 — Compile Intent
          </div>
        </div>
        <ProjectCompileV2Card
          projectId={project.id}
          rawPrompt={latestIntent?.raw_prompt ?? ""}
          savedIntent={compiledIntentV2}
        />
      </section>

      {compiledIntentV2?.user_confirmed ? (
        <section id="workflow-generate" className="scroll-mt-28 mt-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-3">
            <div className="inline-block rounded-full bg-stone-900 px-3 py-1 text-xs font-semibold text-white">
              Generate draft
            </div>
          </div>
          <h2 className="font-display text-lg font-semibold text-stone-900">生成网站草稿</h2>
          <p className="mt-1 text-sm text-stone-600">
            意图已确认。使用已保存的 v0.4 意图与 V1 编译结果调用 OpenAI（需先完成「Analyse」且 intent 为 succeeded）。
          </p>
          <div className="mt-6">
            <GenerateMicrositeForm projectId={project.id} isRegenerate={project.status === "ready_draft"} />
          </div>
        </section>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 2: Intent Draft (Raw Input) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section
        id="workflow-intent"
        className="scroll-mt-28 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-4">
          <div className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            STEP 2 — Intent Input
          </div>
        </div>
        <h2 className="font-display text-lg font-semibold text-stone-800">Intent draft</h2>
        {latestIntent ? (
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-stone-500">Raw prompt</dt>
              <dd className="mt-1 whitespace-pre-wrap text-stone-800">{latestIntent.raw_prompt}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Industry hint</dt>
              <dd className="mt-1 text-stone-800">{latestIntent.industry_hint ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Compile status</dt>
              <dd className="mt-1 text-stone-800">{latestIntent.compile_status}</dd>
            </div>
            {latestIntent.compiler_version ? (
              <div>
                <dt className="text-stone-500">Compiler</dt>
                <dd className="mt-1 font-mono text-xs text-stone-600">{latestIntent.compiler_version}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-stone-600">No intent saved.</p>
        )}

        {canAnalyse ? (
          <form action={compileIntentFromForm} className="mt-6">
            <input type="hidden" name="project_id" value={project.id} />
            <FormSubmitPendingButton
              pendingLabel="分析中…"
              className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              Analyse my request
            </FormSubmitPendingButton>
            <FormPendingHint className="mt-2 text-xs font-medium text-amber-800">规则编译中，通常几秒内完成。</FormPendingHint>
            <p className="mt-2 text-xs text-stone-500">Runs the rule-based compiler (no LLM).</p>
          </form>
        ) : null}

        {clarification && latestIntent?.compile_status === "needs_clarification" ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">We need your choice</p>
            <ul className="mt-2 space-y-3">
              {clarification.questions.map((q) => (
                <li key={q.id}>
                  <p>{q.prompt}</p>
                  <ul className="mt-1 list-inside list-disc text-amber-900/90">
                    {q.options.map((o) => (
                      <li key={o.value}>{o.label}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-amber-900/80">Adjust your description or create a new project — interactive picks coming next.</p>
          </div>
        ) : null}

        {compiled ? (
          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
            <h3 className="font-display text-base font-semibold text-emerald-950">What we understood</h3>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-emerald-800/80">Industry</dt>
                <dd className="mt-0.5 font-medium text-stone-900">{INDUSTRY_LABEL[compiled.industry] ?? compiled.industry}</dd>
              </div>
              <div>
                <dt className="text-emerald-800/80">Page type</dt>
                <dd className="mt-0.5 font-medium text-stone-900">{SCENE_LABELS[compiled.scene] ?? compiled.scene}</dd>
              </div>
              <div>
                <dt className="text-emerald-800/80">City / region</dt>
                <dd className="mt-0.5 font-medium text-stone-900">{compiled.city ?? "Not detected (default NZ)"}</dd>
              </div>
              <div>
                <dt className="text-emerald-800/80">Language</dt>
                <dd className="mt-0.5 font-medium text-stone-900">
                  {compiled.language_mode === "en_bilingual_zh" ? "English + key Chinese" : "English"}
                </dd>
              </div>
              <div>
                <dt className="text-emerald-800/80">Lead form</dt>
                <dd className="mt-0.5 font-medium text-stone-900">{compiled.needs_form ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-emerald-800/80">Goal</dt>
                <dd className="mt-0.5 font-medium text-stone-900">{compiled.goal.replace(/_/g, " ")}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {canGenerate && !compiledIntentV2?.user_confirmed ? (
          <div className="mt-8">
            <GenerateMicrositeForm projectId={project.id} isRegenerate={project.status === "ready_draft"} />
          </div>
        ) : null}

        {hasDraftMicrosite ? (
          <div
            id="workflow-preview"
            className="mt-10 scroll-mt-28 rounded-xl border border-stone-200 bg-stone-50/80 p-5"
          >
            <h3 className="font-display text-base font-semibold text-stone-900">Result package</h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <span className="text-stone-500">Draft preview (logged in)</span>
                <div className="mt-1">
                  <Link
                    href={`/app/projects/${project.id}?preview=1`}
                    className="font-medium text-emerald-800 underline hover:text-emerald-950"
                  >
                    Open preview →
                  </Link>
                </div>
              </li>
              <li>
                <span className="text-stone-500">Site slug</span>
                <div className="mt-1 font-mono text-stone-800">{microsite?.slug}</div>
              </li>
              {isPublished && microsite?.slug && formRow?.public_slug ? (
                <>
                  <li>
                    <span className="text-stone-500">Public microsite</span>
                    <div className="mt-1 break-all">
                      <Link href={`/site/${microsite.slug}`} className="font-medium text-emerald-800 underline hover:text-emerald-950">
                        /site/{microsite.slug}
                      </Link>
                    </div>
                  </li>
                  <li>
                    <span className="text-stone-500">Standalone form</span>
                    <div className="mt-1 break-all">
                      <Link
                        href={`/forms/${formRow.public_slug}`}
                        className="font-medium text-emerald-800 underline hover:text-emerald-950"
                      >
                        /forms/{formRow.public_slug}
                      </Link>
                    </div>
                  </li>
                </>
              ) : (
                <li>
                  <span className="text-stone-500">Standalone form slug</span>
                  <div className="mt-1 font-mono text-stone-800">{formRow?.public_slug ?? "—"}</div>
                  <p className="mt-1 text-xs text-stone-500">Activates when you publish the site.</p>
                </li>
              )}
            </ul>
            {canPublish ? (
              <form action={publishProjectFromForm} className="mt-6 flex flex-wrap items-center gap-3">
                <input type="hidden" name="project_id" value={project.id} />
                <FormSubmitPendingButton
                  pendingLabel={isPublished ? "正在更新线上站点…" : "正在发布…"}
                  className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
                >
                  {isPublished ? "Update live site from draft" : "Publish (go live)"}
                </FormSubmitPendingButton>
                <FormPendingHint className="w-full text-xs font-medium text-amber-800">
                  正在复制草稿到公开页，请勿重复点击。
                </FormPendingHint>
                <p className="w-full text-xs text-stone-500">
                  Copies the current draft to the public page and enables the lead form for visitors.
                </p>
              </form>
            ) : null}
            <BuilderIntegrationCard
              projectId={project.id}
              siteSlug={microsite?.slug ?? ""}
              merchantProfile={merchantProfile}
            />
          </div>
        ) : null}

        {hasDraftMicrosite ? (
          <div className="mt-10 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="font-display text-base font-semibold text-stone-900">Hero 背景图</h3>
            <p className="mt-1 text-sm text-stone-500">
              专用 Hero 图优先于房源推广图显示在预览与站点顶部。可在素材库搜索 Unsplash 并点「应用到 Hero」。
            </p>
            {heroPreviewUrl ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroPreviewUrl} alt="" className="max-h-48 w-full object-cover" />
              </div>
            ) : (
              <p className="mt-4 text-sm text-stone-500">尚未设置 Hero 图；也可用下方房源推广图作为后备。</p>
            )}
            <Link
              href={`/app/projects/${project.id}/media`}
              className="mt-3 inline-block text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
            >
              🖼️ 打开素材库选择或搜索 Unsplash →
            </Link>
          </div>
        ) : null}

        {draftForEdit && heroForEdit && heroForEdit.type === "hero" ? (
          <div className="mt-10 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="font-display text-base font-semibold text-stone-900">Quick edit — hero (draft)</h3>
            <p className="mt-1 text-sm text-stone-500">
              Adjust headline copy without regenerating. Live site updates only after you <strong>republish</strong>.
            </p>
            <form action={updateHeroDraftFromForm} className="mt-6 grid max-w-xl gap-4 text-sm">
              <input type="hidden" name="project_id" value={project.id} />
              <div>
                <label htmlFor="hero_eyebrow" className="block font-medium text-stone-700">
                  Eyebrow
                </label>
                <input
                  id="hero_eyebrow"
                  name="hero_eyebrow"
                  defaultValue={heroForEdit.content.eyebrow ?? ""}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                  maxLength={120}
                />
              </div>
              <div>
                <label htmlFor="hero_title" className="block font-medium text-stone-700">
                  Title <span className="text-red-600">*</span>
                </label>
                <input
                  id="hero_title"
                  name="hero_title"
                  defaultValue={heroForEdit.content.title}
                  required
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                  maxLength={200}
                />
              </div>
              <div>
                <label htmlFor="hero_subtitle" className="block font-medium text-stone-700">
                  Subtitle
                </label>
                <textarea
                  id="hero_subtitle"
                  name="hero_subtitle"
                  defaultValue={heroForEdit.content.subtitle}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                  maxLength={600}
                />
              </div>
              <div>
                <label htmlFor="hero_subtitle_secondary" className="block font-medium text-stone-700">
                  Secondary subtitle (optional)
                </label>
                <textarea
                  id="hero_subtitle_secondary"
                  name="hero_subtitle_secondary"
                  defaultValue={heroForEdit.content.subtitle_secondary ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                  maxLength={400}
                />
              </div>
              <div>
                <label htmlFor="hero_primary_cta" className="block font-medium text-stone-700">
                  Primary button label
                </label>
                <input
                  id="hero_primary_cta"
                  name="hero_primary_cta"
                  defaultValue={heroForEdit.content.primary_cta_label}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                  maxLength={80}
                />
              </div>
              <FormSubmitPendingButton
                pendingLabel="保存中…"
                className="w-fit rounded-lg border border-stone-300 bg-stone-50 px-5 py-2.5 font-semibold text-stone-900 hover:bg-stone-100"
              >
                Save hero
              </FormSubmitPendingButton>
              <FormPendingHint className="text-xs font-medium text-amber-800">正在写入草稿 Hero 文案。</FormPendingHint>
            </form>
          </div>
        ) : null}

        {hasDraftMicrosite ? (
          <div
            id="workflow-merchant"
            className="mt-10 scroll-mt-28 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
          >
            <h3 className="font-display text-base font-semibold text-stone-900">Business details</h3>
            <p className="mt-1 text-sm text-stone-500">
              Contact lines replace the AI placeholder on your public page&apos;s Contact block. No listing feed — for
              property promos use the fields below (real estate) or your hero image URL.
            </p>
            <form action={updateMerchantProfileFromForm} className="mt-6 grid max-w-xl gap-4 text-sm">
              <input type="hidden" name="project_id" value={project.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="contact_phone" className="block font-medium text-stone-700">
                    Phone
                  </label>
                  <input
                    id="contact_phone"
                    name="contact_phone"
                    defaultValue={merchantProfile?.contact?.phone ?? ""}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                    maxLength={40}
                    autoComplete="tel"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="contact_email" className="block font-medium text-stone-700">
                    Email
                  </label>
                  <input
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    defaultValue={merchantProfile?.contact?.email ?? ""}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                    maxLength={200}
                    autoComplete="email"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="contact_address" className="block font-medium text-stone-700">
                    Address
                  </label>
                  <textarea
                    id="contact_address"
                    name="contact_address"
                    defaultValue={merchantProfile?.contact?.address ?? ""}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                    maxLength={500}
                  />
                </div>
              </div>

              {compiled?.industry === "real_estate" ? (
                <div className="mt-2 border-t border-stone-100 pt-6">
                  <h4 className="font-display text-sm font-semibold text-stone-900">Property promotion &amp; poster</h4>
                  <p className="mt-1 text-xs text-stone-500">
                    Paste an image URL (https), short copy, and your TradeMe ad link. Generates a printable A4-style poster
                    — we do not import listings automatically.
                  </p>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label htmlFor="promo_headline" className="block font-medium text-stone-700">
                        Headline
                      </label>
                      <input
                        id="promo_headline"
                        name="promo_headline"
                        defaultValue={merchantProfile?.property_promo?.headline ?? ""}
                        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        maxLength={200}
                      />
                      <p className="mt-1 text-xs text-stone-400">应与 TradeMe 页标题一致（导入会自动写入）。</p>
                    </div>
                    <div>
                      <label htmlFor="listing_address" className="block font-medium text-stone-700">
                        房源地址（海报首行，与标题分列）
                      </label>
                      <textarea
                        id="listing_address"
                        name="listing_address"
                        defaultValue={merchantProfile?.property_promo?.listing_address ?? ""}
                        rows={2}
                        maxLength={500}
                        placeholder="例：118 Robinsons Road, Prebbleton, Selwyn, Canterbury"
                        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label htmlFor="listing_price_hint" className="block font-medium text-stone-700">
                          标价 / 议价（可选）
                        </label>
                        <input
                          id="listing_price_hint"
                          name="listing_price_hint"
                          defaultValue={merchantProfile?.property_promo?.listing_price_hint ?? ""}
                          maxLength={160}
                          placeholder="Asking price $3,300,000"
                          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        />
                      </div>
                      <div>
                        <label htmlFor="listing_bedrooms" className="block font-medium text-stone-700">
                          卧室数
                        </label>
                        <input
                          id="listing_bedrooms"
                          name="listing_bedrooms"
                          type="number"
                          min={0}
                          max={99}
                          defaultValue={
                            merchantProfile?.property_promo?.listing_bedrooms != null
                              ? String(merchantProfile.property_promo.listing_bedrooms)
                              : ""
                          }
                          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        />
                      </div>
                      <div>
                        <label htmlFor="listing_bathrooms" className="block font-medium text-stone-700">
                          卫生间数
                        </label>
                        <input
                          id="listing_bathrooms"
                          name="listing_bathrooms"
                          type="number"
                          min={0}
                          max={99}
                          defaultValue={
                            merchantProfile?.property_promo?.listing_bathrooms != null
                              ? String(merchantProfile.property_promo.listing_bathrooms)
                              : ""
                          }
                          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="promo_details" className="block font-medium text-stone-700">
                        Property details（原始文案 / 回退）
                      </label>
                      <textarea
                        id="promo_details"
                        name="promo_details"
                        defaultValue={merchantProfile?.property_promo?.details ?? ""}
                        rows={5}
                        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        maxLength={2000}
                      />
                      <p className="mt-1 text-xs text-stone-400">
                        海报优先展示下方语言对应的「导入摘要」；若摘要为空则回退到本框。可手工改。
                      </p>
                    </div>
                    <div>
                      <label htmlFor="promo_image_url" className="block font-medium text-stone-700">
                        Image URL (https)
                      </label>
                      <input
                        id="promo_image_url"
                        name="promo_image_url"
                        defaultValue={merchantProfile?.property_promo?.image_url ?? ""}
                        placeholder="https://…"
                        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        maxLength={2000}
                      />
                      <p className="mt-1 text-xs text-stone-400">Shown in hero + poster. Direct file upload coming later.</p>
                    </div>
                    <div>
                      <label htmlFor="promo_trademe_url" className="block font-medium text-stone-700">
                        TradeMe listing URL (optional)
                      </label>
                      <input
                        id="promo_trademe_url"
                        name="promo_trademe_url"
                        defaultValue={merchantProfile?.property_promo?.trademe_url ?? ""}
                        placeholder="https://www.trademe.co.nz/…"
                        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                        maxLength={500}
                      />
                      <p className="mt-1 text-xs text-stone-400">
                        可直接点下方抓取（会读当前输入框里的链接并写回资料）；在「保存 business details」里修改链接会清空已缓存图片。
                      </p>
                    </div>
                    <div>
                      <label htmlFor="poster_template_id" className="block font-medium text-stone-700">
                        海报模板
                      </label>
                      <select
                        id="poster_template_id"
                        name="poster_template_id"
                        defaultValue={merchantProfile?.property_promo?.poster_template_id ?? "coastal_editorial"}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                      >
                        {POSTER_TEMPLATES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-stone-500">
                        「多图画廊」适合 TradeMe 多图自动排列；极简款以大主图为重。
                      </p>
                    </div>
                    <div>
                      <label htmlFor="poster_locale" className="block font-medium text-stone-700">
                        海报摘要语言（打印）
                      </label>
                      <select
                        id="poster_locale"
                        name="poster_locale"
                        defaultValue={merchantProfile?.property_promo?.poster_locale ?? "zh"}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-emerald-800"
                      >
                        <option value="zh">中文要点</option>
                        <option value="en">English highlights</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-stone-100 bg-stone-50/80 p-4">
                      <p className="text-xs font-medium text-stone-600">中介展示（海报，可手工覆盖导入结果）</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor="listing_agent_name" className="text-xs font-medium text-stone-600">
                            姓名
                          </label>
                          <input
                            id="listing_agent_name"
                            name="listing_agent_name"
                            defaultValue={merchantProfile?.property_promo?.listing_agent_name ?? ""}
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
                            maxLength={120}
                            placeholder="Ray Deng"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="listing_agent_company" className="text-xs font-medium text-stone-600">
                            中介公司
                          </label>
                          <input
                            id="listing_agent_company"
                            name="listing_agent_company"
                            defaultValue={merchantProfile?.property_promo?.listing_agent_company ?? ""}
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
                            maxLength={120}
                          />
                        </div>
                        <div>
                          <label htmlFor="listing_agent_phone" className="text-xs font-medium text-stone-600">
                            联系电话（海报优先）
                          </label>
                          <input
                            id="listing_agent_phone"
                            name="listing_agent_phone"
                            defaultValue={merchantProfile?.property_promo?.listing_agent_phone ?? ""}
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
                            maxLength={40}
                            autoComplete="tel"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="listing_agent_photo_url" className="text-xs font-medium text-stone-600">
                            头像图片 URL（https）
                          </label>
                          <input
                            id="listing_agent_photo_url"
                            name="listing_agent_photo_url"
                            defaultValue={merchantProfile?.property_promo?.listing_agent_photo_url ?? ""}
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs text-stone-900"
                            maxLength={2000}
                            placeholder="https://…"
                          />
                          <p className="mt-1 text-[11px] text-stone-400">可从房源页复制中介头像链接；暂无本地上传。</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <ImportTradeMeButton projectId={project.id} trademeInputId="promo_trademe_url" />
                    {merchantProfile?.property_promo?.trademe_image_urls?.length ? (
                      <span className="text-xs text-stone-600">
                        已缓存 {merchantProfile.property_promo.trademe_image_urls.length} 张图（用于海报宫格）
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">尚未缓存 TradeMe 图片</span>
                    )}
                  </div>
                  {merchantProfile?.property_promo?.trademe_image_urls &&
                  merchantProfile.property_promo.trademe_image_urls.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <p className="w-full text-[11px] text-stone-500">预览（若裂图多为 CDN 防盗链，可换「多图画廊」或手动主图 URL）：</p>
                      {merchantProfile.property_promo.trademe_image_urls.slice(0, 8).map((src) => (
                        <div
                          key={src}
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link
                      href={`/app/projects/${project.id}/trademe-poster`}
                      className="text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
                    >
                      TradeMe → 要点 → 海报（快捷页）→
                    </Link>
                    <Link
                      href={`/app/projects/${project.id}/poster`}
                      className="text-sm font-medium text-stone-600 underline hover:text-stone-900"
                    >
                      Open printable poster →
                    </Link>
                  </div>
                </div>
              ) : null}

              <FormSubmitPendingButton
                pendingLabel="保存中…"
                className="w-fit rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
              >
                Save business details
              </FormSubmitPendingButton>
              <FormPendingHint className="text-xs font-medium text-amber-800">
                正在写入商家资料；若含 TradeMe 图床代理，可能需十余秒，请勿重复点击。
              </FormPendingHint>
            </form>
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-700">
          <p className="font-medium text-stone-800">Pipeline</p>
          {compiled && !hasDraftMicrosite ? (
            <p className="mt-1">Use <strong>Generate microsite</strong> to call OpenAI and write <code className="rounded bg-stone-200 px-1">draft_model</code>.</p>
          ) : compiled && hasDraftMicrosite ? (
            <p className="mt-1">
              {isPublished
                ? "Live site is up — open public links above or republish after edits."
                : "Draft is ready — publish when you want visitors to see it and submit leads."}
            </p>
          ) : latestIntent?.compile_status === "needs_clarification" ? (
            <p className="mt-1">Resolve the questions above, then compile again.</p>
          ) : (
            <p className="mt-1">Run <strong>Analyse my request</strong> first.</p>
          )}
        </div>
      </section>
    </div>
  );
}
