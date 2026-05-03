import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_PROPERTY_SHOWCASE: TemplateSkeleton = {
  id: "property-showcase",
  name: "房源展示",
  nameEn: "Property Showcase",
  industry: "real_estate",
  description: "大图与房源卡片为主，适合多套在售",
  thumbnail: "/skeletons/property-showcase.png",
  modules: [
    { type: "hero", variant: "image-forward", visible: true },
    { type: "listings", variant: "card-grid", visible: true },
    { type: "services", variant: "three-col", visible: true },
    { type: "form", variant: "default", visible: true },
    { type: "contact", variant: "full-channels", visible: true },
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#0f172a",
    accent: "#0d9488",
    background: "#f8fafc",
    fontFamily: "inter",
    palettes: [
      { id: "teal-slate", name: "青灰", primary: "#0f172a", accent: "#0d9488", background: "#f8fafc" },
      { id: "ink-gold", name: "墨金", primary: "#1c1917", accent: "#d97706", background: "#fafaf9" },
      { id: "ocean", name: "海蓝", primary: "#164e63", accent: "#38bdf8", background: "#ecfeff" },
    ],
  },
  defaultFormTemplate: "buyer_inquiry",
};
