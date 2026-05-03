"use client";

import { useState } from "react";
import { unsplashAttributionUrl } from "@/lib/media/unsplash-client";
import type { MediaAsset, MediaCategory } from "@/types/media-asset";
import { CATEGORY_LABELS, isMediaCategory, MEDIA_CATEGORIES } from "@/types/media-asset";
import { CategoryFilter, type CategoryFilterValue } from "./CategoryFilter";

interface MediaGridProps {
  assets: MediaAsset[];
  onDelete?: (id: string) => void;
  onCategoryChange?: (id: string, category: MediaCategory) => void;
  selectable?: boolean;
  onSelect?: (asset: MediaAsset) => void;
  onApplyToHero?: (asset: MediaAsset) => void;
}

export function MediaGrid({
  assets,
  onDelete,
  onCategoryChange,
  selectable,
  onSelect,
  onApplyToHero,
}: MediaGridProps) {
  const [filter, setFilter] = useState<CategoryFilterValue>("all");

  const filtered = filter === "all" ? assets : assets.filter((a) => a.category === filter);

  return (
    <div>
      <CategoryFilter assets={assets} value={filter} onChange={setFilter} />

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">暂无图片</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className={`group relative overflow-hidden rounded-lg border border-stone-200 bg-white ${
                selectable ? "cursor-pointer hover:ring-2 hover:ring-indigo-500" : ""
              }`}
              onClick={() => selectable && onSelect?.(asset)}
              onKeyDown={(e) => {
                if (selectable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect?.(asset);
                }
              }}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.thumbnail_url ?? asset.url}
                alt={asset.alt_text ?? ""}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />

              <div className="p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
                    {asset.source === "unsplash" ? "Unsplash" : asset.source === "upload" ? "上传" : "AI"}
                  </span>
                  {onDelete ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(asset.id);
                      }}
                      className="text-xs text-red-600 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                {onApplyToHero ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApplyToHero(asset);
                    }}
                    className="mt-2 w-full rounded border border-emerald-200 bg-emerald-50 py-1.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    ⭐ 应用到 Hero
                  </button>
                ) : null}

                {onCategoryChange ? (
                  <label className="mt-2 block text-[10px] text-stone-500">
                    分类
                    <select
                      className="mt-0.5 w-full rounded border border-stone-200 bg-white px-1 py-1 text-[10px] text-stone-800"
                      value={asset.category}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isMediaCategory(v)) {
                          onCategoryChange(asset.id, v);
                        }
                      }}
                    >
                      {MEDIA_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {asset.source === "unsplash" && asset.unsplash_photographer ? (
                  <p className="mt-1 text-[10px] text-stone-400">
                    Photo by{" "}
                    <a
                      href={asset.unsplash_photographer_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {asset.unsplash_photographer}
                    </a>
                    {" · "}
                    <a
                      href={unsplashAttributionUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Unsplash
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
