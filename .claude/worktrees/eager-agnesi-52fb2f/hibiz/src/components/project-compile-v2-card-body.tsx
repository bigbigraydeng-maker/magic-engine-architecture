"use client";

import type { FormBuilderResultV2 } from "@/types/form-builder";
import type { CompiledIntentV2, IndustryV2, ModuleTypeV2 } from "@/types/compiled-intent-v2";
import { ModuleSelectionPanel } from "@/components/module-selection-panel";

function FieldChipList({
  fields,
  chipClass,
}: {
  fields: FormBuilderResultV2["selected_fields"];
  chipClass: string;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {fields.map((f) => (
        <li key={f.id} className={chipClass}>
          {f.label}
        </li>
      ))}
    </ul>
  );
}

export interface ProjectCompileV2CardBodyProps {
  displayIntent: CompiledIntentV2;
  editMode: boolean;
  effectiveConfirmed: boolean;
  pendingIndustry: IndustryV2 | null;
  selectedModules: ModuleTypeV2[];
  setSelectedModules: (m: ModuleTypeV2[]) => void;
  onIndustryChange: (v: IndustryV2) => void;
  openEdit: () => void;
  handleCompile: () => void;
  cancelEdit: () => void;
  pending: boolean;
  rawPrompt: string;
  committedFieldsEdit: FormBuilderResultV2 | null;
  previewFields: FormBuilderResultV2 | null;
  readOnlyRecommended: FormBuilderResultV2 | null;
  editModePendingDirty: boolean;
  showConfirm: boolean;
  handleConfirm: () => void;
  pendingDirty: boolean;
}

export function ProjectCompileV2CardBody({
  displayIntent,
  editMode,
  effectiveConfirmed,
  pendingIndustry,
  selectedModules,
  setSelectedModules,
  onIndustryChange,
  openEdit,
  handleCompile,
  cancelEdit,
  pending,
  rawPrompt,
  committedFieldsEdit,
  previewFields,
  readOnlyRecommended,
  editModePendingDirty,
  showConfirm,
  handleConfirm,
  pendingDirty,
}: ProjectCompileV2CardBodyProps) {
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase text-stone-500">编译结果</p>

        {!editMode ? (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-stone-500">Industry</p>
              <p className="font-semibold text-stone-900">{displayIntent.industry}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Scene（LLM）</p>
              <p className="font-semibold text-stone-900">{displayIntent.scene}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Language</p>
              <p className="font-semibold text-stone-900">{displayIntent.language}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">保存状态</p>
              <p className={`font-semibold ${effectiveConfirmed ? "text-emerald-700" : "text-amber-700"}`}>
                {effectiveConfirmed ? "已确认" : "未确认"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="hibiz-pending-industry" className="text-xs font-medium text-stone-600">
                Industry
              </label>
              <select
                id="hibiz-pending-industry"
                className="mt-1 w-full max-w-md rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                value={pendingIndustry ?? displayIntent.industry}
                onChange={(e) => onIndustryChange(e.target.value as IndustryV2)}
              >
                <option value="real_estate">real_estate</option>
                <option value="immigration">immigration</option>
              </select>
            </div>

            {editMode && pendingIndustry ? (
              <ModuleSelectionPanel
                industry={pendingIndustry}
                selectedModules={selectedModules}
                onModulesChange={setSelectedModules}
                displayIntent={displayIntent}
                onCompile={handleCompile}
                onCancel={cancelEdit}
                pending={pending}
                rawPrompt={rawPrompt}
              />
            ) : null}
          </div>
        )}

        {!editMode ? (
          <button
            type="button"
            onClick={() => openEdit()}
            className="mt-4 text-sm font-medium text-indigo-800 underline hover:text-indigo-950"
          >
            编辑 industry / 模块
          </button>
        ) : null}
      </div>

      {editMode && pendingDirty && committedFieldsEdit && previewFields ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-4">
          <p className="mb-2 text-sm font-semibold text-stone-800">
            当前编译推荐的字段（{committedFieldsEdit.confidence}%）· {committedFieldsEdit.selected_fields.length} 个
          </p>
          <p className="mb-2 text-xs text-stone-500">修改模块后下方为即时预览；点「重新编译」才会用 LLM 更新意图。</p>
          <FieldChipList
            fields={committedFieldsEdit.selected_fields}
            chipClass="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-800"
          />
        </div>
      ) : null}

      {previewFields ? (
        <div className="rounded-xl border border-blue-300 bg-blue-50 p-4">
          <p className="mb-2 text-sm font-semibold text-blue-950">
            模块预览 — 推荐字段（{previewFields.confidence}%）· {previewFields.selected_fields.length} 个
          </p>
          <p className="mb-2 text-xs text-blue-900/80">
            {editModePendingDirty
              ? "根据当前 industry 与勾选模块即时生成；未点「重新编译」前 LLM 的 scene 未变。"
              : "根据当前 industry 与模块推荐。"}
          </p>
          <FieldChipList
            fields={previewFields.selected_fields}
            chipClass="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-900"
          />
        </div>
      ) : null}

      {!editMode && readOnlyRecommended ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-stone-800">
            推荐表单字段（{readOnlyRecommended.confidence}%）· {readOnlyRecommended.selected_fields.length} 个
          </p>
          <FieldChipList
            fields={readOnlyRecommended.selected_fields}
            chipClass="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-800"
          />
        </div>
      ) : null}

      {showConfirm ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => handleConfirm()}
          className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "保存中…" : "✅ 确认并保存到项目"}
        </button>
      ) : null}

      {effectiveConfirmed && !editMode && !pendingDirty ? (
        <p className="text-center text-sm text-emerald-800">意图已确认。请使用下方「生成网站草稿」继续。</p>
      ) : null}
    </div>
  );
}
