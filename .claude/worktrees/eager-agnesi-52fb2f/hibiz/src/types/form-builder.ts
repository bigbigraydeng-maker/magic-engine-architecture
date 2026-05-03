/**
 * Form Builder V2 — 基于 industry + scene 的规则表（零 LLM 成本）。
 */

import type {
  FormFieldDefinitionV2,
  IndustryV2,
  SceneV2,
  SelectableModuleType,
} from "@/types/compiled-intent-v2";

export type { FormFieldDefinitionV2 };

export interface FormBuilderRequestV2 {
  industry: IndustryV2;
  scene: SceneV2;
}

export interface FormBuilderResultV2 {
  selected_fields: FormFieldDefinitionV2[];
  field_order: string[];
  groups: Array<{ name: string; fields: string[] }>;
  /** 规则匹配度 0–100 */
  confidence: number;
  reasoning?: string;
}

function field(partial: Omit<FormFieldDefinitionV2, "id"> & { id: string }): FormFieldDefinitionV2 {
  return { ...partial };
}

export const UNIVERSAL_FIELD_POOL_V2: Record<string, FormFieldDefinitionV2> = {
  name: field({
    id: "name",
    label: "Full name",
    type: "text",
    required: true,
    placeholder: "Your full name",
  }),
  email: field({
    id: "email",
    label: "Email",
    type: "email",
    required: true,
    placeholder: "your.email@example.com",
  }),
  phone: field({
    id: "phone",
    label: "Phone",
    type: "phone",
    required: true,
    placeholder: "+64 (0)9 123 4567",
  }),
  message: field({
    id: "message",
    label: "Message",
    type: "textarea",
    required: false,
    placeholder: "Tell us more…",
  }),
};

export const REAL_ESTATE_FIELD_POOL_V2: Record<string, FormFieldDefinitionV2> = {
  ...UNIVERSAL_FIELD_POOL_V2,
  property_address: field({
    id: "property_address",
    label: "Property address",
    type: "text",
    required: false,
    placeholder: "e.g. 123 Main Street, Auckland",
  }),
  property_type: field({
    id: "property_type",
    label: "Property type",
    type: "select",
    required: false,
    options: [
      { value: "residential", label: "Residential" },
      { value: "commercial", label: "Commercial" },
      { value: "land", label: "Land" },
    ],
  }),
  bedrooms: field({
    id: "bedrooms",
    label: "Bedrooms",
    type: "select",
    required: false,
    options: [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4+", label: "4+" },
    ],
  }),
  inspection_date: field({
    id: "inspection_date",
    label: "Preferred inspection date",
    type: "date",
    required: false,
  }),
  budget: field({
    id: "budget",
    label: "Budget range",
    type: "text",
    required: false,
    placeholder: "e.g. $500k – $700k",
  }),
};

export const IMMIGRATION_FIELD_POOL_V2: Record<string, FormFieldDefinitionV2> = {
  ...UNIVERSAL_FIELD_POOL_V2,
  visa_type: field({
    id: "visa_type",
    label: "Visa type",
    type: "select",
    required: false,
    options: [
      { value: "student", label: "Student visa" },
      { value: "work", label: "Work visa" },
      { value: "residence", label: "Residence" },
      { value: "business", label: "Business" },
    ],
  }),
  current_location: field({
    id: "current_location",
    label: "Current location",
    type: "text",
    required: false,
    placeholder: "Country or city",
  }),
  education_level: field({
    id: "education_level",
    label: "Highest education",
    type: "select",
    required: false,
    options: [
      { value: "high_school", label: "High school" },
      { value: "bachelor", label: "Bachelor's degree" },
      { value: "master", label: "Master's degree" },
      { value: "phd", label: "PhD" },
    ],
  }),
  work_experience: field({
    id: "work_experience",
    label: "Years of work experience",
    type: "text",
    required: false,
    placeholder: "e.g. 5 years",
  }),
  english_proficiency: field({
    id: "english_proficiency",
    label: "English proficiency (IELTS / PTE)",
    type: "text",
    required: false,
    placeholder: "e.g. IELTS 6.5",
  }),
};

export const INDUSTRY_FIELD_POOLS_V2: Record<IndustryV2, Record<string, FormFieldDefinitionV2>> = {
  real_estate: REAL_ESTATE_FIELD_POOL_V2,
  immigration: IMMIGRATION_FIELD_POOL_V2,
};

type RuleEntry = {
  select: readonly string[];
  groups: readonly { name: string; fields: readonly string[] }[];
  confidence: number;
};

export const FORM_FIELD_RULES: {
  real_estate: Record<"property_listing" | "open_home_event" | "market_update", RuleEntry>;
  immigration: Record<"visa_consultation" | "school_info" | "program_enrollment", RuleEntry>;
} = {
  real_estate: {
    property_listing: {
      select: ["name", "email", "phone", "property_address", "property_type", "bedrooms", "budget", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Property interest", fields: ["property_address", "property_type", "bedrooms", "budget"] },
        { name: "Additional", fields: ["message"] },
      ],
      confidence: 95,
    },
    open_home_event: {
      select: ["name", "email", "phone", "inspection_date", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Inspection", fields: ["inspection_date"] },
        { name: "Questions", fields: ["message"] },
      ],
      confidence: 90,
    },
    market_update: {
      select: ["email", "name"],
      groups: [{ name: "Subscribe", fields: ["name", "email"] }],
      confidence: 85,
    },
  },
  immigration: {
    visa_consultation: {
      select: ["name", "email", "phone", "visa_type", "current_location", "english_proficiency", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Visa info", fields: ["visa_type", "current_location", "english_proficiency"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 92,
    },
    school_info: {
      select: ["name", "email", "phone", "education_level", "current_location", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Background", fields: ["education_level", "current_location"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 88,
    },
    program_enrollment: {
      select: ["name", "email", "phone", "education_level", "work_experience", "message"],
      groups: [
        { name: "Contact", fields: ["name", "email", "phone"] },
        { name: "Background", fields: ["education_level", "work_experience"] },
        { name: "Message", fields: ["message"] },
      ],
      confidence: 90,
    },
  },
};

// ═══ Option B：模块 → 表单字段 ID（与 llm-form-builder 组合使用）══════════════════

/** 模块级字段规则；空数组表示该模块不额外增加字段（由场景或其它模块覆盖） */
export const FORM_FIELD_RULES_BY_MODULE: Record<
  SelectableModuleType,
  {
    real_estate?: readonly string[];
    immigration?: readonly string[];
  }
> = {
  offer: {
    real_estate: ["property_address", "property_type", "bedrooms", "budget", "message"],
    immigration: ["visa_type", "current_location", "english_proficiency", "message"],
  },
  faq: {
    real_estate: [],
    immigration: [],
  },
  about: {
    real_estate: [],
    immigration: [],
  },
  contact: {
    real_estate: [],
    immigration: [],
  },
  listings: {
    real_estate: ["property_address", "property_type", "bedrooms", "budget"],
    immigration: [],
  },
  testimonials: {
    real_estate: [],
    immigration: [],
  },
  openHome: {
    real_estate: ["inspection_date", "message"],
    immigration: [],
  },
  services: {
    real_estate: [],
    immigration: [],
  },
};

/** 全场景通用必填（与旧规则 contact 核心一致） */
export const MANDATORY_FORM_FIELDS: Record<IndustryV2, readonly string[]> = {
  real_estate: ["name", "email", "phone"],
  immigration: ["name", "email", "phone"],
};
