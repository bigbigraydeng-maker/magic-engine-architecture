import type { FormFieldRow } from "@/lib/generation/form-presets";

export type ValidatePayloadResult =
  | { ok: true; payload: Record<string, string> }
  | { ok: false; error: string };

function trimValue(v: unknown): string {
  if (typeof v !== "string") {
    return "";
  }
  return v.trim();
}

export function validateFormPayload(fields: FormFieldRow[], raw: Record<string, string>): ValidatePayloadResult {
  const out: Record<string, string> = {};

  for (const f of fields) {
    const value = trimValue(raw[f.key]);

    if (f.required && value.length === 0) {
      return { ok: false, error: `${f.label} is required.` };
    }

    if (value.length === 0) {
      continue;
    }

    if (f.max_length != null && value.length > f.max_length) {
      return { ok: false, error: `${f.label} is too long.` };
    }

    if (f.type === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { ok: false, error: `Please enter a valid email for ${f.label}.` };
      }
    }

    out[f.key] = value;
  }

  return { ok: true, payload: out };
}
