"use client";

import {
  MODULE_DEFAULTS_BY_SCENE,
  type CompiledIntentV2,
  type IndustryV2,
  type ModuleTypeV2,
  type SelectableModuleType,
} from "@/types/compiled-intent-v2";
import { getSelectableModulesForIndustry, previewScene } from "@/lib/compile-v2-helpers";

export interface ModuleSelectionPanelProps {
  industry: IndustryV2;
  selectedModules: ModuleTypeV2[];
  onModulesChange: (modules: ModuleTypeV2[]) => void;
  displayIntent: CompiledIntentV2 | null;
  onCompile: () => void;
  onCancel: () => void;
  pending: boolean;
  rawPrompt: string;
}

export function ModuleSelectionPanel({
  industry,
  selectedModules,
  onModulesChange,
  displayIntent,
  onCompile,
  onCancel,
  pending,
  rawPrompt,
}: ModuleSelectionPanelProps) {
  const scene = previewScene(industry, displayIntent);
  const alwaysEnabled = MODULE_DEFAULTS_BY_SCENE[scene]?.always_enabled ?? (["hero", "form", "footer"] as const);
  const optionalList: SelectableModuleType[] = getSelectableModulesForIndustry(industry);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <p className="mb-3 text-sm font-semibold text-stone-900">Module Selection</p>

      <div className="mb-4">
        <p className="mb-2 text-xs font-medium uppercase text-stone-600">Always Enabled (Cannot disable)</p>
        <div className="space-y-2">
          {alwaysEnabled.map((mod) => (
            <label key={mod} className="flex cursor-not-allowed items-center gap-2 opacity-60">
              <input type="checkbox" checked readOnly disabled className="rounded" />
              <span className="text-sm capitalize text-stone-700">{mod}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-xs font-medium uppercase text-stone-600">Optional</p>
        <div className="space-y-2">
          {optionalList.map((mod) => (
            <label key={mod} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selectedModules.includes(mod)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onModulesChange([...selectedModules, mod]);
                  } else {
                    onModulesChange(selectedModules.filter((m) => m !== mod));
                  }
                }}
                className="rounded border-stone-300"
              />
              <span className="text-sm capitalize text-stone-700">{mod}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !rawPrompt.trim()}
          onClick={onCompile}
          className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-50 disabled:opacity-50"
        >
          重新编译（LLM）
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
        >
          取消编辑
        </button>
      </div>
    </div>
  );
}
