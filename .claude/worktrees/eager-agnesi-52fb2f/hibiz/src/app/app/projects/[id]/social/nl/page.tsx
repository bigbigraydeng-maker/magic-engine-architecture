import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FormPendingHint, FormSubmitPendingButton } from "@/components/ui/form-submit-pending";
import { generateSocialNlPost } from "@/app/app/projects/social-actions";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const NOTICE_COPY: Record<string, string> = {
  nl_gen_error: "生成失败，请检查 OPENAI_API_KEY、文件大小与格式，或稍后重试。",
  nl_prompt_short: "请至少写一句说明（3 个字符以上），描述想发什么、给谁看。",
  nl_too_many_files: "单次最多上传 12 个文件，请删减后重试。",
  save_error: "保存失败，请重试。",
};

interface NlSocialPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function NlSocialPage({ params, searchParams }: NlSocialPageProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();
  if (!project) {
    notFound();
  }

  const noticeRaw = searchParams.notice;
  const notice = typeof noticeRaw === "string" ? NOTICE_COPY[noticeRaw] ?? null : null;

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← 所有项目
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">自然语言 + 自有素材 → 社媒文案</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            用一句话说明目标受众与卖点，并上传<strong>你自己的</strong>图片或文字片段（.txt / .md）。系统将生成 Facebook、Instagram、LinkedIn、小红书
            的中英文案，以及配图顺序建议。不会自动发帖——请在各平台手动粘贴。
          </p>
        </div>
        <Link
          href={`/app/projects/${params.id}/social`}
          className="text-sm font-medium text-emerald-800 hover:underline"
        >
          ← 返回社媒首页
        </Link>
      </div>

      {notice ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{notice}</p>
      ) : null}

      <form action={generateSocialNlPost} className="mt-8 max-w-xl space-y-6">
        <input type="hidden" name="project_id" value={params.id} />
        <div>
          <label htmlFor="prompt" className="block text-sm font-medium text-stone-700">
            想发什么？（自然语言）
          </label>
          <textarea
            id="prompt"
            name="prompt"
            required
            minLength={3}
            maxLength={4000}
            rows={5}
            placeholder="例：下周六 Remuera 开放日，强调学区与采光；语气专业亲切；面向首次置业家庭。"
            className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-400"
          />
        </div>
        <div>
          <label htmlFor="files" className="block text-sm font-medium text-stone-700">
            上传你的文件（可选，最多 12 个）
          </label>
          <p className="mt-1 text-xs text-stone-500">
            支持：JPEG / PNG / WebP 图片（合计最多 6 张会送入识图），以及 .txt / .md 纯文本（单文件建议不超过 512KB）。PDF 请先导出为图片或文字再上传。
          </p>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,.txt,.md,text/plain,text/markdown"
            className="mt-2 block w-full text-sm text-stone-600 file:mr-4 file:rounded-lg file:border file:border-stone-300 file:bg-stone-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-800 hover:file:bg-stone-100"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <FormSubmitPendingButton
            pendingLabel="生成中…"
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            生成各平台文案
          </FormSubmitPendingButton>
          <Link
            href={`/app/projects/${params.id}/social`}
            className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            取消
          </Link>
        </div>
        <FormPendingHint className="text-xs font-medium text-amber-800">
          正在上传素材并调用 OpenAI（含多图识图时可能较慢），请勿重复提交。
        </FormPendingHint>
      </form>
    </div>
  );
}
