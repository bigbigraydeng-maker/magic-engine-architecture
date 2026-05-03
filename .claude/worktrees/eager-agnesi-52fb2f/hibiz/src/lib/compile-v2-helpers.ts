/**
 * Compile v0.4 卡片：場景解析、模組過濾與 module_selection 構建（單一數據源 MODULE_DEFAULTS_BY_SCENE）。
 */

import {
  getAllSelectableModulesForScene,
  getDefaultModulesForScene,
  MODULE_DEFAULTS_BY_SCENE,
  resolveActiveModulesForForm,
  type CompiledIntentV2,
  type IndustryV2,
  type ModuleSelectionV2,
  type ModuleTypeV2,
  type SceneV2,
  type SelectableModuleType,
} from "@/types/compiled-intent-v2";

export function defaultSceneForIndustry(industry: IndustryV2): SceneV2 {
  return industry === "real_estate" ? "property_listing" : "visa_consultation";
}

/** 預覽與保存共用：依 industry 是否切換決定 scene */
export function previewScene(ind: IndustryV2 | null, disp: CompiledIntentV2 | null): SceneV2 {
  if (!disp) {
    return "property_listing";
  }
  if (!ind) {
    return disp.scene;
  }
  if (ind === disp.industry) {
    return disp.scene;
  }
  return defaultSceneForIndustry(ind);
}

export function modulesSignature(mods: ModuleTypeV2[]): string {
  return [...mods].sort().join("\0");
}

export function baselineModulesForIntent(intent: CompiledIntentV2): ModuleTypeV2[] {
  return intent.module_selection
    ? resolveActiveModulesForForm(intent.scene, intent.module_selection)
    : getDefaultModulesForScene(intent.scene);
}

export function moduleSelectionFromModules(scene: SceneV2, modules: ModuleTypeV2[]): ModuleSelectionV2 {
  const sel: ModuleSelectionV2 = {};
  for (const mod of getAllSelectableModulesForScene(scene)) {
    sel[mod] = { enabled: modules.includes(mod) };
  }
  return sel;
}

/** 僅保留當前 scene 下合法的模組鍵 */
export function filterModulesForScene(scene: SceneV2, modules: ModuleTypeV2[]): ModuleTypeV2[] {
  const d = MODULE_DEFAULTS_BY_SCENE[scene];
  const allowed = new Set<ModuleTypeV2>([
    ...d.always_enabled,
    ...d.recommended_enabled,
    ...d.optional_modules,
  ]);
  return modules.filter((m) => allowed.has(m));
}

/** 從場景配置匯集某行業下所有可選模組（推薦 + 可選） */
export function getSelectableModulesForIndustry(industry: IndustryV2): SelectableModuleType[] {
  const allModules = new Set<SelectableModuleType>();
  const sceneKeys = Object.keys(MODULE_DEFAULTS_BY_SCENE) as SceneV2[];

  for (const sceneKey of sceneKeys) {
    const isRealEstateScene = ["property_listing", "open_home_event", "market_update"].includes(sceneKey);
    const isImmigrationScene = ["visa_consultation", "school_info", "program_enrollment"].includes(sceneKey);

    if (
      (industry === "real_estate" && isRealEstateScene) ||
      (industry === "immigration" && isImmigrationScene)
    ) {
      const defaults = MODULE_DEFAULTS_BY_SCENE[sceneKey];
      defaults.recommended_enabled.forEach((m) => allModules.add(m));
      defaults.optional_modules.forEach((m) => allModules.add(m));
    }
  }

  return Array.from(allModules).sort() as SelectableModuleType[];
}

/** 是否存在至少一個非 always-enabled 的已選模組（用於預覽區是否顯示） */
export function hasNonAlwaysModules(scene: SceneV2, mods: ModuleTypeV2[]): boolean {
  const always = new Set<string>(MODULE_DEFAULTS_BY_SCENE[scene].always_enabled);
  return mods.some((m) => !always.has(m));
}
