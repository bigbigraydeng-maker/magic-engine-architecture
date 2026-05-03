/**
 * CompiledIntentV2 — v0.4 混合编译管线输出的结构化意图（LLM Compiler + 后续 Form Builder）。
 * 与 {@link CompiledIntentV1} 并存；集成阶段再写入 DB / 项目。
 */

import type { RuleGuardResult } from "@/types/rule-guard";

/** v0.4 行业 ID（与 {@link IndustryId} 的 `immigration_education` 映射见下方工具函数）。 */
export type IndustryV2 = "real_estate" | "immigration";

export type RealEstateSceneV2 = "property_listing" | "open_home_event" | "market_update";

export type ImmigrationSceneV2 = "visa_consultation" | "school_info" | "program_enrollment";

export type SceneV2 = RealEstateSceneV2 | ImmigrationSceneV2;

// ═══ 模块选择系统（Option B）══════════════════════════════════════════════════

/** 可勾选模块 */
export type SelectableModuleType =
  | "offer"
  | "faq"
  | "about"
  | "contact"
  | "listings"
  | "testimonials"
  | "openHome"
  | "services";

/** 始终启用、不可关闭 */
export type AlwaysEnabledModuleType = "hero" | "footer" | "form";

export type ModuleTypeV2 = SelectableModuleType | AlwaysEnabledModuleType;

/** 各场景的默认模块组合（与旧版 FORM_FIELD_RULES 推荐字段对齐） */
export const MODULE_DEFAULTS_BY_SCENE: Record<
  SceneV2,
  {
    always_enabled: AlwaysEnabledModuleType[];
    recommended_enabled: SelectableModuleType[];
    optional_modules: SelectableModuleType[];
  }
> = {
  property_listing: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["about", "testimonials", "openHome", "services", "listings"],
  },
  open_home_event: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["openHome", "contact"],
    optional_modules: ["about", "offer", "faq", "testimonials", "services", "listings"],
  },
  market_update: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["about", "testimonials", "openHome", "services", "listings"],
  },
  visa_consultation: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact"],
    optional_modules: ["about", "faq", "testimonials", "openHome", "services", "listings"],
  },
  school_info: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact", "faq"],
    optional_modules: ["about", "testimonials", "openHome", "services", "listings"],
  },
  program_enrollment: {
    always_enabled: ["hero", "form", "footer"],
    recommended_enabled: ["offer", "contact"],
    optional_modules: ["about", "faq", "testimonials", "openHome", "services", "listings"],
  },
};

export function getDefaultModulesForScene(scene: SceneV2): ModuleTypeV2[] {
  const defaults = MODULE_DEFAULTS_BY_SCENE[scene];
  if (!defaults) {
    // 未知 scene：返回最小默认配置
    return ["hero", "form", "footer", "offer", "contact"];
  }
  return [...defaults.always_enabled, ...defaults.recommended_enabled];
}

export function getAllSelectableModulesForScene(scene: SceneV2): SelectableModuleType[] {
  const defaults = MODULE_DEFAULTS_BY_SCENE[scene];
  if (!defaults) {
    // 未知 scene：返回所有可选模块
    return ["offer", "faq", "about", "contact", "listings", "testimonials", "openHome", "services"];
  }
  return [...defaults.recommended_enabled, ...defaults.optional_modules];
}

export type LanguageV2 = "en" | "zh" | "both";

export type PageTypeV2 = "landing" | "showcase" | "form" | "multi_section";

export type ToneV2 = "professional" | "friendly" | "urgent";

export type GoalV2 = "lead_generation" | "info_display" | "event_registration" | "consultation_booking";

export interface ModuleSelectionV2 {
  [moduleKey: string]: {
    enabled: boolean;
    priority?: "high" | "medium" | "low";
    weight?: number;
  };
}

/** 写入 intent：默认勾选推荐模块（不含 hero/form/footer） */
export function createDefaultModuleSelection(scene: SceneV2): ModuleSelectionV2 {
  const sel: ModuleSelectionV2 = {};
  for (const mod of getDefaultModulesForScene(scene)) {
    if (mod !== "hero" && mod !== "form" && mod !== "footer") {
      sel[mod as string] = { enabled: true };
    }
  }
  return sel;
}

/** 根据 module_selection 解析参与表单推荐的模块列表 */
export function resolveActiveModulesForForm(scene: SceneV2, moduleSelection: ModuleSelectionV2 | undefined): ModuleTypeV2[] {
  const d = MODULE_DEFAULTS_BY_SCENE[scene];
  if (!d || !moduleSelection || Object.keys(moduleSelection).length === 0) {
    return getDefaultModulesForScene(scene);
  }
  const out: ModuleTypeV2[] = [...d.always_enabled];
  for (const mod of getAllSelectableModulesForScene(scene)) {
    if (moduleSelection[mod]?.enabled) {
      out.push(mod);
    }
  }
  return out;
}

export type FormFieldTypeV2 = "text" | "email" | "phone" | "select" | "date" | "textarea" | "checkbox";

export interface FormFieldDefinitionV2 {
  id: string;
  label: string;
  type: FormFieldTypeV2;
  required: boolean;
  placeholder?: string;
  /** Short helper under the field (optional). */
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export type CompilerVersionV2 = "rule_v1" | "hybrid_v2";

/** 持久化 JSON schema：1 = 初始；2 = 含确认历史 revisions */
export type CompiledIntentSchemaVersion = 1 | 2;

export interface CompiledIntentV2 {
  /** 持久化后填写；编译前可为空。 */
  id?: string;
  project_id?: string;

  industry: IndustryV2;
  scene: SceneV2;
  language: LanguageV2;

  page_type?: PageTypeV2;
  tone?: ToneV2;
  goal?: GoalV2;
  /** LLM 对用户意图的一句话摘要（可选）。 */
  description?: string;

  city?: string | null;
  skeleton_id?: string;
  module_selection?: ModuleSelectionV2;
  form_field_pool?: Record<string, FormFieldDefinitionV2>;
  form_field_order?: string[];

  compiler_version: CompilerVersionV2;
  rule_guard_result?: RuleGuardResult;
  user_confirmed: boolean;

  created_at: string;
  updated_at: string;

  /** schema_version 2：每次确认追加一条，不修改旧记录；回滚也会新增一条指向旧快照 */
  schema_version?: CompiledIntentSchemaVersion;
  /** 当前指针，与最后一次确认的 revision.version 一致 */
  current_version?: number;
}

/**
 * 写入 `revisions[].intent` 的快照（不含历史元数据，避免嵌套与循环 JSON）。
 */
export type CompiledIntentV2Snapshot = Omit<CompiledIntentV2, "schema_version" | "current_version" | "revisions">;

export interface IntentRevisionV2 {
  version: number;
  intent: CompiledIntentV2Snapshot;
  confirmed_at: string;
  created_at: string;
}

/** 确认历史（见上；接口合并避免循环前置声明） */
export interface CompiledIntentV2 {
  revisions?: IntentRevisionV2[];
}

/** 从持久化对象去掉历史元数据，供写入 revisions[].intent */
export function stripIntentForRevision(intent: CompiledIntentV2): CompiledIntentV2Snapshot {
  const { schema_version, current_version, revisions, ...rest } = intent;
  void schema_version;
  void current_version;
  void revisions;
  return rest;
}

/** 与现有 `IndustryId` 互转（渐进集成）。 */
export function industryIdToV2(id: "immigration_education" | "real_estate"): IndustryV2 {
  return id === "real_estate" ? "real_estate" : "immigration";
}

export function industryV2ToId(ind: IndustryV2): "immigration_education" | "real_estate" {
  return ind === "real_estate" ? "real_estate" : "immigration_education";
}

const ALL_SCENES_V2: readonly string[] = [
  "property_listing",
  "open_home_event",
  "market_update",
  "visa_consultation",
  "school_info",
  "program_enrollment",
];

export function isCompiledIntentV2(v: unknown): v is CompiledIntentV2 {
  if (!v || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  if (o.compiler_version !== "hybrid_v2") {
    return false;
  }
  if (o.industry !== "real_estate" && o.industry !== "immigration") {
    return false;
  }
  if (typeof o.scene !== "string" || !ALL_SCENES_V2.includes(o.scene)) {
    return false;
  }
  if (o.language !== "en" && o.language !== "zh" && o.language !== "both") {
    return false;
  }
  if (typeof o.created_at !== "string" || typeof o.updated_at !== "string") {
    return false;
  }
  if (typeof o.user_confirmed !== "boolean") {
    return false;
  }
  if (o.schema_version !== undefined && o.schema_version !== 1 && o.schema_version !== 2) {
    return false;
  }
  if (o.current_version !== undefined && typeof o.current_version !== "number") {
    return false;
  }
  if (o.revisions !== undefined) {
    if (!Array.isArray(o.revisions)) {
      return false;
    }
    for (const item of o.revisions) {
      if (!isIntentRevisionEntryLoose(item)) {
        return false;
      }
    }
  }
  return true;
}

function isIntentRevisionEntryLoose(v: unknown): boolean {
  if (!v || typeof v !== "object") {
    return false;
  }
  const r = v as Record<string, unknown>;
  if (typeof r.version !== "number" || r.version < 1) {
    return false;
  }
  if (!r.intent || typeof r.intent !== "object") {
    return false;
  }
  if (typeof r.confirmed_at !== "string" || typeof r.created_at !== "string") {
    return false;
  }
  return true;
}

export function parseCompiledIntentV2(raw: unknown): CompiledIntentV2 | null {
  return isCompiledIntentV2(raw) ? raw : null;
}

/**
 * 读取 DB 已有 JSON，得到确认前历史列表与当前版本号（用于追加下一版；兼容无 revisions 的旧数据）。
 */
export function collectPriorRevisionsForConfirm(prevRaw: unknown): {
  revisions: IntentRevisionV2[];
  currentVersion: number;
} {
  const parsed = parseCompiledIntentV2(prevRaw);
  if (!parsed) {
    return { revisions: [], currentVersion: 0 };
  }
  if (parsed.schema_version === 2 && Array.isArray(parsed.revisions) && parsed.revisions.length > 0) {
    const revs = parsed.revisions;
    const cv =
      typeof parsed.current_version === "number"
        ? parsed.current_version
        : revs[revs.length - 1]?.version ?? 0;
    return { revisions: revs, currentVersion: cv };
  }
  if (parsed.user_confirmed) {
    const snap = stripIntentForRevision(parsed);
    return {
      revisions: [
        {
          version: 1,
          intent: snap,
          confirmed_at: parsed.updated_at,
          created_at: parsed.created_at,
        },
      ],
      currentVersion: 1,
    };
  }
  return { revisions: [], currentVersion: 0 };
}
