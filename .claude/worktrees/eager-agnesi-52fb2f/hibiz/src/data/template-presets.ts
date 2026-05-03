/**
 * Named templates / scenarios for Phase 1 — used in UI copy and Progress.
 * We do not operate a listing feed; real-estate promotion uses manual property fields + poster.
 */

import type { IndustryId } from "@/types/hibiz";

export interface TemplatePreset {
  id: string;
  industry: IndustryId;
  /** Short label for UI */
  title: string;
  summary: string;
  /** What the customer describes in plain English (hint text) */
  promptHint: string;
}

export const REAL_ESTATE_TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "re_open_home",
    industry: "real_estate",
    title: "Open home registration",
    summary: "Collect visitors for a scheduled viewing; emphasise time and suburb.",
    promptHint: "Open home this Sunday 2–3pm for a 3-bed in Mount Eden. Collect name, phone, email.",
  },
  {
    id: "re_buyer_lead",
    industry: "real_estate",
    title: "Buyer / appraisal lead",
    summary: "General enquiry for buyers or appraisal requests — no listing sync.",
    promptHint: "Landing page for buyers in Auckland wanting a free chat before they list.",
  },
  {
    id: "re_property_promo",
    industry: "real_estate",
    title: "Property promotion + poster",
    summary: "Use your own copy, image URL, and optional TradeMe link — we generate a printable poster (no listing API).",
    promptHint: "Promote one property with photos and details you provide; link to your TradeMe ad if you have one.",
  },
];

export const IMMIGRATION_TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "im_assessment",
    industry: "immigration_education",
    title: "Free assessment",
    summary: "Lead capture for eligibility / points questions.",
    promptHint: "Free 15-minute assessment for skilled migrant pathways; collect contact and current visa status.",
  },
  {
    id: "im_seminar",
    industry: "immigration_education",
    title: "Seminar / event signup",
    summary: "Registrations for in-person or online sessions.",
    promptHint: "Register interest for our April seminar on study-to-work pathways in Auckland.",
  },
  {
    id: "im_consultation",
    industry: "immigration_education",
    title: "Consultation booking lead",
    summary: "Book a paid or free consultation — form-first.",
    promptHint: "Book a consultation for education and visa planning; bilingual English + key Chinese.",
  },
];

export const TEMPLATE_PRESETS_ALL: TemplatePreset[] = [...REAL_ESTATE_TEMPLATE_PRESETS, ...IMMIGRATION_TEMPLATE_PRESETS];
