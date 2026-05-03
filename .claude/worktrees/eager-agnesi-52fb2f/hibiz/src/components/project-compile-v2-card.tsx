"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { compileIntentV2Action, confirmIntentV2Action } from "@/app/app/projects/compile-intent-v2-action";
import { buildFormFieldsFromModules } from "@/lib/generation/llm-form-builder";
import {
  baselineModulesForIntent,
  filterModulesForScene,
  hasNonAlwaysModules,
  moduleSelectionFromModules,
  modulesSignature,
  previewScene,
} from "@/lib/compile-v2-helpers";
import type { FormBuilderResultV2 } from "@/types/form-builder";
import { versionHeaderText } from "@/lib/compile-v2-intent-version";
import { ProjectCompileV2CardBody } from "@/components/project-compile-v2-card-body";
import { ProjectIntentHistoryModal } from "@/components/project-intent-history-modal";
import {
  collectPriorRevisionsForConfirm,
  getDefaultModulesForScene,
  resolveActiveModulesForForm,
  stripIntentForRevision,
  type CompiledIntentV2,
  type IndustryV2,
  type IntentRevisionV2,
  type ModuleTypeV2,
} from "@/types/compiled-intent-v2";

export interface ProjectCompileV2CardProps {
  projectId: string;
  rawPrompt: string;
  savedIntent: CompiledIntentV2 | null;
}

export function ProjectCompileV2Card({ projectId, rawPrompt, savedIntent }: ProjectCompileV2CardProps) {
  const router = useRouter();
  const [intent, setIntent] = useState<CompiledIntentV2 | null>(null);
  const [formFields, setFormFields] = useState<FormBuilderResultV2 | null>(null);
  const [costCents, setCostCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingIndustry, setPendingIndustry] = useState<IndustryV2 | null>(null);
  const [selectedModules, setSelectedModules] = useState<ModuleTypeV2[]>([]);
  const [pending, startTransition] = useTransition();

  const displayIntent = intent ?? savedIntent;

  useEffect(() => {
    if (!editMode) {
      setPendingIndustry(null);
      setSelectedModules([]);
    }
  }, [editMode]);

  const previewFields = useMemo(() => {
    if (!editMode || !pendingIndustry) {
      return null;
    }
    const scene = previewScene(pendingIndustry, displayIntent);
    const mods = filterModulesForScene(scene, selectedModules);
    if (mods.length === 0 || !hasNonAlwaysModules(scene, mods)) {
      return null;
    }
    return buildFormFieldsFromModules(pendingIndustry, mods, scene);
  }, [editMode, pendingIndustry, selectedModules, displayIntent]);

  const committedFieldsEdit = useMemo(() => {
    if (!editMode || !displayIntent) {
      return null;
    }
    const mods = baselineModulesForIntent(displayIntent);
    return buildFormFieldsFromModules(displayIntent.industry, mods, displayIntent.scene);
  }, [editMode, displayIntent]);

  const readOnlyRecommended = useMemo(() => {
    if (editMode) {
      return null;
    }
    if (formFields) {
      return formFields;
    }
    if (savedIntent) {
      const mods = baselineModulesForIntent(savedIntent);
      return buildFormFieldsFromModules(savedIntent.industry, mods, savedIntent.scene);
    }
    return null;
  }, [editMode, formFields, savedIntent]);

  const effectiveConfirmed = Boolean(intent?.user_confirmed ?? savedIntent?.user_confirmed);

  const previewScForDirty = previewScene(pendingIndustry, displayIntent);
  const pendingDirty =
    editMode &&
    pendingIndustry &&
    displayIntent &&
    (pendingIndustry !== displayIntent.industry ||
      modulesSignature(filterModulesForScene(previewScForDirty, selectedModules)) !==
        modulesSignature(baselineModulesForIntent(displayIntent)));

  const showConfirm = Boolean(
    displayIntent && (!effectiveConfirmed || Boolean(pendingDirty)) && (intent ?? savedIntent),
  );

  const handleCompile = () => {
    setError(null);
    setSaveMessage(null);
    startTransition(async () => {
      try {
        const res = await compileIntentV2Action(rawPrompt, projectId);
        setIntent(res.intent);
        setFormFields(res.formFields);
        setCostCents(res.costCents);
        setPendingIndustry(res.intent.industry);
        setEditMode(false);
      } catch (e) {
        setIntent(null);
        setFormFields(null);
        setCostCents(null);
        setError(e instanceof Error ? e.message : "Compilation failed.");
      }
    });
  };

  const openEdit = () => {
    if (!displayIntent) {
      return;
    }
    setSaveMessage(null);
    setPendingIndustry(displayIntent.industry);
    const savedModules = displayIntent.module_selection
      ? resolveActiveModulesForForm(displayIntent.scene, displayIntent.module_selection)
      : getDefaultModulesForScene(displayIntent.scene);
    setSelectedModules(savedModules);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
  };

  const handleConfirm = () => {
    const base = intent ?? savedIntent;
    if (!base) {
      return;
    }
    setError(null);
    setSaveMessage(null);
    startTransition(async () => {
      try {
        const ind = pendingIndustry ?? base.industry;
        const sc = previewScene(ind, intent ?? savedIntent);
        const module_selection = moduleSelectionFromModules(sc, filterModulesForScene(sc, selectedModules));
        const mergedInput: CompiledIntentV2 = {
          ...stripIntentForRevision(base),
          industry: ind,
          scene: sc,
          module_selection,
        };
        await confirmIntentV2Action(projectId, mergedInput);
        const mods = resolveActiveModulesForForm(sc, module_selection);
        setFormFields(buildFormFieldsFromModules(ind, mods, sc));
        setEditMode(false);
        setSaveMessage("已保存到项目。可在下方使用「生成网站草稿」。");
        setIntent(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  };

  const handleRollback = (rev: IntentRevisionV2) => {
    setError(null);
    setSaveMessage(null);
    startTransition(async () => {
      try {
        const rolled: CompiledIntentV2 = {
          ...rev.intent,
          project_id: projectId,
          user_confirmed: true,
        };
        await confirmIntentV2Action(projectId, rolled);
        const mods = baselineModulesForIntent(rolled);
        setFormFields(buildFormFieldsFromModules(rolled.industry, mods, rolled.scene));
        setHistoryOpen(false);
        setEditMode(false);
        setSaveMessage("已回滚并保存为新版本（历史已保留）。");
        setIntent(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rollback failed.");
      }
    });
  };

  const onIndustryChange = (value: IndustryV2) => {
    setPendingIndustry(value);
    const dummyScene = value === "real_estate" ? "property_listing" : "visa_consultation";
    setSelectedModules(getDefaultModulesForScene(dummyScene));
  };

  const versionUi = versionHeaderText(displayIntent);

  const revisionsForModal = useMemo(() => {
    if (!displayIntent?.user_confirmed) {
      return [];
    }
    if (displayIntent.revisions?.length) {
      return [...displayIntent.revisions].sort((a, b) => b.version - a.version);
    }
    return collectPriorRevisionsForConfirm(displayIntent).revisions.sort((a, b) => b.version - a.version);
  }, [displayIntent]);

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-stone-900">Compile v0.4 Hybrid</h2>
          <p className="mt-1 text-xs text-stone-600">Rule Guard → LLM 意图 → 规则推荐表单字段（本卡片不生成网站草稿）</p>
          {displayIntent ? (
            <p className="mt-2 text-sm font-medium text-indigo-900">
              {versionUi.title}
              {versionUi.updated ? <span className="ml-2 font-normal text-stone-500">· {versionUi.updated}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="text-right text-xs text-stone-500">
          <p className="font-medium text-indigo-700">需要 OPENAI_API_KEY</p>
          <p>~$0.01 / 次编译</p>
        </div>
      </div>

      {displayIntent?.user_confirmed && revisionsForModal.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="text-sm font-medium text-indigo-800 underline hover:text-indigo-950"
          >
            查看历史版本
          </button>
        </div>
      ) : null}

      {!rawPrompt.trim() ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">请先在下方 Intent 中填写原始描述，再回到此处编译。</p>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            disabled={pending}
            onClick={() => handleCompile()}
            className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "正在编译…" : "运行混合编译"}
          </button>
          {costCents != null ? (
            <p className="mt-2 text-center text-xs text-stone-500">预估费用 ~${(costCents / 100).toFixed(2)}</p>
          ) : null}
        </div>
      )}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : null}

      {saveMessage ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {saveMessage}
        </div>
      ) : null}

      {displayIntent && !error ? (
        <ProjectCompileV2CardBody
          displayIntent={displayIntent}
          editMode={editMode}
          effectiveConfirmed={effectiveConfirmed}
          pendingIndustry={pendingIndustry}
          selectedModules={selectedModules}
          setSelectedModules={setSelectedModules}
          onIndustryChange={onIndustryChange}
          openEdit={openEdit}
          handleCompile={handleCompile}
          cancelEdit={cancelEdit}
          pending={pending}
          rawPrompt={rawPrompt}
          committedFieldsEdit={committedFieldsEdit}
          previewFields={previewFields}
          readOnlyRecommended={readOnlyRecommended}
          editModePendingDirty={Boolean(editMode && pendingDirty)}
          showConfirm={showConfirm}
          handleConfirm={handleConfirm}
          pendingDirty={Boolean(pendingDirty)}
        />
      ) : null}

      <ProjectIntentHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        revisions={revisionsForModal}
        displayIntent={displayIntent}
        onRollback={handleRollback}
        pending={pending}
      />
    </div>
  );
}
