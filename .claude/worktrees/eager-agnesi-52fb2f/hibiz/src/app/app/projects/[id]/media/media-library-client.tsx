"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { applyImageToHero, deleteMediaAsset, updateMediaCategory } from "@/app/app/projects/media-actions";
import { ImageUploader } from "@/components/media/ImageUploader";
import { MediaGrid } from "@/components/media/MediaGrid";
import { UnsplashSearch } from "@/components/media/UnsplashSearch";
import type { MediaAsset, MediaCategory } from "@/types/media-asset";

type ActiveTab = "library" | "unsplash" | "upload";

interface MediaLibraryClientProps {
  projectId: string;
  initialAssets: MediaAsset[];
}

export function MediaLibraryClient({ projectId, initialAssets }: MediaLibraryClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ActiveTab>("library");
  const [error, setError] = useState<string | null>(null); // MEDIUM-2: 错误展示

  const handleRefresh = () => router.refresh();

  const handleDelete = async (assetId: string) => {
    if (!confirm("确定删除这张图片？")) {
      return;
    }
    setError(null);
    try {
      await deleteMediaAsset(projectId, assetId);
      handleRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleCategoryChange = async (assetId: string, category: MediaCategory) => {
    setError(null);
    try {
      await updateMediaCategory(projectId, assetId, category);
      handleRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "分类更新失败");
    }
  };

  const handleApplyToHero = async (asset: MediaAsset) => {
    setError(null);
    try {
      await applyImageToHero(projectId, asset.url);
      handleRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "应用到 Hero 失败");
    }
  };

  return (
    <div className="mt-8">
      {error ? <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p> : null}
      <div className="mb-6 flex gap-3 border-b border-stone-200">
        {(
          [
            { id: "library" as ActiveTab, label: "我的素材", count: initialAssets.length },
            { id: "unsplash" as ActiveTab, label: "Unsplash 搜索" },
            { id: "upload" as ActiveTab, label: "上传图片" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-stone-600 hover:text-stone-900"
            }`}
          >
            {t.label}
            {"count" in t && t.count != null ? <span className="ml-1 text-xs text-stone-400">({t.count})</span> : null}
          </button>
        ))}
      </div>

      {tab === "library" ? (
        <MediaGrid
          assets={initialAssets}
          onDelete={handleDelete}
          onCategoryChange={handleCategoryChange}
          onApplyToHero={handleApplyToHero}
        />
      ) : null}
      {tab === "unsplash" ? <UnsplashSearch projectId={projectId} onSaved={handleRefresh} /> : null}
      {tab === "upload" ? <ImageUploader projectId={projectId} onUploaded={handleRefresh} /> : null}

      <div className="mt-8 rounded-lg bg-stone-50 p-4 text-xs text-stone-600">
        <p>
          共 {initialAssets.length} 张图片 · 上传 {initialAssets.filter((a) => a.source === "upload").length} · Unsplash{" "}
          {initialAssets.filter((a) => a.source === "unsplash").length} · AI 生成{" "}
          {initialAssets.filter((a) => a.source === "ai_generated").length}
        </p>
      </div>
    </div>
  );
}
