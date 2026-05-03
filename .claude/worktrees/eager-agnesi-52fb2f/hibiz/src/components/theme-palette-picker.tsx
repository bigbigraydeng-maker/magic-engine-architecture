"use client";

import { useState } from "react";
import type { TemplateSkeleton } from "@/types/skeleton";

interface ThemePalettePickerProps {
  skeleton: TemplateSkeleton;
}

export function ThemePalettePicker({ skeleton }: ThemePalettePickerProps) {
  const first = skeleton.theme.palettes[0]?.id ?? "";
  const [paletteId, setPaletteId] = useState(first);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="font-medium text-stone-900">配色方案</h3>
      <input type="hidden" name="palette_id" value={paletteId} readOnly />
      <div className="mt-4 flex flex-wrap gap-3">
        {skeleton.theme.palettes.map((p) => {
          const active = paletteId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPaletteId(p.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-transform ${
                active ? "scale-105 border-emerald-600 ring-2 ring-emerald-200" : "border-stone-200 hover:border-stone-300"
              }`}
            >
              <span className="flex gap-1">
                <span className="h-8 w-8 rounded-full border border-stone-200 shadow-inner" style={{ backgroundColor: p.primary }} />
                <span className="h-8 w-8 rounded-full border border-stone-200 shadow-inner" style={{ backgroundColor: p.accent }} />
                <span className="h-8 w-8 rounded-full border border-stone-200 shadow-inner" style={{ backgroundColor: p.background }} />
              </span>
              <span className="text-xs font-medium text-stone-700">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
