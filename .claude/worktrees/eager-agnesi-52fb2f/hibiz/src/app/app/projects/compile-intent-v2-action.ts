"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { compileLLMV2 } from "@/lib/compiler/llm-compiler-v2";
import { applyRuleGuard } from "@/lib/compiler/rule-guard";
import { buildFormFieldsFromModules } from "@/lib/generation/llm-form-builder";
import {
  collectPriorRevisionsForConfirm,
  createDefaultModuleSelection,
  parseCompiledIntentV2,
  resolveActiveModulesForForm,
  stripIntentForRevision,
  type CompiledIntentV2,
} from "@/types/compiled-intent-v2";
import type { FormBuilderResultV2 } from "@/types/form-builder";

export interface CompileIntentV2Response {
  intent: CompiledIntentV2;
  formFields: FormBuilderResultV2;
  /** Nominal LLM cost hint (cents), for UI only */
  costCents: number;
}

async function assertProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return Boolean(data?.id);
}

/**
 * Rule Guard → LLM Compiler V2 → rule-based form field recommendation.
 */
export async function compileIntentV2Action(rawPrompt: string, projectId: string): Promise<CompileIntentV2Response> {
  const trimmed = rawPrompt.trim();
  if (!trimmed) {
    throw new Error("Prompt is empty.");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const ok = await assertProjectOwner(projectId, user.id);
  if (!ok) {
    throw new Error("Project not found or access denied.");
  }

  const ruleGuardResult = await applyRuleGuard(trimmed);
  if (!ruleGuardResult.passed) {
    throw new Error(`Rule Guard failed: ${ruleGuardResult.reasons.join(", ")}`);
  }

  const intent = await compileLLMV2(trimmed, ruleGuardResult, { maxRetries: 2 });
  const withProject: CompiledIntentV2 = {
    ...intent,
    project_id: projectId,
  };

  if (!withProject.module_selection || Object.keys(withProject.module_selection).length === 0) {
    withProject.module_selection = createDefaultModuleSelection(withProject.scene);
  }

  const modules = resolveActiveModulesForForm(withProject.scene, withProject.module_selection);
  const formFields = buildFormFieldsFromModules(withProject.industry, modules, withProject.scene);

  return {
    intent: withProject,
    formFields,
    costCents: 1,
  };
}

/**
 * Persist confirmed hybrid intent + recommended form fields on the project row.
 */
export async function confirmIntentV2Action(projectId: string, intent: CompiledIntentV2): Promise<void> {
  // HIGH-2: 验证来自客户端的 intent 结构
  const parsed = parseCompiledIntentV2(intent);
  if (!parsed) {
    throw new Error("Invalid intent structure provided.");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const ok = await assertProjectOwner(projectId, user.id);
  if (!ok) {
    throw new Error("Project not found or access denied.");
  }

  const { data: row } = await supabase
    .from("projects")
    .select("compiled_intent_v2")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const base = stripIntentForRevision(parsed);
  const withModules: CompiledIntentV2 = {
    ...base,
    module_selection:
      base.module_selection && Object.keys(base.module_selection).length > 0
        ? base.module_selection
        : createDefaultModuleSelection(base.scene),
  };
  const modules = resolveActiveModulesForForm(withModules.scene, withModules.module_selection);
  const formFields = buildFormFieldsFromModules(withModules.industry, modules, withModules.scene);
  const now = new Date().toISOString();
  let merged: CompiledIntentV2 = {
    ...withModules,
    project_id: projectId,
    user_confirmed: true,
    form_field_pool: Object.fromEntries(formFields.selected_fields.map((f) => [f.id, f])),
    form_field_order: formFields.field_order,
    updated_at: now,
    created_at: base.created_at ?? now,
  };

  const { revisions: priorRevisions, currentVersion } = collectPriorRevisionsForConfirm(row?.compiled_intent_v2);
  const nextVersion = currentVersion + 1;
  const snapshot = stripIntentForRevision(merged);
  const newRevisions = [
    ...priorRevisions,
    { version: nextVersion, intent: snapshot, confirmed_at: now, created_at: now },
  ];

  merged = {
    ...merged,
    schema_version: 2,
    current_version: nextVersion,
    revisions: newRevisions,
  };

  const { error } = await supabase
    .from("projects")
    .update({
      compiled_intent_v2: merged,
      updated_at: now,
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Failed to save compiled intent: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}`);
}
