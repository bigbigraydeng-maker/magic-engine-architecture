import type { ArchLayer } from "./architecture-map-types";

export const TYPES_LAYER: ArchLayer = {
  id: "types",
  name: "类型",
  nameEn: "Types",
  color: "teal",
  icon: "🏷️",
  basePath: "src/types/",
  groups: [
    {
      name: "核心模型",
      description: "意图、渲染模型、商家资料",
      files: [
        {
          path: "compiled-intent.ts",
          description: "CompiledIntentV1",
          imports: [],
          importedBy: ["lib/compiler/rule-based.ts", "lib/generation/assemble.ts"],
        },
        {
          path: "render-model.ts",
          description: "RenderModelV1 / 区块枚举",
          imports: [],
          importedBy: ["lib/generation/assemble.ts", "components/microsite/RenderMicrosite.tsx"],
        },
        {
          path: "merchant-profile.ts",
          description: "商家资料 JSON 形状",
          imports: [],
          importedBy: ["app/projects/merchant-profile-actions.ts", "lib/merchant-profile/render-merge.ts"],
        },
        {
          path: "hibiz.ts",
          description: "共享业务常量 / 辅助类型",
          imports: [],
          importedBy: ["多模块"],
        },
        {
          path: "skeleton.ts",
          description: "TemplateSkeleton（v0.2.2）",
          imports: [],
          importedBy: [],
          isNew: true,
        },
      ],
    },
  ],
};

export const DATA_LAYER: ArchLayer = {
  id: "data",
  name: "数据",
  nameEn: "Data",
  color: "amber",
  icon: "📦",
  basePath: "src/data/",
  groups: [
    {
      name: "模板与内容",
      description: "预设、海报、进度与架构元数据",
      files: [
        {
          path: "template-presets.ts",
          description: "行业场景预设文案",
          imports: ["types/compiled-intent.ts"],
          importedBy: ["app/projects/new/page.tsx"],
        },
        {
          path: "poster-templates.ts",
          description: "海报版式定义",
          imports: [],
          importedBy: ["components/poster/PosterDesignedLayout.tsx"],
        },
        {
          path: "dev-progress.ts",
          description: "开发进度 + 路线图数据",
          imports: [],
          importedBy: ["app/progress/page.tsx", "app/progress/roadmap/page.tsx"],
        },
        {
          path: "architecture-map.ts",
          description: "分层架构与依赖示意",
          imports: [],
          importedBy: ["app/progress/architecture/page.tsx"],
        },
      ],
    },
    {
      name: "骨架目录（v0.2.2）",
      description: "预制骨架 JSON",
      files: [
        {
          path: "skeletons/index.ts",
          description: "骨架导出入口",
          imports: [],
          importedBy: ["app/app/projects/new/page.tsx", "skeleton-create-actions.ts"],
        },
      ],
    },
  ],
};
