import type { RenderModelV1 } from "@/types/render-model";

/**
 * Minimal draft used to bootstrap "online website builder" mode without
 * requiring the AI generation pipeline first.
 */
export function createBuilderBootstrapRenderModel(input: {
  projectName: string;
  formId: string;
  publicSlug: string;
}): RenderModelV1 {
  const brand = input.projectName.trim() || "HiBiz";
  return {
    schema_version: 1,
    template_id: "builder-bootstrap",
    template_version: "v1",
    theme: {
      preset: "trust_teal",
      density: "comfortable",
    },
    seo: {
      title: `${brand} | Official Site`,
      description: `${brand} official website and enquiry form.`,
    },
    modules: [
      {
        id: "hero_1",
        type: "hero",
        variant: "default",
        content: {
          eyebrow: "Online Website Builder",
          title: brand,
          subtitle: "Start from this draft or attach Builder.io blocks above/below.",
          primary_cta_label: "Enquire now",
          secondary_cta_label: null,
          subtitle_secondary: null,
          image: { placeholder: "", alt: brand },
        },
      },
      {
        id: "form_1",
        type: "form",
        variant: "simple",
        content: {
          heading: "Get in touch",
          description: "Leave your details and we will contact you.",
          form_ref: { form_id: input.formId, public_slug: input.publicSlug },
          submit_label: "Send",
          privacy_note: "We respect your privacy.",
        },
      },
      {
        id: "footer_1",
        type: "footer",
        variant: "default",
        content: {
          brand,
          disclaimer: "Information on this page is for general guidance only.",
          links: [],
        },
      },
    ],
  };
}
