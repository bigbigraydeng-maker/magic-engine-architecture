import Link from "next/link";
import { updateBuilderIntegrationFromForm } from "@/app/app/projects/merchant-profile-actions";
import { FormPendingHint, FormSubmitPendingButton } from "@/components/ui/form-submit-pending";
import type { MerchantProfileV1 } from "@/types/merchant-profile";

export interface BuilderIntegrationCardProps {
  projectId: string;
  siteSlug: string;
  merchantProfile: MerchantProfileV1 | null;
}

export function BuilderIntegrationCard({ projectId, siteSlug, merchantProfile }: BuilderIntegrationCardProps) {
  const enabled = merchantProfile?.builder_section_enabled === true;
  const position = merchantProfile?.builder_section_position ?? "before";
  const override = merchantProfile?.builder_url_path_override ?? "";
  const defaultUrlPath = siteSlug ? `/site/${siteSlug}` : "";

  return (
    <div className="mt-8 rounded-xl border border-violet-200 bg-violet-50/60 p-5">
      <h3 className="font-display text-base font-semibold text-stone-900">Builder.io 可选区块</h3>
      <p className="mt-1 text-sm text-stone-600">
        在微站上方或下方插入 Builder 可视化内容（默认按 urlPath <span className="font-mono text-xs">{defaultUrlPath || "（需有 slug）"}</span>{" "}
        定向）。需环境变量 <code className="rounded bg-white px-1 text-xs">NEXT_PUBLIC_BUILDER_API_KEY</code>。
      </p>
      <form action={updateBuilderIntegrationFromForm} className="mt-4 space-y-4 text-sm">
        <input type="hidden" name="project_id" value={projectId} />
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="builder_section_enabled"
            defaultChecked={enabled}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-violet-700 focus:ring-violet-600"
          />
          <span>
            <span className="font-medium text-stone-800">启用 Builder 区块</span>
            <span className="block text-xs text-stone-500">开启后草稿预览与公开页会请求 Builder（本地无 Key 时显示开发占位）。</span>
          </span>
        </label>
        <div>
          <label htmlFor="builder_section_position" className="block font-medium text-stone-700">
            相对 HiBiz 微站的位置
          </label>
          <select
            id="builder_section_position"
            name="builder_section_position"
            defaultValue={position}
            className="mt-1 w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-violet-600"
          >
            <option value="before">上方（默认）</option>
            <option value="after">下方</option>
          </select>
        </div>
        <div>
          <label htmlFor="builder_url_path_override" className="block font-medium text-stone-700">
            urlPath 覆盖（可选）
          </label>
          <input
            id="builder_url_path_override"
            name="builder_url_path_override"
            type="text"
            defaultValue={override}
            placeholder={defaultUrlPath || "/site/your-slug"}
            className="mt-1 w-full max-w-lg rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-900 shadow-inner outline-none focus:ring-2 focus:ring-violet-600"
            maxLength={500}
          />
          <p className="mt-1 text-xs text-stone-500">留空则使用 <span className="font-mono">{defaultUrlPath}</span>，须与 Builder 中 Targeting 一致。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FormSubmitPendingButton
            pendingLabel="保存中…"
            className="rounded-lg bg-violet-900 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-950"
          >
            保存 Builder 设置
          </FormSubmitPendingButton>
          <Link
            href={`/app/projects/${projectId}?preview=1`}
            className="text-sm font-medium text-violet-800 underline hover:text-violet-950"
          >
            打开草稿预览 →
          </Link>
          {siteSlug ? (
            <Link href={`/site/${siteSlug}`} className="text-sm font-medium text-stone-600 underline hover:text-stone-900">
              公开页 /site/{siteSlug} →
            </Link>
          ) : null}
        </div>
        <FormPendingHint className="mt-2 text-xs font-medium text-amber-800">正在写入 Builder 配置。</FormPendingHint>
      </form>
    </div>
  );
}
