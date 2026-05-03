import type { CompiledIntentV1 } from "@/types/compiled-intent";

/** Skeleton / 独立表单场景（不依赖 CompiledIntent） */
export type FormTemplateId = "open_home_registration" | "buyer_inquiry" | "property_valuation";

export interface FormFieldRow {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "email" | "phone" | "textarea" | "select" | "multiselect";
  required: boolean;
  max_length?: number;
  options?: string[];
}

export interface FormFieldsFileV1 {
  schema_version: 1;
  version: 1;
  fields: FormFieldRow[];
}

export function isFormFieldsFileV1(data: unknown): data is FormFieldsFileV1 {
  if (!data || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.schema_version === 1 && o.version === 1 && Array.isArray(o.fields);
}

export function buildFormFromTemplate(templateId: FormTemplateId): FormFieldsFileV1 {
  switch (templateId) {
    case "open_home_registration":
      return {
        schema_version: 1,
        version: 1,
        fields: [
          {
            key: "full_name",
            label: "Full name",
            placeholder: "Your name",
            type: "text",
            required: true,
            max_length: 120,
          },
          {
            key: "phone",
            label: "Phone",
            placeholder: "NZ mobile",
            type: "phone",
            required: true,
            max_length: 40,
          },
          {
            key: "email",
            label: "Email",
            placeholder: "name@example.com",
            type: "email",
            required: true,
            max_length: 200,
          },
          {
            key: "attendee_count",
            label: "How many attending?",
            placeholder: "e.g. 2",
            type: "text",
            required: false,
            max_length: 20,
          },
          {
            key: "preferred_time",
            label: "Preferred time",
            placeholder: "",
            type: "select",
            required: false,
            options: ["Morning", "Afternoon", "Either"],
          },
          {
            key: "message",
            label: "Message",
            placeholder: "Any questions?",
            type: "textarea",
            required: false,
            max_length: 800,
          },
        ],
      };
    case "buyer_inquiry":
      return {
        schema_version: 1,
        version: 1,
        fields: [
          {
            key: "full_name",
            label: "Full name",
            placeholder: "Your name",
            type: "text",
            required: true,
            max_length: 120,
          },
          { key: "email", label: "Email", placeholder: "name@example.com", type: "email", required: true, max_length: 200 },
          { key: "phone", label: "Phone", placeholder: "NZ mobile", type: "phone", required: true, max_length: 40 },
          {
            key: "budget_range",
            label: "Budget range",
            placeholder: "e.g. up to $1.2m",
            type: "text",
            required: false,
            max_length: 80,
          },
          {
            key: "preferred_areas",
            label: "Preferred areas",
            placeholder: "e.g. North Shore, CBD",
            type: "text",
            required: false,
            max_length: 200,
          },
          {
            key: "property_type",
            label: "Property type",
            placeholder: "",
            type: "select",
            required: false,
            options: ["House", "Apartment", "Townhouse", "Land", "Any"],
          },
          {
            key: "timeline",
            label: "Buying timeline",
            placeholder: "",
            type: "select",
            required: false,
            options: ["ASAP", "1–3 months", "3–6 months", "Just browsing"],
          },
          {
            key: "message",
            label: "Additional notes",
            placeholder: "Bedrooms, schools, etc.",
            type: "textarea",
            required: false,
            max_length: 800,
          },
        ],
      };
    case "property_valuation":
      return {
        schema_version: 1,
        version: 1,
        fields: [
          {
            key: "full_name",
            label: "Full name",
            placeholder: "Your name",
            type: "text",
            required: true,
            max_length: 120,
          },
          { key: "email", label: "Email", placeholder: "name@example.com", type: "email", required: true, max_length: 200 },
          { key: "phone", label: "Phone", placeholder: "NZ mobile", type: "phone", required: true, max_length: 40 },
          {
            key: "property_address",
            label: "Property address",
            placeholder: "Street, suburb",
            type: "text",
            required: true,
            max_length: 300,
          },
          {
            key: "property_type",
            label: "Property type",
            placeholder: "",
            type: "select",
            required: false,
            options: ["House", "Apartment", "Townhouse", "Rural", "Other"],
          },
          {
            key: "bedrooms",
            label: "Bedrooms",
            placeholder: "e.g. 3",
            type: "text",
            required: false,
            max_length: 10,
          },
          {
            key: "message",
            label: "Anything else we should know?",
            placeholder: "Optional",
            type: "textarea",
            required: false,
            max_length: 800,
          },
        ],
      };
    default: {
      const _exhaustive: never = templateId;
      return _exhaustive;
    }
  }
}

export function normalizeFormTemplateId(raw: string): FormTemplateId {
  if (raw === "open_home_registration" || raw === "buyer_inquiry" || raw === "property_valuation") {
    return raw;
  }
  return "open_home_registration";
}

export function buildFormPreset(compiled: CompiledIntentV1): FormFieldsFileV1 {
  const base: FormFieldRow[] = [
    { key: "full_name", label: "Full name", placeholder: "Your name", type: "text", required: true, max_length: 120 },
    { key: "email", label: "Email", placeholder: "name@example.com", type: "email", required: true, max_length: 200 },
    { key: "phone", label: "Phone", placeholder: "NZ mobile", type: "phone", required: true, max_length: 40 },
  ];

  if (compiled.industry === "real_estate") {
    if (compiled.scene === "open_home_registration") {
      base.push({
        key: "attendee_count",
        label: "How many people attending?",
        placeholder: "e.g. 2",
        type: "text",
        required: false,
        max_length: 20,
      });
    }
    base.push({
      key: "message",
      label: "Message / questions",
      placeholder: "Optional notes",
      type: "textarea",
      required: false,
      max_length: 800,
    });
    return { schema_version: 1, version: 1, fields: base };
  }

  base.push({
    key: "message",
    label: "How can we help?",
    placeholder: "Brief background or goals",
    type: "textarea",
    required: false,
    max_length: 800,
  });
  return { schema_version: 1, version: 1, fields: base };
}
