/** Structured intent v1 — aligns with product spec (Phase 5). */

export type CompiledLanguageMode = "en" | "en_bilingual_zh";

export type CompiledGoal = "lead_gen" | "booking" | "event_signup" | "assessment";

export type CompiledTone = "professional" | "warm" | "premium" | "casual";

export type RealEstateScene =
  | "open_home_registration"
  | "listing_promotion"
  | "free_appraisal"
  | "buyer_registration";

export type ImmigrationScene =
  | "free_assessment"
  | "consultation_booking"
  | "seminar_registration"
  | "program_lead_capture";

export type CompiledScene = RealEstateScene | ImmigrationScene;

export interface CompiledIntentV1 {
  schema_version: 1;
  industry: "immigration_education" | "real_estate";
  scene: CompiledScene;
  city: string | null;
  language_mode: CompiledLanguageMode;
  goal: CompiledGoal;
  needs_form: boolean;
  tone: CompiledTone;
  target_customer: string[];
  nz: {
    default_country: "NZ";
    region_hint: string | null;
  };
}

export interface ClarificationPayload {
  schema_version: 1;
  questions: Array<{
    id: string;
    type: "single_choice";
    prompt: string;
    options: { value: string; label: string }[];
  }>;
}
