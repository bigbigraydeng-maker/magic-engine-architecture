import type { IndustryId } from "@/types/hibiz";

export function footerDisclaimer(industry: IndustryId): string {
  if (industry === "real_estate") {
    return (
      "Information on this page is for general marketing only and is not a substitute for professional advice. " +
      "Any property listing details should be confirmed before reliance. Privacy Act 2020 (NZ): we collect your details only to respond to this enquiry."
    );
  }
  return (
    "This page provides general information only and is not immigration or legal advice. " +
    "Outcomes depend on your circumstances and official criteria. Privacy Act 2020 (NZ): we use your details to respond to your enquiry."
  );
}

export function formPrivacyNote(industry: IndustryId): string {
  if (industry === "real_estate") {
    return "We’ll use your details to contact you about this property or similar listings.";
  }
  return "We’ll use your details to respond to your enquiry and may follow up about related services.";
}
