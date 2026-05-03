import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseMediaAsset, type MediaAsset } from "@/types/media-asset";
import { MediaLibraryClient } from "./media-library-client";

export const dynamic = "force-dynamic";

interface MediaPageProps {
  params: { id: string };
}

export default async function MediaPage({ params }: MediaPageProps) {
  const supabase = createClient();

  // MEDIUM-4: 验证项目归属（防御纵深一致性）
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const { data: rows } = await supabase
    .from("media_assets")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false });

  const initialAssets: MediaAsset[] = [];
  for (const row of rows ?? []) {
    const parsed = parseMediaAsset(row);
    if (parsed) {
      initialAssets.push(parsed);
    }
  }

  return (
    <div className="pb-10">
      <Link href={`/app/projects/${params.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">素材库</h1>
          <p className="mt-1 text-sm text-stone-600">管理网站、海报、社媒使用的所有图片</p>
        </div>
        <Link
          href={`/app/projects/${params.id}/media/generate`}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50"
        >
          AI 图片生成 →
        </Link>
      </div>

      <MediaLibraryClient projectId={params.id} initialAssets={initialAssets} />
    </div>
  );
}
