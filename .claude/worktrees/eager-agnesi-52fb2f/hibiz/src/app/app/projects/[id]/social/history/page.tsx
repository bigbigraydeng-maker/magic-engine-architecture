import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteSocialPost } from "@/app/app/projects/social-actions";
import { isSocialContentType } from "@/types/social-content";

export const dynamic = "force-dynamic";

interface SocialHistoryPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

const TYPE_LABEL: Record<string, string> = {
  just_listed: "新上市",
  just_sold: "已成交",
  open_home: "开放看房",
  market_update: "市场快报",
  buying_tips: "买房贴士",
  nl_upload: "自然语言+素材",
};

export default async function SocialHistoryPage({ params, searchParams }: SocialHistoryPageProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();
  if (!project) {
    notFound();
  }

  const noticeRaw = searchParams.notice;
  const notice =
    typeof noticeRaw === "string"
      ? noticeRaw === "deleted"
        ? "已删除该记录。"
        : noticeRaw === "delete_error"
          ? "删除失败，请重试。"
          : null
      : null;

  const { data: rows } = await supabase
    .from("social_posts")
    .select("id, content_type, poster_url, status, created_at")
    .eq("project_id", params.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← 所有项目
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold text-stone-900">社媒历史</h1>
        <Link
          href={`/app/projects/${params.id}/social`}
          className="text-sm font-medium text-emerald-800 hover:underline"
        >
          + 新建内容
        </Link>
      </div>
      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-950">{notice}</p>
      ) : null}

      <ul className="mt-8 space-y-4">
        {!rows?.length ? (
          <li className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">
            暂无记录。去
            <Link href={`/app/projects/${params.id}/social`} className="mx-1 font-medium text-emerald-800 underline">
              社媒
            </Link>
            生成第一条。
          </li>
        ) : (
          rows.map((row) => {
            const typeOk = isSocialContentType(row.content_type);
            const label = typeOk ? TYPE_LABEL[row.content_type] ?? row.content_type : row.content_type;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                  {row.poster_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL */}
                      <img src={row.poster_url} alt="Poster thumbnail" className="h-full w-full object-cover" />
                    </>
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-stone-400">无海报</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-stone-900">{label}</p>
                  <p className="mt-1 font-mono text-xs text-stone-500">{row.id}</p>
                  <p className="mt-1 text-xs text-stone-500">{new Date(row.created_at).toLocaleString()}</p>
                  <p className="mt-1 text-xs uppercase text-stone-400">{row.status}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/app/projects/${params.id}/social?post=${row.id}`}
                    className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
                  >
                    打开
                  </Link>
                  <form action={deleteSocialPost}>
                    <input type="hidden" name="project_id" value={params.id} />
                    <input type="hidden" name="post_id" value={row.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </form>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
