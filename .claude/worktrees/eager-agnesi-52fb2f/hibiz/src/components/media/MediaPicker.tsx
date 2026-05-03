"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MediaAsset } from "@/types/media-asset";
import { ImageUploader } from "./ImageUploader";
import { MediaGrid } from "./MediaGrid";
import { UnsplashSearch } from "./UnsplashSearch";

interface MediaPickerProps {
  projectId: string;
  assets: MediaAsset[];
  onSelect: (asset: MediaAsset) => void;
  onClose: () => void;
}

type Tab = "library" | "unsplash" | "upload";

export function MediaPicker({ projectId, assets, onSelect, onClose }: MediaPickerProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("library");

  const refresh = () => router.refresh();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">选择图片</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900">
            关闭
          </button>
        </div>

        <div className="mb-6 flex gap-2 border-b border-stone-200">
          {(
            [
              { id: "library" as Tab, label: "素材库" },
              { id: "unsplash" as Tab, label: "Unsplash 搜索" },
              { id: "upload" as Tab, label: "上传新图" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "library" ? <MediaGrid assets={assets} selectable onSelect={onSelect} /> : null}
        {tab === "unsplash" ? <UnsplashSearch projectId={projectId} onSaved={refresh} /> : null}
        {tab === "upload" ? <ImageUploader projectId={projectId} onUploaded={refresh} /> : null}
      </div>
    </div>
  );
}
