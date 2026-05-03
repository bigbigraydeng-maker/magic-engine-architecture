import type { Metadata } from "next";
import {
  ARCHITECTURE_LAYERS,
  countFilesInLayer,
  type ArchFile,
  type ArchLayer,
} from "@/data/architecture-map";

export const metadata: Metadata = {
  title: "文件架构 — HiBiz",
  description: "HiBiz 代码分层与简化依赖关系（内部看板）",
};

const LAYER_BORDER: Record<string, string> = {
  blue: "border-l-blue-500",
  violet: "border-l-violet-500",
  orange: "border-l-orange-500",
  teal: "border-l-teal-600",
  amber: "border-l-amber-500",
};

function fullPath(layer: ArchLayer, file: ArchFile): string {
  return `${layer.basePath}${file.path}`;
}

function ArchFileRow({ layer, file }: { layer: ArchLayer; file: ArchFile }) {
  const fp = fullPath(layer, file);
  const hasDeps = file.imports.length > 0 || file.importedBy.length > 0;

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <code className="break-all text-[11px] text-stone-800 sm:text-xs">{fp}</code>
        <p className="mt-1 text-xs text-stone-600 sm:text-sm">{file.description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {file.isNew ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            NEW
          </span>
        ) : null}
        {hasDeps ? (
          <span className="text-[10px] text-stone-400 sm:text-xs">查看依赖</span>
        ) : (
          <span className="text-[10px] text-stone-400 sm:text-xs">无登记依赖</span>
        )}
      </div>
    </div>
  );

  if (!hasDeps) {
    return (
      <li className="rounded-xl border border-stone-100 bg-stone-50/40 px-3 py-2.5 sm:px-4 sm:py-3">
        {header}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-stone-100 bg-stone-50/40">
      <details>
        <summary className="cursor-pointer list-none px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden sm:px-4 sm:py-3">
          {header}
        </summary>
        <div className="space-y-3 border-t border-stone-200/80 px-3 py-3 text-xs sm:px-4 sm:text-sm">
          {file.imports.length > 0 ? (
            <div>
              <p className="font-medium text-stone-700">导入 →</p>
              <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-stone-600 sm:text-xs">
                {file.imports.map((imp) => (
                  <li key={imp} className="break-all border-l-2 border-emerald-200 pl-2">
                    {imp}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {file.importedBy.length > 0 ? (
            <div>
              <p className="font-medium text-stone-700">被引用 ←</p>
              <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-stone-600 sm:text-xs">
                {file.importedBy.map((by) => (
                  <li key={by} className="break-all border-l-2 border-amber-200 pl-2">
                    {by}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function ArchLayerCard({ layer }: { layer: ArchLayer }) {
  const n = countFilesInLayer(layer);
  const lb = LAYER_BORDER[layer.color] ?? "border-l-stone-400";

  return (
    <details open className="group rounded-2xl border border-stone-200 bg-white shadow-sm ring-1 ring-inset ring-stone-100">
      <summary
        className={`flex cursor-pointer list-none items-center gap-3 border-l-4 bg-white px-4 py-4 marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:px-5 sm:py-5 [&::-webkit-details-marker]:hidden ${lb}`}
      >
        <span className="text-2xl" aria-hidden>
          {layer.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-display text-lg font-semibold text-stone-900">{layer.nameEn}</h3>
            <span className="text-sm text-stone-500">({layer.name})</span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-stone-500 sm:text-xs">{layer.basePath}</p>
          <p className="mt-1 text-xs text-stone-600">{n} 个文件节点</p>
        </div>
        <span className="shrink-0 text-xs text-stone-400 group-open:hidden sm:text-sm">展开</span>
        <span className="hidden shrink-0 text-xs text-stone-400 group-open:inline sm:text-sm">折叠</span>
      </summary>

      <div className="space-y-6 border-t border-stone-100 px-3 py-4 sm:px-5 sm:py-6">
        {layer.groups.map((group) => (
          <section key={group.name}>
            <h4 className="font-medium text-stone-900">{group.name}</h4>
            <p className="mt-1 text-xs text-stone-500 sm:text-sm">{group.description}</p>
            <ul className={`mt-3 space-y-2 border-l-2 pl-3 sm:pl-4 ${lb}`}>
              {group.files.map((file) => (
                <ArchFileRow key={file.path} layer={layer} file={file} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

export default function ArchitecturePage() {
  return (
    <main className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
      <section className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-6">
        <h2 className="font-display text-xl font-semibold text-stone-900 sm:text-2xl">文件架构</h2>
        <p className="mt-2 text-sm text-stone-600">
          分层：Pages → Components → Lib → Types → Data。每层可折叠；单个文件可展开查看登记的导入与被引用（示意数据，见{" "}
          <code className="rounded bg-stone-200/60 px-1 text-xs">architecture-map.ts</code>）。
        </p>
      </section>

      <div className="mt-8 space-y-6 sm:mt-10">
        {ARCHITECTURE_LAYERS.map((layer) => (
          <ArchLayerCard key={layer.id} layer={layer} />
        ))}
      </div>

      <p className="mt-8 pb-4 text-center text-[11px] text-stone-500 sm:text-xs">
        路径与依赖为人工维护，与真实 import 不完全等价；以仓库为准。
      </p>
    </main>
  );
}
