import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface GeneratePageProps {
  params: { id: string };
}

export default async function MediaGeneratePage({ params }: GeneratePageProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", params.id).maybeSingle();

  if (!project) {
    notFound();
  }

  return (
    <div className="pb-10">
      <Link href={`/app/projects/${params.id}/media`} className="text-sm text-emerald-800 hover:underline">
        ← 素材库
      </Link>

      <div className="mt-6">
        <h1 className="font-display text-2xl font-bold text-stone-900">AI 图片生成</h1>
        <p className="mt-1 text-sm text-stone-600">使用 AI 生成高质量图片</p>
      </div>

      <div className="mt-8 rounded-xl border-2 border-dashed border-stone-300 p-12 text-center">
        <p className="text-lg font-medium text-stone-700">即将推出</p>
        <p className="mt-2 text-sm text-stone-500">
          AI 图片生成功能正在开发中。目前你可以使用 Unsplash 搜索或上传自有图片。
        </p>
        <Link
          href={`/app/projects/${params.id}/media`}
          className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
        >
          前往素材库
        </Link>
      </div>
    </div>
  );
}
