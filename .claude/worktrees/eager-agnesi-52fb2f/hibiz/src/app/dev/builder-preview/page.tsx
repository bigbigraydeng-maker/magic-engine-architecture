import Link from "next/link";
import { notFound } from "next/navigation";
import { BuilderDevPlaceholder } from "@/components/builder/BuilderDevPlaceholder";

export const metadata = {
  title: "Builder 区块预览 — HiBiz (dev)",
};

/** 本地开发免登录查看 Builder 占位与布局示意；生产环境 404。 */
export default function DevBuilderPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="border-b border-stone-200 bg-white px-4 py-4">
        <Link href="/progress" className="text-sm text-emerald-800 hover:underline">
          ← Progress
        </Link>
        <h1 className="mt-2 font-display text-xl font-semibold text-stone-900">Builder 区块预览（仅开发）</h1>
        <p className="mt-1 text-sm text-stone-500">
          琥珀色区域与项目里开启 Builder 后、未配置 API Key 时的草稿预览一致。
        </p>
      </div>
      <BuilderDevPlaceholder urlPath="/site/demo-slug" variant="no_api_key" />
      <div className="mx-auto max-w-3xl px-4 py-12 text-center text-stone-600">
        <p className="text-sm">↓ 以下为 HiBiz 微站内容区（示意）</p>
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-900 p-8 text-white">
          <p className="font-display text-lg">Hero / RenderMicrosite</p>
          <p className="mt-2 text-sm text-stone-300">
            在任意项目 → Result package → 勾选「启用 Builder 区块」→{" "}
            <span className="font-mono text-emerald-300">?preview=1</span> 查看完整串联。
          </p>
        </div>
      </div>
    </div>
  );
}
