"use client";

import { useRef, useState, useTransition } from "react";
import { uploadImageToLibrary } from "@/app/app/projects/media-actions";
import type { MediaCategory } from "@/types/media-asset";
import { CATEGORY_LABELS, MEDIA_CATEGORIES } from "@/types/media-asset";

interface ImageUploaderProps {
  projectId: string;
  defaultCategory?: MediaCategory;
  onUploaded?: () => void;
}

export function ImageUploader({ projectId, defaultCategory = "general", onUploaded }: ImageUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<MediaCategory>(defaultCategory);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", category);
        await uploadImageToLibrary(projectId, fd);
        onUploaded?.();
        if (fileRef.current) {
          fileRef.current.value = "";
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    });
  };

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-stone-600">上传分类</label>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as MediaCategory)}
        className="mb-4 w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {MEDIA_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>

      <div
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragActive ? "border-indigo-500 bg-indigo-50" : "border-stone-300 bg-stone-50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {pending ? (
          <p className="text-sm text-indigo-700">上传中...</p>
        ) : (
          <>
            <p className="text-sm text-stone-700">拖拽图片到此处，或</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              选择文件
            </button>
            <p className="mt-2 text-xs text-stone-500">支持 JPEG, PNG, WebP · 最大 10MB</p>
          </>
        )}

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
