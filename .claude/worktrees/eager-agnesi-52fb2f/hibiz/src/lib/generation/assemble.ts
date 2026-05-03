import type { CompiledIntentV1 } from "@/types/compiled-intent";
import type { RenderModelV1 } from "@/types/render-model";
import type { GeneratedCopyV1 } from "./openai-copy";
import { footerDisclaimer, formPrivacyNote } from "./compliance";

export { assembleRenderModelFromSkeleton, resolveActiveSkeletonModuleEntries } from "./assemble-skeleton";

function themeFromTone(compiled: CompiledIntentV1): RenderModelV1["theme"] {
  if (compiled.industry === "real_estate") {
    return { preset: "trust_teal", density: "comfortable" };
  }
  return { preset: "warm_neutral", density: "comfortable" };
}

export function assembleRenderModel(input: {
  compiled: CompiledIntentV1;
  copy: GeneratedCopyV1;
  formId: string;
  publicSlug: string;
  projectName: string;
  businessBrand: string;
}): RenderModelV1 {
  const { compiled, copy, formId, publicSlug, projectName, businessBrand } = input;
  const disclaimer = footerDisclaimer(compiled.industry);
  const privacyNote = formPrivacyNote(compiled.industry);

  const modules: RenderModelV1["modules"] = [
    {
      id: "hero",
      type: "hero",
      variant: "stack_center",
      content: {
        eyebrow: copy.hero.eyebrow,
        title: copy.hero.title,
        subtitle: copy.hero.subtitle,
        primary_cta_label: copy.hero.primary_cta_label,
        secondary_cta_label: copy.hero.secondary_cta_label,
        subtitle_secondary: copy.hero.subtitle_secondary ?? null,
        image: { placeholder: "property_exterior", alt: `${businessBrand} hero` },
      },
    },
    {
      id: "offer",
      type: "offer",
      variant: "bullets",
      content: {
        heading: copy.offer.heading,
        bullets: copy.offer.bullets.length > 0 ? copy.offer.bullets : ["Local expertise", "Clear next steps", "Responsive follow-up"],
        footnote: copy.offer.footnote,
      },
    },
    {
      id: "form",
      type: "form",
      variant: "default",
      content: {
        heading: copy.form_section.heading,
        description: copy.form_section.description,
        form_ref: { form_id: formId, public_slug: publicSlug },
        submit_label: copy.form_section.submit_label,
        privacy_note: privacyNote,
      },
    },
    {
      id: "faq",
      type: "faq",
      variant: "accordion_style",
      content: {
        heading: copy.faq.heading,
        items:
          copy.faq.items.length >= 2
            ? copy.faq.items
            : [
                { q: "How quickly will you respond?", a: "We aim to reply within one business day." },
                { q: "What happens to my details?", a: "We use them only to respond to this enquiry, in line with NZ privacy expectations." },
              ],
      },
    },
    {
      id: "about",
      type: "about",
      variant: "simple",
      content: {
        heading: copy.about.heading,
        body: copy.about.body,
        badge: copy.about.badge,
      },
    },
    {
      id: "contact",
      type: "contact",
      variant: "lines",
      content: {
        heading: copy.contact.heading,
        lines: copy.contact.lines.length > 0 ? copy.contact.lines : ["Update your phone and email in project settings."],
        hours: copy.contact.hours,
      },
    },
    {
      id: "footer",
      type: "footer",
      variant: "legal",
      content: {
        brand: businessBrand,
        disclaimer,
        links: [{ label: "Privacy", href: "#privacy-note" }],
      },
    },
  ];

  return {
    schema_version: 1,
    template_id: `${compiled.industry}_${compiled.scene}_v1`,
    template_version: "1.0.0",
    theme: themeFromTone(compiled),
    seo: {
      title: copy.seo_title || projectName,
      description: copy.seo_description,
    },
    modules,
  };
}
