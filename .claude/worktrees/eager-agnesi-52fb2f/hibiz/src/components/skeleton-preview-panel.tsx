import { updateSkeletonHeroImage, updateSkeletonModuleToggle, updateSkeletonPalette } from "@/app/app/projects/skeleton-edit-actions";
import { skeletonModuleVisibilityKey } from "@/lib/generation/skeleton-module-key";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { SkeletonModule } from "@/types/skeleton";
import type { TemplateSkeleton } from "@/types/skeleton";

interface SkeletonPreviewPanelProps {
  projectId: string;
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
}

function moduleVisible(
  skeleton: TemplateSkeleton,
  profile: MerchantProfileV1,
  index: number,
  mod: SkeletonModule,
): boolean {
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
}

export function SkeletonPreviewPanel({ projectId, skeleton, profile }: SkeletonPreviewPanelProps) {
  return (
    <div className="border-b border-stone-200 bg-white px-3 py-4 shadow-md sm:px-4">
      <p className="text-xs font-medium text-stone-700">骨架微调</p>
      <div className="mt-3 flex flex-wrap gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-stone-500">配色</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {skeleton.theme.palettes.map((p) => (
              <form key={p.id} action={updateSkeletonPalette} className="inline">
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="palette_id" value={p.id} />
                <button
                  type="submit"
                  className={`h-9 w-9 rounded-full border-2 ${
                    profile.theme_overrides?.palette_id === p.id ? "border-emerald-600 ring-2 ring-emerald-200" : "border-stone-200"
                  }`}
                  style={{ background: `linear-gradient(135deg, ${p.primary}, ${p.accent})` }}
                  title={p.name}
                  aria-label={p.name}
                />
              </form>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-stone-500">模块（点击切换）</p>
          <ul className="mt-1 flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-xs">
            {skeleton.modules.map((m, i) => {
              const locked = m.type === "hero" || m.type === "footer";
              const on = moduleVisible(skeleton, profile, i, m);
              return (
                <li key={skeletonModuleVisibilityKey(skeleton.id, i)}>
                  <form action={updateSkeletonModuleToggle} className="inline-flex items-center gap-1">
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="skeleton_id" value={skeleton.id} />
                    <input type="hidden" name="module_index" value={String(i)} />
                    <input type="hidden" name="visible" value={on ? "false" : "true"} />
                    <button
                      type="submit"
                      disabled={locked}
                      className={`rounded border px-2 py-0.5 ${on ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-100"} disabled:opacity-40`}
                    >
                      {m.type}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-stone-500">Hero 图</p>
          <form action={updateSkeletonHeroImage} encType="multipart/form-data" className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="project_id" value={projectId} />
            <input name="hero_image" type="file" accept="image/*" className="max-w-[12rem] text-[10px]" />
            <button type="submit" className="rounded bg-stone-800 px-2 py-1 text-[10px] text-white">
              上传至头像
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
