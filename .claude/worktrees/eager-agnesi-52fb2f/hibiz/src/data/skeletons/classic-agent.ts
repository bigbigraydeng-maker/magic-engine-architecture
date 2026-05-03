import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_CLASSIC_AGENT: TemplateSkeleton = {
  id: "classic-agent",
  name: "经典中介",
  nameEn: "Classic Agent",
  industry: "real_estate",
  description: "专业稳重，突出个人品牌与房源矩阵",
  thumbnail: "/skeletons/classic-agent.png",
  modules: [
    { type: "hero", variant: "agent-photo", visible: true },
    { type: "listings", variant: "card-grid", visible: true },
    { type: "about", variant: "side-by-side", visible: true },
    { type: "testimonials", variant: "quote-cards", visible: true },
    { type: "openHome", variant: "timeline", visible: true },
    { type: "form", variant: "default", visible: true },
    { type: "contact", variant: "full-channels", visible: true },
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#1e3a5f",
    accent: "#c9952c",
    background: "#ffffff",
    fontFamily: "inter",
    palettes: [
      { id: "navy-gold", name: "深蓝金", primary: "#1e3a5f", accent: "#c9952c", background: "#ffffff" },
      { id: "slate-emerald", name: "石板翠", primary: "#334155", accent: "#059669", background: "#f8fafc" },
      { id: "charcoal-coral", name: "炭灰珊瑚", primary: "#1f2937", accent: "#f43f5e", background: "#ffffff" },
    ],
  },
  defaultFormTemplate: "open_home_registration",
};
