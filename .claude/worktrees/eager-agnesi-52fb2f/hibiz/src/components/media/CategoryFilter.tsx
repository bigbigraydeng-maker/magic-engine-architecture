"use client";

import type { MediaAsset, MediaCategory } from "@/types/media-asset";
import { CATEGORY_LABELS, MEDIA_CATEGORIES } from "@/types/media-asset";

export type CategoryFilterValue = MediaCategory | "all";

interface CategoryFilterProps {
  assets: MediaAsset[];
  value: CategoryFilterValue;
  onChange: (next: CategoryFilterValue) => void;
}

export function CategoryFilter({ assets, value, onChange }: CategoryFilterProps) {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          value === "all" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
        }`}
      >
        全部 ({assets.length})
      </button>
      {MEDIA_CATEGORIES.map((cat) => {
        const count = assets.filter((a) => a.category === cat).length;
        if (count === 0) {
          return null;
        }
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              value === cat ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            {CATEGORY_LABELS[cat]} ({count})
          </button>
        );
      })}
    </div>
  );
}
