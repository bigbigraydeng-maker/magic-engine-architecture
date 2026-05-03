import type { RenderModuleType } from "@/types/render-model";
import type { FormTemplateId } from "@/lib/generation/form-presets";

export interface ColorPalette {
  id: string;
  name: string;
  primary: string;
  accent: string;
  background: string;
}

export interface SkeletonTheme {
  primary: string;
  accent: string;
  background: string;
  fontFamily: string;
  palettes: ColorPalette[];
}

export interface SkeletonModule {
  type: RenderModuleType;
  variant: string;
  visible: boolean;
  defaultContent?: Record<string, unknown>;
}

export type SkeletonIndustry = "real_estate" | "immigration_education";

export interface TemplateSkeleton {
  id: string;
  name: string;
  nameEn: string;
  industry: SkeletonIndustry;
  description: string;
  thumbnail: string;
  modules: SkeletonModule[];
  theme: SkeletonTheme;
  defaultFormTemplate: FormTemplateId;
}
