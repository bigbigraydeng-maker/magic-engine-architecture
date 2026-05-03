import type { TemplateSkeleton } from "@/types/skeleton";

export const SKELETON_AGENT_PRO: TemplateSkeleton = {
  id: "agent-pro",
  name: "专业经纪人",
  nameEn: "Agent Pro",
  industry: "real_estate",
  description: "参考顶级经纪人网站设计，突出业绩数据、房源展示与客户评价",
  thumbnail: "/skeletons/agent-pro.png",
  modules: [
    { type: "hero", variant: "agent-brand", visible: true },
    {
      type: "offer",
      variant: "stats-counter",
      visible: true,
      defaultContent: {
        heading: "Proven Results",
        items: [
          { label: "Properties Sold", value: "500+" },
          { label: "5-Star Reviews", value: "200+" },
          { label: "Years Experience", value: "15+" },
          { label: "Suburbs Covered", value: "30+" },
        ],
      },
    },
    { type: "listings", variant: "card-grid", visible: true },
    { type: "services", variant: "icon-grid", visible: true },
    { type: "testimonials", variant: "quote-cards", visible: true },
    { type: "about", variant: "side-by-side", visible: true },
    { type: "faq", variant: "accordion", visible: true },
    { type: "form", variant: "default", visible: true },
    { type: "contact", variant: "full-channels", visible: true },
    { type: "footer", variant: "legal", visible: true },
  ],
  theme: {
    primary: "#001c48",
    accent: "#fb8e28",
    background: "#ffffff",
    fontFamily: "inter",
    palettes: [
      { id: "deep-blue-orange", name: "深蓝橙", primary: "#001c48", accent: "#fb8e28", background: "#ffffff" },
      { id: "yellow-charcoal", name: "明黄炭灰", primary: "#57585A", accent: "#FCE620", background: "#ffffff" },
      { id: "forest-gold", name: "森林金", primary: "#1a4731", accent: "#d4a853", background: "#f9f7f2" },
    ],
  },
  defaultFormTemplate: "property_valuation",
};
