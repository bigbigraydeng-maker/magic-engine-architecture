import type { ArchLayer } from "./architecture-map-types";

export const COMPONENTS_LAYER: ArchLayer = {
  id: "components",
  name: "组件",
  nameEn: "Components",
  color: "violet",
  icon: "🧩",
  basePath: "src/components/",
  groups: [
    {
      name: "微站与表单",
      description: "RenderModel 驱动渲染",
      files: [
        {
          path: "microsite/RenderMicrosite.tsx",
          description: "微站区块装配与渲染",
          imports: ["types/render-model.ts"],
          importedBy: ["app/site/[slug]/page.tsx", "app/projects/[id]/preview/page.tsx"],
        },
        {
          path: "microsite/LeadFormBlock.tsx",
          description: "留资表单 UI + 提交",
          imports: ["types/render-model.ts"],
          importedBy: ["app/forms/[public_slug]/page.tsx"],
        },
        {
          path: "SiteHeader.tsx",
          description: "站点顶栏",
          imports: [],
          importedBy: ["microsite/RenderMicrosite.tsx"],
        },
      ],
    },
    {
      name: "海报",
      description: "海报布局与提示面板",
      files: [
        {
          path: "poster/PosterDesignedLayout.tsx",
          description: "可打印海报版式",
          imports: ["types/render-model.ts", "data/poster-templates.ts"],
          importedBy: ["app/projects/[id]/poster/page.tsx"],
        },
        {
          path: "poster/PosterPromptPanel.tsx",
          description: "海报文案/图片侧栏",
          imports: [],
          importedBy: ["app/projects/[id]/poster/page.tsx"],
        },
      ],
    },
    {
      name: "看板导航",
      description: "Progress 三 Tab 客户端高亮",
      files: [
        {
          path: "progress-tabs.tsx",
          description: "usePathname + Tab Link",
          imports: [],
          importedBy: ["app/progress/layout.tsx"],
        },
      ],
    },
  ],
};
