/**
 * Form Builder — 基于 industry + scene + 模块的确定性字段推荐（零 LLM 调用）。
 */

import type { FormFieldDefinitionV2, IndustryV2, ModuleTypeV2, SceneV2, SelectableModuleType } from "@/types/compiled-intent-v2";
import {
  FORM_FIELD_RULES,
  FORM_FIELD_RULES_BY_MODULE,
  IMMIGRATION_FIELD_POOL_V2,
  MANDATORY_FORM_FIELDS,
  type FormBuilderResultV2,
  REAL_ESTATE_FIELD_POOL_V2,
  UNIVERSAL_FIELD_POOL_V2,
} from "@/types/form-builder";

export function getFieldPoolForIndustry(industry: IndustryV2): Record<string, FormFieldDefinitionV2> {
  if (industry === "real_estate") {
    return REAL_ESTATE_FIELD_POOL_V2;
  }
  if (industry === "immigration") {
    return IMMIGRATION_FIELD_POOL_V2;
  }
  return UNIVERSAL_FIELD_POOL_V2;
}

const KNOWN_SCENES: readonly string[] = [
  "property_listing",
  "open_home_event",
  "market_update",
  "visa_consultation",
  "school_info",
  "program_enrollment",
];

function isKnownSceneV2(scene: SceneV2): boolean {
  return KNOWN_SCENES.includes(scene);
}

/** offer 模块：按场景对齐旧版 FORM_FIELD_RULES.select（不含 name/email/phone 核心） */
function getOfferFieldIdsForScene(industry: IndustryV2, scene: SceneV2): string[] {
  if (industry === "real_estate") {
    if (scene === "property_listing") {
      return ["property_address", "property_type", "bedrooms", "budget", "message"];
    }
    if (scene === "open_home_event") {
      return [];
    }
    if (scene === "market_update") {
      return [];
    }
    return [];
  }
  if (scene === "visa_consultation") {
    return ["visa_type", "current_location", "english_proficiency", "message"];
  }
  if (scene === "school_info") {
    return ["education_level", "current_location", "message"];
  }
  if (scene === "program_enrollment") {
    return ["education_level", "work_experience", "message"];
  }
  return [];
}

function fieldIdsForSelectableModule(mod: SelectableModuleType, industry: IndustryV2, scene: SceneV2): string[] {
  if (mod === "offer") {
    return getOfferFieldIdsForScene(industry, scene);
  }
  const row = FORM_FIELD_RULES_BY_MODULE[mod];
  return [...(row[industry] ?? [])];
}

function groupFormFieldsByCategory(fieldIds: string[], industry: IndustryV2): Array<{ name: string; fields: string[] }> {
  const contactFields = ["name", "email", "phone", "message"];
  const propertyFields = ["property_address", "property_type", "bedrooms", "inspection_date", "budget"];
  const visaFields = ["visa_type", "current_location", "education_level", "work_experience", "english_proficiency"];

  const groups: Array<{ name: string; fields: string[] }> = [];

  const contactGroup = fieldIds.filter((id) => contactFields.includes(id));
  if (contactGroup.length > 0) {
    groups.push({ name: "Contact", fields: contactGroup });
  }

  if (industry === "real_estate") {
    const propertyGroup = fieldIds.filter((id) => propertyFields.includes(id));
    if (propertyGroup.length > 0) {
      groups.push({ name: "Property interest", fields: propertyGroup });
    }
  } else {
    const visaGroup = fieldIds.filter((id) => visaFields.includes(id));
    if (visaGroup.length > 0) {
      groups.push({ name: "Background", fields: visaGroup });
    }
  }

  const used = new Set(groups.flatMap((g) => g.fields));
  const otherGroup = fieldIds.filter((id) => !used.has(id));
  if (otherGroup.length > 0) {
    groups.push({ name: "Additional", fields: otherGroup });
  }

  return groups;
}

function confidenceForModules(scene: SceneV2, industry: IndustryV2): number {
  if (industry === "real_estate") {
    if (scene === "property_listing") return 95;
    if (scene === "open_home_event") return 90;
    if (scene === "market_update") return 85;
  }
  if (industry === "immigration") {
    if (scene === "visa_consultation") return 92;
    if (scene === "school_info") return 88;
    if (scene === "program_enrollment") return 90;
  }
  return 80; // Unknown scene fallback
}

/**
 * 基于启用模块列表推荐表单字段（Option B）。
 */
export function buildFormFieldsFromModules(
  industry: IndustryV2,
  selectedModules: ModuleTypeV2[],
  scene: SceneV2,
): FormBuilderResultV2 {
  const fieldPool = getFieldPoolForIndustry(industry);
  const selectedFieldIds = new Set<string>([...MANDATORY_FORM_FIELDS[industry]]);

  selectedModules.forEach((mod) => {
    if (mod === "hero" || mod === "form" || mod === "footer") {
      return;
    }
    // After filtering always-enabled, remaining are SelectableModuleType
    if (!(mod in FORM_FIELD_RULES_BY_MODULE)) {
      return;
    }
    const ids = fieldIdsForSelectableModule(mod as SelectableModuleType, industry, scene);
    ids.forEach((id) => selectedFieldIds.add(id));
  });

  const order = Array.from(selectedFieldIds);
  const selected_fields = order.map((id) => fieldPool[id]).filter((f): f is FormFieldDefinitionV2 => f != null);

  const groups = groupFormFieldsByCategory(order, industry);

  return {
    selected_fields,
    field_order: order,
    groups,
    confidence: confidenceForModules(scene, industry),
    reasoning: `Based on ${selectedModules.length} selected modules for ${industry} / ${scene}.`,
  };
}

export function buildFormFieldsFromRules(industry: IndustryV2, scene: SceneV2): FormBuilderResultV2 {
  // 已知 scene：使用经过优化的旧版规则
  if (isKnownSceneV2(scene)) {
    const rules =
      industry === "real_estate"
        ? FORM_FIELD_RULES.real_estate[scene as keyof typeof FORM_FIELD_RULES.real_estate]
        : FORM_FIELD_RULES.immigration[scene as keyof typeof FORM_FIELD_RULES.immigration];

    if (rules) {
      const fieldPool = getFieldPoolForIndustry(industry);
      const selected_fields = rules.select
        .map((id) => fieldPool[id])
        .filter((f): f is FormFieldDefinitionV2 => f != null);

      return {
        selected_fields,
        field_order: [...rules.select],
        groups: rules.groups.map((g) => ({ name: g.name, fields: [...g.fields] })),
        confidence: rules.confidence,
      };
    }
  }

  // 未知 scene：回退到通用联系字段
  return {
    selected_fields: [UNIVERSAL_FIELD_POOL_V2.name, UNIVERSAL_FIELD_POOL_V2.email, UNIVERSAL_FIELD_POOL_V2.phone].filter(
      Boolean,
    ),
    field_order: ["name", "email", "phone"],
    groups: [{ name: "Contact", fields: ["name", "email", "phone"] }],
    confidence: 50,
    reasoning: `Unknown scene "${scene}" — fallback to universal contact fields.`,
  };
}

/** Alias for Server Actions / docs. */
export function buildFormFieldsAction(industry: IndustryV2, scene: SceneV2): FormBuilderResultV2 {
  return buildFormFieldsFromRules(industry, scene);
}
