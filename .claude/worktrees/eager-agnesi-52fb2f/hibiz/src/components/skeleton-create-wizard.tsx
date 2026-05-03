"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createProjectFromSkeleton } from "@/app/app/projects/skeleton-create-actions";
import { ModuleToggleList } from "@/components/module-toggle-list";
import { PropertyListingEditor } from "@/components/property-listing-editor";
import { SkeletonPicker } from "@/components/skeleton-picker";
import { ThemePalettePicker } from "@/components/theme-palette-picker";
import type { TemplateSkeleton } from "@/types/skeleton";

type WizardStep = "choose" | "skeleton" | "info" | "preview";

function parseStep(raw: string | null): WizardStep {
  if (raw === "skeleton" || raw === "info" || raw === "preview") {
    return raw;
  }
  return "choose";
}

interface SkeletonCreateWizardProps {
  realEstateSkeletons: readonly TemplateSkeleton[];
}

export function SkeletonCreateWizard({ realEstateSkeletons }: SkeletonCreateWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStep = parseStep(searchParams.get("step"));
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [selectedSkeletonId, setSelectedSkeletonId] = useState<string | null>(searchParams.get("skeleton") ?? null);

  const setUrlStep = useCallback(
    (s: WizardStep, skeletonId?: string | null) => {
      const p = new URLSearchParams();
      if (s !== "choose") {
        p.set("step", s);
      }
      if (skeletonId) {
        p.set("skeleton", skeletonId);
      }
      const q = p.toString();
      router.replace(q ? `/app/projects/new?${q}` : "/app/projects/new", { scroll: false });
    },
    [router],
  );

  const go = useCallback(
    (s: WizardStep, sk?: string | null) => {
      setStep(s);
      setUrlStep(s, sk ?? selectedSkeletonId);
    },
    [setUrlStep, selectedSkeletonId],
  );

  const selectedSkeleton = useMemo(
    () => realEstateSkeletons.find((x) => x.id === selectedSkeletonId) ?? null,
    [realEstateSkeletons, selectedSkeletonId],
  );

  const showInfoBlock = selectedSkeleton && (step === "info" || step === "preview");

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap gap-2 text-xs text-stone-500">
        <StepTab label="1 方式" active={step === "choose"} />
        <span aria-hidden>→</span>
        <StepTab label="2 骨架" active={step === "skeleton"} />
        <span aria-hidden>→</span>
        <StepTab label="3 资料" active={step === "info"} />
        <span aria-hidden>→</span>
        <StepTab label="4 预览" active={step === "preview"} />
      </nav>

      <form action={createProjectFromSkeleton} noValidate className="space-y-8">
        <input type="hidden" name="skeleton_id" value={selectedSkeletonId ?? ""} />

        {step === "choose" ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-stone-900">选择创建方式</h2>
            <p className="mt-2 text-sm text-stone-600">骨架模板快速建站，或使用自然语言高级模式。</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => go("skeleton")}
                className="rounded-xl border-2 border-emerald-600 bg-emerald-50/50 px-4 py-4 text-left text-sm font-medium text-emerald-950"
              >
                骨架模板（推荐）
              </button>
              <Link
                href="/app/projects/new?mode=advanced"
                className="rounded-xl border border-stone-200 px-4 py-4 text-left text-sm font-medium text-stone-800 hover:bg-stone-50"
              >
                自然语言高级模式 →
              </Link>
            </div>
          </div>
        ) : null}

        {step === "skeleton" ? (
          <div className="space-y-4">
            <SkeletonPicker
              skeletons={realEstateSkeletons}
              selectedId={selectedSkeletonId}
              onSelect={(id) => setSelectedSkeletonId(id)}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => go("choose")}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-700"
              >
                上一步
              </button>
              <button
                type="button"
                disabled={!selectedSkeletonId}
                onClick={() => go("info", selectedSkeletonId)}
                className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                下一步：填写信息
              </button>
            </div>
          </div>
        ) : null}

        {showInfoBlock && selectedSkeleton ? (
          <div className={step === "info" ? "space-y-8" : "hidden"} aria-hidden={step !== "info"}>
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <h2 className="font-display text-lg font-semibold text-stone-900">基本信息</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-stone-700">项目名称 *</span>
                  <input
                    name="project_name"
                    required={step === "info"}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    placeholder="如：North Shore 开放日"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-stone-700">姓名 *</span>
                  <input name="display_name" required={step === "info"} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-stone-700">公司名称</span>
                  <input name="company_name" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-stone-700">手机号 *</span>
                  <input
                    name="phone"
                    type="tel"
                    required={step === "info"}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-stone-700">邮箱</span>
                  <input name="email" type="email" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-stone-700">WhatsApp</span>
                  <input name="whatsapp" type="tel" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-stone-700">一句话 Slogan（可选）</span>
                  <input name="slogan" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-stone-700">服务区域</span>
                  <input name="service_area" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" placeholder="如 Auckland Central" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-stone-700">TradeMe 链接（可选）</span>
                  <input name="trademe_url" type="url" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <h3 className="font-medium text-stone-900">品牌素材</h3>
              <p className="mt-1 text-xs text-stone-500">上传到 Supabase Storage（listing-images / merchant/…）</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-stone-700">头像</span>
                  <input name="avatar" type="file" accept="image/*" className="mt-1 w-full text-xs" />
                </label>
                <label className="block text-sm">
                  <span className="text-stone-700">Logo</span>
                  <input name="logo" type="file" accept="image/*" className="mt-1 w-full text-xs" />
                </label>
                <label className="block text-sm">
                  <span className="text-stone-700">微信二维码</span>
                  <input name="wechat_qr" type="file" accept="image/*" className="mt-1 w-full text-xs" />
                </label>
              </div>
            </div>

            <ThemePalettePicker skeleton={selectedSkeleton} />
            <ModuleToggleList skeleton={selectedSkeleton} />
            <PropertyListingEditor />

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => go("skeleton")} className="rounded-lg border border-stone-200 px-4 py-2 text-sm">
                上一步
              </button>
              <button
                type="button"
                onClick={() => go("preview", selectedSkeletonId)}
                className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white"
              >
                下一步：预览
              </button>
            </div>
          </div>
        ) : null}

        {step === "preview" && selectedSkeleton ? (
          <div className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-stone-900">确认创建</h2>
            <p className="text-sm text-stone-600">
              骨架：<strong>{selectedSkeleton.name}</strong>（{selectedSkeleton.nameEn}）
            </p>
            <p className="text-xs text-stone-500">提交后生成草稿并打开预览；表单与文件已保留在下方隐藏域（浏览器会一并提交）。</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => go("info")} className="rounded-lg border border-stone-200 px-4 py-2 text-sm">
                返回修改
              </button>
              <SkeletonWizardSubmitButton />
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function StepTab({ label, active }: { label: string; active: boolean }) {
  return <span className={active ? "font-semibold text-emerald-900" : ""}>{label}</span>;
}

function SkeletonWizardSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formNoValidate
      disabled={pending}
      aria-busy={pending}
      className="rounded-lg bg-emerald-800 px-6 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? "创建中…" : "创建项目"}
    </button>
  );
}
