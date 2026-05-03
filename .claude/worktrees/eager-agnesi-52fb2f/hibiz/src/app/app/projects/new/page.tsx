import Link from "next/link";
import { Suspense } from "react";
import { INDUSTRIES } from "@/types/hibiz";
import { TEMPLATE_PRESETS_ALL } from "@/data/template-presets";
import { getSkeletonsByIndustry } from "@/data/skeletons";
import { FormPendingHint, FormSubmitPendingButton } from "@/components/ui/form-submit-pending";
import { createProjectWithIntent } from "../actions";
import { SkeletonCreateWizard } from "@/components/skeleton-create-wizard";

interface NewProjectPageProps {
  searchParams: { error?: string; preset?: string; mode?: string };
}

function AdvancedNewProjectForm({ searchParams }: NewProjectPageProps) {
  const preset = searchParams.preset ? TEMPLATE_PRESETS_ALL.find((p) => p.id === searchParams.preset) : undefined;

  return (
    <div>
      <Link href="/app/projects/new" className="text-sm text-emerald-800 hover:underline">
        ← 返回骨架创建
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">自然语言创建</h1>
      <p className="mt-2 text-sm text-stone-600">
        用英文描述页面需求；可选 <code className="rounded bg-stone-100 px-1 text-xs">?preset=…</code> 提示。
      </p>

      {preset ? (
        <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-950">
          模板提示: <strong>{preset.title}</strong> — {preset.summary}
        </p>
      ) : null}

      {searchParams.error === "empty_prompt" ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">请输入简短需求描述。</p>
      ) : null}

      <form action={createProjectWithIntent} className="mt-8 max-w-xl space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-700">
            项目名称
          </label>
          <input
            id="name"
            name="name"
            type="text"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none ring-emerald-800 focus:ring-2"
            placeholder="e.g. Auckland open home – 12 Smith St"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-stone-700">行业（可选）</span>
          <div className="mt-2 flex flex-wrap gap-3">
            {INDUSTRIES.map((ind) => (
              <label
                key={ind.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50"
              >
                <input
                  type="radio"
                  name="industry_hint"
                  value={ind.id}
                  className="text-emerald-800"
                  defaultChecked={preset?.industry === ind.id}
                />
                {ind.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="prompt" className="block text-sm font-medium text-stone-700">
            你需要什么？
          </label>
          <textarea
            id="prompt"
            name="prompt"
            required
            rows={4}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none ring-emerald-800 focus:ring-2"
            placeholder="Example: Open home registration page..."
            defaultValue={preset?.promptHint ?? ""}
          />
        </div>

        <FormSubmitPendingButton
          pendingLabel="创建中…"
          className="w-full rounded-lg bg-emerald-800 py-3 text-sm font-semibold text-white hover:bg-emerald-900 sm:w-auto sm:px-8"
        >
          保存并继续
        </FormSubmitPendingButton>
        <FormPendingHint className="text-xs font-medium text-amber-800">正在创建项目与意图草稿，请勿重复点击。</FormPendingHint>
      </form>
    </div>
  );
}

export default function NewProjectPage(props: NewProjectPageProps) {
  const reSkeletons = getSkeletonsByIndustry("real_estate");

  if (props.searchParams.mode === "advanced") {
    return <AdvancedNewProjectForm {...props} />;
  }

  return (
    <div>
      <Link href="/app/projects" className="text-sm text-emerald-800 hover:underline">
        ← 项目列表
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">新建微站</h1>
      <p className="mt-2 max-w-xl text-sm text-stone-600">骨架模板分步创建，或使用自然语言高级模式。</p>

      <Suspense fallback={<p className="mt-8 text-sm text-stone-500">加载向导…</p>}>
        <SkeletonCreateWizard realEstateSkeletons={reSkeletons} />
      </Suspense>
    </div>
  );
}
