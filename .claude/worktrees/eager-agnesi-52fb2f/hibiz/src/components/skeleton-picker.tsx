"use client";

import type { TemplateSkeleton } from "@/types/skeleton";

interface SkeletonPickerProps {
  skeletons: readonly TemplateSkeleton[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SkeletonPicker({ skeletons, selectedId, onSelect }: SkeletonPickerProps) {
  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-stone-900">选择骨架模板</h2>
      <p className="mt-1 text-sm text-stone-600">房产行业预设；后续可扩展移民教育。</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skeletons.map((s) => {
          const active = selectedId === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={`w-full rounded-2xl border-2 p-4 text-left transition-shadow ${
                  active ? "border-emerald-600 bg-emerald-50/40 shadow-md" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <div className="flex h-24 items-center justify-center rounded-xl bg-stone-100 text-xs text-stone-400">
                  预览图占位
                </div>
                <p className="mt-3 font-display text-base font-semibold text-stone-900">{s.name}</p>
                <p className="text-xs text-stone-500">{s.nameEn}</p>
                <p className="mt-2 text-sm text-stone-600">{s.description}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
