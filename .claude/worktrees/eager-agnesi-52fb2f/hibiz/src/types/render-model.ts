/** Public microsite render model (Phase 5, simplified v1). */

export interface RenderThemeV1 {
  preset: "trust_teal" | "warm_neutral" | "premium_minimal";
  density: "compact" | "comfortable";
  /** Skeleton flow: optional hex palette (overrides preset visuals when set). */
  skeleton_hex?: {
    primary: string;
    accent: string;
    background: string;
    fontFamily?: string;
  };
}

export interface RenderSeoV1 {
  title: string;
  description: string;
}

export type RenderModuleType =
  | "hero"
  | "offer"
  | "form"
  | "faq"
  | "about"
  | "contact"
  | "footer"
  | "listings"
  | "testimonials"
  | "openHome"
  | "services";

export interface RenderModuleBase {
  id: string;
  type: RenderModuleType;
  variant: string;
}

export interface HeroContent {
  eyebrow: string | null;
  title: string;
  subtitle: string;
  primary_cta_label: string;
  secondary_cta_label: string | null;
  subtitle_secondary?: string | null;
  image: { placeholder: string; alt: string };
}

export interface OfferContent {
  heading: string;
  bullets: string[];
  footnote: string | null;
}

export interface FormModuleContent {
  heading: string;
  description: string | null;
  form_ref: { form_id: string; public_slug: string };
  submit_label: string;
  privacy_note: string;
}

export interface FaqContent {
  heading: string;
  items: { q: string; a: string }[];
}

export interface AboutContent {
  heading: string;
  body: string;
  badge: string | null;
}

export interface ContactContent {
  heading: string;
  lines: string[];
  hours: string | null;
}

export interface FooterContent {
  brand: string;
  disclaimer: string;
  links: { label: string; href: string }[];
}

export interface ListingCardContent {
  id: string;
  name: string;
  address: string;
  description: string;
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  price_hint?: string;
  trademe_url?: string;
}

export interface ListingsContent {
  heading: string;
  items: ListingCardContent[];
}

export interface TestimonialsContent {
  heading: string;
  items: { quote: string; author: string; role?: string }[];
}

export interface OpenHomeContent {
  heading: string;
  lines: string[];
  cta_label: string | null;
}

export interface ServicesContent {
  heading: string;
  items: { title: string; description: string }[];
}

export type RenderModuleV1 =
  | (RenderModuleBase & { type: "hero"; content: HeroContent })
  | (RenderModuleBase & { type: "offer"; content: OfferContent })
  | (RenderModuleBase & { type: "form"; content: FormModuleContent })
  | (RenderModuleBase & { type: "faq"; content: FaqContent })
  | (RenderModuleBase & { type: "about"; content: AboutContent })
  | (RenderModuleBase & { type: "contact"; content: ContactContent })
  | (RenderModuleBase & { type: "footer"; content: FooterContent })
  | (RenderModuleBase & { type: "listings"; content: ListingsContent })
  | (RenderModuleBase & { type: "testimonials"; content: TestimonialsContent })
  | (RenderModuleBase & { type: "openHome"; content: OpenHomeContent })
  | (RenderModuleBase & { type: "services"; content: ServicesContent });

export interface RenderModelV1 {
  schema_version: 1;
  template_id: string;
  template_version: string;
  theme: RenderThemeV1;
  seo: RenderSeoV1;
  modules: RenderModuleV1[];
}

export function isRenderModelV1(data: unknown): data is RenderModelV1 {
  if (!data || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.schema_version === 1 && Array.isArray(o.modules);
}
