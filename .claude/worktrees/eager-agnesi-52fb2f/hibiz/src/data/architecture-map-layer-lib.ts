import type { ArchLayer } from "./architecture-map-types";

export const LIB_LAYER: ArchLayer = {
  id: "lib",
  name: "业务逻辑",
  nameEn: "Lib",
  color: "orange",
  icon: "⚙️",
  basePath: "src/lib/",
  groups: [
    {
      name: "编译与守卫",
      description: "规则意图编译",
      files: [
        {
          path: "compiler/rule-based.ts",
          description: "规则编译器（确定性）",
          imports: ["types/compiled-intent.ts", "compiler/guards.ts"],
          importedBy: ["app/projects/intent-actions.ts"],
        },
        {
          path: "compiler/guards.ts",
          description: "Rule Guard 预过滤",
          imports: [],
          importedBy: ["compiler/rule-based.ts"],
        },
      ],
    },
    {
      name: "URL 提取管线",
      description: "API → __NEXT_DATA__ → Jina + LLM",
      files: [
        {
          path: "extraction/extraction-layers.ts",
          description: "多层编排入口",
          imports: [
            "extraction/trademe-api.ts",
            "extraction/extract-next-data.ts",
            "extraction/extract-listing.ts",
          ],
          importedBy: ["app/projects/merchant-profile-actions.ts"],
        },
        {
          path: "extraction/trademe-api.ts",
          description: "TradeMe OAuth 1.0a 官方 API",
          imports: [],
          importedBy: ["extraction/extraction-layers.ts"],
        },
        {
          path: "extraction/extract-next-data.ts",
          description: "__NEXT_DATA__ 解析",
          imports: [],
          importedBy: ["extraction/extraction-layers.ts"],
        },
        {
          path: "extraction/extract-listing.ts",
          description: "Jina + OpenAI 兜底提取",
          imports: ["extraction/jina-reader.ts"],
          importedBy: ["extraction/extraction-layers.ts"],
        },
        {
          path: "extraction/image-proxy.ts",
          description: "图片拉取写入 Supabase Storage",
          imports: [],
          importedBy: ["extraction/extraction-layers.ts"],
        },
      ],
    },
    {
      name: "生成与装配",
      description: "文案生成 + RenderModel",
      files: [
        {
          path: "generation/assemble.ts",
          description: "RenderModel 确定性装配",
          imports: ["types/compiled-intent.ts", "types/render-model.ts"],
          importedBy: ["app/projects/generation-actions.ts"],
        },
        {
          path: "generation/openai-copy.ts",
          description: "OpenAI 文案结构化输出",
          imports: ["types/compiled-intent.ts"],
          importedBy: ["app/projects/generation-actions.ts"],
        },
        {
          path: "generation/form-presets.ts",
          description: "表单字段预设",
          imports: [],
          importedBy: ["app/projects/generation-actions.ts"],
        },
        {
          path: "poster/poster-llm-prompt-suggestion.ts",
          description: "从 property_promo 拼可复制海报 LLM 提示词",
          imports: [],
          importedBy: ["app/projects/[id]/poster/page.tsx"],
        },
        {
          path: "generation/skeleton-fill.ts",
          description: "骨架模式 AI 填肉（规划中）",
          imports: [],
          importedBy: [],
          isNew: true,
        },
      ],
    },
    {
      name: "Supabase 与工具",
      description: "服务端客户端、表单校验",
      files: [
        {
          path: "supabase/server.ts",
          description: "服务端 Supabase（cookie session）",
          imports: [],
          importedBy: ["app/**/*.tsx", "actions/submit-lead.ts"],
        },
        {
          path: "forms/validate-payload.ts",
          description: "留资字段校验",
          imports: [],
          importedBy: ["actions/submit-lead.ts"],
        },
      ],
    },
  ],
};
