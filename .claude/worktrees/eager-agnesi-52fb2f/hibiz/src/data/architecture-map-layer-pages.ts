import type { ArchLayer } from "./architecture-map-types";

export const PAGES_LAYER: ArchLayer = {
  id: "pages",
  name: "页面",
  nameEn: "Pages",
  color: "blue",
  icon: "📄",
  basePath: "src/app/",
  groups: [
    {
      name: "营销与认证",
      description: "落地页、登录与 Auth 回调",
      files: [
        { path: "page.tsx", description: "站点首页", imports: [], importedBy: [] },
        {
          path: "login/page.tsx",
          description: "Magic Link 登录",
          imports: ["components/login 内联表单"],
          importedBy: [],
        },
        {
          path: "auth/callback/route.ts",
          description: "Supabase OAuth / Magic Link 回调",
          imports: ["lib/supabase/server.ts"],
          importedBy: [],
        },
      ],
    },
    {
      name: "商家工作台",
      description: "项目管理、生成、预览、海报与线索",
      files: [
        {
          path: "app/projects/page.tsx",
          description: "项目列表",
          imports: ["lib/supabase/server.ts"],
          importedBy: [],
        },
        {
          path: "app/projects/new/page.tsx",
          description: "新建项目（自然语言 / 预设）",
          imports: ["data/template-presets.ts", "app/projects/generate-microsite-form.tsx"],
          importedBy: [],
        },
        {
          path: "app/projects/[id]/page.tsx",
          description: "项目详情与编辑入口",
          imports: [
            "app/projects/intent-actions.ts",
            "app/projects/generation-actions.ts",
            "app/projects/merchant-profile-actions.ts",
          ],
          importedBy: [],
        },
        {
          path: "app/projects/[id]/preview/page.tsx",
          description: "草稿预览 ?preview=1",
          imports: ["components/microsite/RenderMicrosite.tsx"],
          importedBy: [],
        },
        {
          path: "app/projects/[id]/poster/page.tsx",
          description: "房产海报打印视图",
          imports: ["data/poster-templates.ts", "lib/merchant-profile/poster-images.ts"],
          importedBy: [],
        },
        {
          path: "app/projects/[id]/leads/page.tsx",
          description: "留资线索列表",
          imports: ["lib/supabase/server.ts"],
          importedBy: [],
        },
        {
          path: "app/projects/intent-actions.ts",
          description: "意图编译 Server Actions",
          imports: ["lib/compiler/rule-based.ts", "types/compiled-intent.ts"],
          importedBy: ["app/projects/new/page.tsx", "app/projects/[id]/page.tsx"],
        },
        {
          path: "app/projects/generation-actions.ts",
          description: "文案生成与装配 Actions",
          imports: [
            "lib/generation/openai-copy.ts",
            "lib/generation/assemble.ts",
            "types/render-model.ts",
          ],
          importedBy: ["app/projects/[id]/page.tsx"],
        },
        {
          path: "app/projects/merchant-profile-actions.ts",
          description: "商家资料与 TradeMe 提取",
          imports: ["lib/extraction/extraction-layers.ts", "types/merchant-profile.ts"],
          importedBy: ["app/projects/[id]/page.tsx"],
        },
        {
          path: "actions/submit-lead.ts",
          description: "匿名表单提交（蜜罐 + 校验）",
          imports: ["lib/forms/validate-payload.ts", "lib/supabase/server.ts"],
          importedBy: ["forms/[public_slug]/page.tsx"],
        },
      ],
    },
    {
      name: "公开访客面",
      description: "已发布微站与独立表单",
      files: [
        {
          path: "site/[slug]/page.tsx",
          description: "公开微站渲染",
          imports: ["components/microsite/RenderMicrosite.tsx"],
          importedBy: [],
        },
        {
          path: "forms/[public_slug]/page.tsx",
          description: "独立留资表单页",
          imports: ["components/microsite/LeadFormBlock.tsx", "actions/submit-lead.ts"],
          importedBy: [],
        },
      ],
    },
    {
      name: "内部看板",
      description: "开发进度与架构说明",
      files: [
        {
          path: "progress/page.tsx",
          description: "任务进度 Tab",
          imports: ["data/dev-progress.ts"],
          importedBy: [],
        },
        {
          path: "progress/roadmap/page.tsx",
          description: "版本路线图 Tab",
          imports: ["data/dev-progress.ts"],
          importedBy: [],
        },
        {
          path: "progress/architecture/page.tsx",
          description: "文件架构 Tab",
          imports: ["data/architecture-map.ts"],
          importedBy: [],
        },
      ],
    },
  ],
};
