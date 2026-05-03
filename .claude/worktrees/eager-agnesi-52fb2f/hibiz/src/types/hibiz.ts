/** Phase 1 industries (no restaurant). */
export type IndustryId = "immigration_education" | "real_estate";

/** Landing / marketing emphasis — does not remove presets from the product. */
export type IndustryFocus = "primary" | "secondary";

export const INDUSTRIES: { id: IndustryId; label: string; description: string; focus: IndustryFocus }[] = [
  {
    id: "real_estate",
    label: "Real estate",
    description:
      "Our current GTM focus: open homes, buyer leads, appraisals — manual promo, posters, and NZ TradeMe-aware workflows.",
    focus: "primary",
  },
  {
    id: "immigration_education",
    label: "Immigration & education",
    description:
      "Presets and flows still exist for advisors; we are not marketing this vertical first while we deepen property workflows.",
    focus: "secondary",
  },
];

export type ProjectStatus =
  | "draft"
  | "intent_drafting"
  | "intent_ready"
  | "generating"
  | "generation_failed"
  | "ready_draft"
  | "published";
