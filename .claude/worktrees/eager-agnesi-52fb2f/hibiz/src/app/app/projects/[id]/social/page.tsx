import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SocialPostWorkspace } from "@/components/social/SocialPostWorkspace";
import { FormPendingHint, FormSubmitPendingButton } from "@/components/ui/form-submit-pending";
import { generateSocialPost } from "@/app/app/projects/social-actions";
import { parseMerchantProfile } from "@/types/merchant-profile";
import {
  isSocialContentType,
  parseSocialCaptionsV1,
  SOCIAL_CONTENT_TYPES,
  type SocialContentType,
} from "@/types/social-content";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

interface SocialPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

const NOTICE_COPY: Record<string, string> = {
  gen_error: "生成失败，请检查 OPENAI_API_KEY 或稍后重试。",
  save_error: "保存失败，请重试。",
  poster_saved: "海报已上传到云端。",
  poster_no_post: "找不到对应的社媒记录。",
  poster_no_file: "请选择有效的图片文件。",
  poster_invalid: "图片未通过校验（仅支持 JPEG / PNG / WebP）。",
  poster_upload_error: "上传到存储失败，请重试。",
};

const CARD_COPY: { type: SocialContentType; title: string; subtitle: string }[] = [
  { type: "just_listed", title: "新上市", subtitle: "Just listed" },
  { type: "just_sold", title: "已成交", subtitle: "Just sold" },
  { type: "open_home", title: "开放看房", subtitle: "Open home" },
  { type: "market_update", title: "市场快报", subtitle: "Market update" },
  { type: "buying_tips", title: "买房贴士", subtitle: "Buying tips" },
];

export default async function ProjectSocialPage({ params, searchParams }: SocialPageProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();
  if (!project) {
    notFound();
  }

  const noticeRaw = searchParams.notice;
  const notice = typeof noticeRaw === "string" ? NOTICE_COPY[noticeRaw] ?? null : null;
  const postId = typeof searchParams.post === "string" ? searchParams.post : null;
  const typeRaw = typeof searchParams.type === "string" ? searchParams.type : null;
  const contentType = typeRaw && isSocialContentType(typeRaw) ? typeRaw : null;

  const { data: ms } = await supabase.from("microsites").select("merchant_profile").eq("project_id", params.id).maybeSingle();
  const profile = parseMerchantProfile(ms?.merchant_profile) ?? { schema_version: 1 as const };
  const listings = profile.property_listings ?? [];

  if (postId) {
    const { data: row } = await supabase
      .from("social_posts")
      .select("id, content_type, captions, poster_url")
      .eq("id", postId)
      .eq("project_id", params.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!row || !isSocialContentType(row.content_type)) {
      return (
        <div>
          <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
            ← 所有项目
          </Link>
          <p className="mt-6 text-sm text-stone-600">找不到该社媒草稿，请从类型列表重新生成。</p>
          <Link href={`/app/projects/${params.id}/social`} className="mt-4 inline-block text-sm font-medium text-emerald-800 hover:underline">
            返回社媒
          </Link>
        </div>
      );
    }

    const captions = parseSocialCaptionsV1(row.captions);
    if (!captions) {
      return (
        <div>
          <p className="text-sm text-red-800">文案数据损坏，请重新生成。</p>
          <Link href={`/app/projects/${params.id}/social`} className="mt-4 inline-block text-sm text-emerald-800 hover:underline">
            返回
          </Link>
        </div>
      );
    }

    const tagline =
      profile.property_promo?.headline?.trim() ||
      listings[0]?.name ||
      profile.property_promo?.details?.slice(0, 80) ||
      undefined;

    return (
      <div>
        <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
          ← 所有项目
        </Link>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-stone-900">社媒内容</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/app/projects/${params.id}/social`} className="text-emerald-800 hover:underline">
              新建另一条
            </Link>
            <span className="text-stone-300">|</span>
            <Link href={`/app/projects/${params.id}/social/history`} className="text-emerald-800 hover:underline">
              历史
            </Link>
          </div>
        </div>
        {notice ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-950">{notice}</p> : null}
        {row.poster_url ? (
          <p className="mt-2 text-xs text-stone-500">
            已保存海报：
            <a href={row.poster_url} className="ml-1 text-emerald-800 underline" target="_blank" rel="noreferrer">
              查看链接
            </a>
          </p>
        ) : null}
        <div className="mt-8">
          <SocialPostWorkspace
            projectId={params.id}
            postId={row.id}
            contentType={row.content_type}
            captions={captions}
            profile={profile}
            projectName={project.name}
            tagline={tagline}
          />
        </div>
      </div>
    );
  }

  if (contentType) {
    return (
      <div>
        <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
          ← 所有项目
        </Link>
        <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">生成社媒文案</h1>
        <p className="mt-1 text-sm text-stone-600">
          类型：<span className="font-medium text-stone-800">{CARD_COPY.find((c) => c.type === contentType)?.title ?? contentType}</span>
        </p>
        {notice ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">{notice}</p>
        ) : null}

        <form action={generateSocialPost} className="mt-8 max-w-lg space-y-6">
          <input type="hidden" name="project_id" value={params.id} />
          <input type="hidden" name="content_type" value={contentType} />
          {listings.length > 0 ? (
            <div>
              <label htmlFor="listing_id" className="block text-sm font-medium text-stone-700">
                关联房源（可选）
              </label>
              <select
                id="listing_id"
                name="listing_id"
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                defaultValue=""
              >
                <option value="">不指定（使用商家资料与推广摘要）</option>
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="text-xs text-stone-500">
            将使用当前微站中的商家资料（含中英文简介、推广信息）。生成后可在下一步下载海报与复制各平台文案。
          </p>
          <div className="flex flex-wrap gap-3">
            <FormSubmitPendingButton
              pendingLabel="生成中…"
              className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              生成
            </FormSubmitPendingButton>
            <Link
              href={`/app/projects/${params.id}/social`}
              className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
            >
              取消
            </Link>
          </div>
          <FormPendingHint className="mt-2 text-xs font-medium text-amber-800">
            正在调用 OpenAI，请勿重复点击或关闭页面。
          </FormPendingHint>
        </form>
      </div>
    );
  }

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← 所有项目
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">社媒内容营销</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        选择内容类型，生成中英双语、按平台字数限制的文案；随后可预览海报、下载 PNG、复制文案或上传到项目。
      </p>

      <div className="mt-10 rounded-2xl border border-violet-200 bg-violet-50/80 p-6 shadow-sm">
        <p className="font-display text-lg font-semibold text-violet-950">自然语言 + 自有文件</p>
        <p className="mt-1 text-sm text-violet-900/90">
          写一句话说明要发什么，上传你自己的图片或 .txt/.md，生成 FB / IG / LinkedIn / 小红书文案与配图建议（不自动发帖）。
        </p>
        <Link
          href={`/app/projects/${params.id}/social/nl`}
          className="mt-4 inline-flex rounded-lg bg-violet-800 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-900"
        >
          打开「自然语言」生成器 →
        </Link>
      </div>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARD_COPY.map((c) => (
          <li key={c.type}>
            <Link
              href={`/app/projects/${params.id}/social?type=${c.type}`}
              className="block h-full rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              <p className="font-display text-lg font-semibold text-stone-900">{c.title}</p>
              <p className="mt-1 text-sm text-stone-500">{c.subtitle}</p>
              <p className="mt-4 text-xs font-mono text-stone-400">{c.type}</p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-xs text-stone-400">支持类型：{SOCIAL_CONTENT_TYPES.join(", ")}</p>
    </div>
  );
}
