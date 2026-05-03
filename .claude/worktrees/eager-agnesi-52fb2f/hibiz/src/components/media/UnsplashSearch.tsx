"use client";

import { useState, useTransition } from "react";
import { applyImageToHero, saveUnsplashToLibrary, searchUnsplash } from "@/app/app/projects/media-actions";
import {
  photographerUrl,
  triggerUnsplashDownload,
  unsplashAttributionUrl,
} from "@/lib/media/unsplash-client";
import type { UnsplashPhoto } from "@/lib/media/unsplash-client";
import type { MediaCategory } from "@/types/media-asset";
import { CATEGORY_LABELS, MEDIA_CATEGORIES } from "@/types/media-asset";

interface UnsplashSearchProps {
  projectId: string;
  onSaved?: () => void;
  /** 保存到素材库时使用的分类 */
  defaultCategory?: MediaCategory;
}

export function UnsplashSearch({ projectId, onSaved, defaultCategory = "general" }: UnsplashSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [saveCategory, setSaveCategory] = useState<MediaCategory>(defaultCategory);
  const [saving, setSaving] = useState<string | null>(null);
  const [applyingHero, setApplyingHero] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null); // MEDIUM-3: 保存错误提示
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!query.trim()) {
      return;
    }
    setSearchError(null);
    startTransition(async () => {
      try {
        const res = await searchUnsplash({ query: query.trim(), page: 1, perPage: 20 });
        setResults(res.results);
        setTotal(res.total);
        setTotalPages(res.total_pages);
        setPage(1);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "搜索失败");
        setResults([]);
      }
    });
  };

  const handleLoadMore = () => {
    if (!query.trim() || page >= totalPages) {
      return;
    }
    startTransition(async () => {
      try {
        const nextPage = page + 1;
        const res = await searchUnsplash({ query: query.trim(), page: nextPage, perPage: 20 });
        setResults((prev) => [...prev, ...res.results]);
        setPage(nextPage);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "加载失败");
      }
    });
  };

  const handleApplyHero = (photo: UnsplashPhoto) => {
    setApplyingHero(photo.id);
    setSaveError(null);
    startTransition(async () => {
      try {
        await applyImageToHero(projectId, photo.urls.regular);
        await triggerUnsplashDownload(photo.links.download_location);
        onSaved?.();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "应用到 Hero 失败");
      } finally {
        setApplyingHero(null);
      }
    });
  };

  const handleSave = (photo: UnsplashPhoto) => {
    setSaving(photo.id);
    setSaveError(null);
    startTransition(async () => {
      try {
        await saveUnsplashToLibrary(projectId, photo, saveCategory);
        onSaved?.();
      } catch (e) {
        // MEDIUM-3: 显示保存错误
        setSaveError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setSaving(null);
      }
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="unsplash-q" className="mb-1 block text-xs font-medium text-stone-600">
            保存时的分类
          </label>
          <select
            id="unsplash-cat"
            value={saveCategory}
            onChange={(e) => setSaveCategory(e.target.value as MediaCategory)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {MEDIA_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          id="unsplash-q"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索图片... (例如: Auckland skyline, modern house)"
          className="flex-1 rounded-lg border border-stone-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => handleSearch()}
          disabled={pending}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {pending ? "搜索中..." : "搜索 Unsplash"}
        </button>
      </div>

      {searchError ? <p className="mt-2 text-sm text-red-600">{searchError}</p> : null}
      {saveError ? <p className="mt-2 text-sm text-red-600">保存失败：{saveError}</p> : null}

      {results.length > 0 ? (
        <>
          <p className="mt-4 text-xs text-stone-500">
            共 {total.toLocaleString()} 张图片 · 图片来源{" "}
            <a
              href={unsplashAttributionUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Unsplash
            </a>
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((photo) => (
              <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.urls.small}
                  alt={photo.alt_description ?? photo.description ?? ""}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex flex-col justify-between bg-black/0 p-2 transition-all group-hover:bg-black/40">
                  <div className="flex flex-col items-end gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleApplyHero(photo)}
                      disabled={applyingHero === photo.id || saving === photo.id}
                      className="rounded bg-emerald-600/95 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      {applyingHero === photo.id ? "应用中..." : "⭐ 应用到 Hero"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSave(photo)}
                      disabled={saving === photo.id || applyingHero === photo.id}
                      className="rounded bg-white/90 px-3 py-1 text-xs font-medium text-stone-900 hover:bg-white"
                    >
                      {saving === photo.id ? "保存中..." : "+ 添加到素材库"}
                    </button>
                  </div>
                  <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <p className="text-xs text-white">
                      Photo by{" "}
                      <a
                        href={photographerUrl(photo.user.username)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {photo.user.name}
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {page < totalPages ? (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => handleLoadMore()}
                disabled={pending}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                加载更多
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
