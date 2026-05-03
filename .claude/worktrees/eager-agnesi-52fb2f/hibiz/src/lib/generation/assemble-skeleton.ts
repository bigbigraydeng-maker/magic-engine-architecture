import type { GeneratedCopyV1 } from "@/lib/generation/openai-copy";
import {
  fillSkeletonDeterministic,
  mergeGeneratedCopyIntoSkeletonModel,
} from "@/lib/generation/skeleton-fill";
import { skeletonModuleVisibilityKey } from "@/lib/generation/skeleton-module-key";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { RenderModelV1 } from "@/types/render-model";
import type { TemplateSkeleton } from "@/types/skeleton";
import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";
import { resolveActiveModulesForForm } from "@/types/compiled-intent-v2";

export function resolveActiveSkeletonModuleEntries(
  skeleton: TemplateSkeleton,
  profile: MerchantProfileV1,
  compiledIntent?: CompiledIntentV2,
): { mod: TemplateSkeleton["modules"][number]; index: number }[] {
  // 優先：使用編譯意圖中的 module_selection（新 Option B 系統）
  if (compiledIntent?.module_selection) {
    const activeModules = resolveActiveModulesForForm(
      compiledIntent.scene,
      compiledIntent.module_selection
    );
    const activeModuleSet = new Set(activeModules.map(m => String(m)));

    return skeleton.modules
      .map((mod, index) => ({ mod, index }))
      .filter(({ mod }) => {
        // 模組名稱從骨架 mod.type 映射到 ModuleTypeV2
        return activeModuleSet.has(mod.type as string);
      });
  }

  // 回退：使用舊邏輯（兼容場景預設 + module_visibility 覆蓋）
  return skeleton.modules
    .map((mod, index) => ({ mod, index }))
    .filter(({ mod, index }) => {
      if (mod.type === "hero" || mod.type === "footer") {
        return true;
      }
      const key = skeletonModuleVisibilityKey(skeleton.id, index);
      const v = profile.module_visibility?.[key];
      if (v === false) {
        return false;
      }
      if (v === true) {
        return true;
      }
      return mod.visible;
    });
}

/** Theme colours for posters / previews (palette_id or manual overrides). */
export function resolveSkeletonHex(
  skeleton: TemplateSkeleton,
  profile: MerchantProfileV1,
): { primary: string; accent: string; background: string; fontFamily?: string } {
  const ov = profile.theme_overrides;
  if (ov?.primary?.trim() && ov?.accent?.trim() && ov?.background?.trim()) {
    return {
      primary: ov.primary.trim(),
      accent: ov.accent.trim(),
      background: ov.background.trim(),
      fontFamily: skeleton.theme.fontFamily,
    };
  }
  if (ov?.palette_id) {
    const p = skeleton.theme.palettes.find((x) => x.id === ov.palette_id);
    if (p) {
      return {
        primary: p.primary,
        accent: p.accent,
        background: p.background,
        fontFamily: skeleton.theme.fontFamily,
      };
    }
  }
  return {
    primary: skeleton.theme.primary,
    accent: skeleton.theme.accent,
    background: skeleton.theme.background,
    fontFamily: skeleton.theme.fontFamily,
  };
}

/**
 * 骨架装配：确定性填充 + 可选 AI 文案覆盖 + 主题/可见性已由 profile 表达并在填充前解析。
 * 不修改 {@link assembleRenderModel}（自然语言管线）。
 */
export function assembleRenderModelFromSkeleton(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  copy?: GeneratedCopyV1;
  compiledIntent?: CompiledIntentV2;
  formId: string;
  publicSlug: string;
  projectName: string;
}): RenderModelV1 {
  const { skeleton, profile, copy, compiledIntent, formId, publicSlug, projectName } = input;
  const activeModuleEntries = resolveActiveSkeletonModuleEntries(
    skeleton,
    profile,
    compiledIntent
  );
  const base = fillSkeletonDeterministic({
    skeleton,
    profile,
    formId,
    publicSlug,
    projectName,
    activeModuleEntries,
  });

  const hex = resolveSkeletonHex(skeleton, profile);
  const withTheme: RenderModelV1 = {
    ...base,
    theme: {
      ...base.theme,
      skeleton_hex: hex,
    },
  };

  if (copy) {
    return mergeGeneratedCopyIntoSkeletonModel(withTheme, copy);
  }
  return withTheme;
}
