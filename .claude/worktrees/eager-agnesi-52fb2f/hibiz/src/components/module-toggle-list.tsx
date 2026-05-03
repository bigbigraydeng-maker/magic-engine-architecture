"use client";

import { useMemo, useState } from "react";
import { skeletonModuleVisibilityKey } from "@/lib/generation/skeleton-module-key";
import type { TemplateSkeleton } from "@/types/skeleton";

interface ModuleToggleListProps {
  skeleton: TemplateSkeleton;
}

export function ModuleToggleList({ skeleton }: ModuleToggleListProps) {
  const [vis, setVis] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    skeleton.modules.forEach((m, i) => {
      init[i] = m.visible;
    });
    return init;
  });

  const json = useMemo(() => {
    const o: Record<string, boolean> = {};
    Object.entries(vis).forEach(([k, v]) => {
      o[k] = v;
    });
    return JSON.stringify(o);
  }, [vis]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="font-medium text-stone-900">模块显示</h3>
      <p className="mt-1 text-xs text-stone-500">Hero 与 Footer 不可关闭；其余可切换。</p>
      <input type="hidden" name="module_visibility_json" value={json} readOnly />
      <ul className="mt-4 space-y-3">
        {skeleton.modules.map((m, i) => {
          const locked = m.type === "hero" || m.type === "footer";
          const on = vis[i] ?? m.visible;
          return (
            <li key={skeletonModuleVisibilityKey(skeleton.id, i)} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-stone-700">
                {m.type} <span className="text-stone-400">({m.variant})</span>
              </span>
              <label className={`inline-flex items-center ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={() => {
                    if (locked) {
                      return;
                    }
                    setVis((prev) => ({ ...prev, [i]: !on }));
                  }}
                  className="h-4 w-4 rounded border-stone-300 text-emerald-700"
                />
                <span className="ml-2 text-stone-600">{on ? "显示" : "隐藏"}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
