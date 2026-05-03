import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_BILINGUAL_PRO: TemplateSkeleton = {
  id: "bilingual-pro",
  name: "双语专业版",
  nameEn: "Bilingual Pro",
  industry: "real_estate",
  description: "中英双语区块，适合华人买家与本地卖家",
  thumbnail: "/skeletons/bilingual-pro.png",
  modules: [
    { type: "hero", variant: "bilingual-stack", visible: true },
    { type: "about", variant: "bilingual", visible: true },
    { type: "listings", variant: "card-grid", visible: true },
    { type: "faq", variant: "accordion_style", visible: true },
    { type: "form", variant: "default", visible: true },
    { type: "contact", variant: "full-channels", visible: true },
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#292524",
    accent: "#b45309",
    background: "#fffbeb",
    fontFamily: "inter",
    palettes: [
      { id: "warm-stone", name: "暖石", primary: "#292524", accent: "#b45309", background: "#fffbeb" },
      { id: "forest-gold", name: "森绿金", primary: "#14532d", accent: "#ca8a04", background: "#f7fee7" },
      { id: "neutral-pro", name: "极简灰", primary: "#374151", accent: "#2563eb", background: "#ffffff" },
    ],
  },
  defaultFormTemplate: "property_valuation",
};
