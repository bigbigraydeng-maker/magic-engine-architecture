import type { CompiledIntentV1, CompiledScene } from "@/types/compiled-intent";
import type { TemplateSkeleton } from "@/types/skeleton";
import type { FormTemplateId } from "@/lib/generation/form-presets";

function sceneForFormTemplate(id: FormTemplateId): CompiledScene {
  switch (id) {
    case "open_home_registration":
      return "open_home_registration";
    case "buyer_inquiry":
      return "buyer_registration";
    case "property_valuation":
      return "free_appraisal";
    default: {
      const _e: never = id;
      return _e;
    }
  }
}

/** 供骨架创建流程生成文案：与骨架默认表单场景对齐 */
export function compiledIntentFromSkeleton(skeleton: TemplateSkeleton, formTemplateId: FormTemplateId): CompiledIntentV1 {
  const industry = skeleton.industry === "real_estate" ? "real_estate" : "immigration_education";
  const scene = sceneForFormTemplate(formTemplateId);
  const goal =
    scene === "open_home_registration" || scene === "seminar_registration"
      ? "event_signup"
      : scene === "free_appraisal" || scene === "free_assessment"
        ? "assessment"
        : "lead_gen";

  return {
    schema_version: 1,
    industry,
    scene,
    city: null,
    language_mode: "en_bilingual_zh",
    goal,
    needs_form: true,
    tone: "professional",
    target_customer: [],
    nz: { default_country: "NZ", region_hint: null },
  };
}
