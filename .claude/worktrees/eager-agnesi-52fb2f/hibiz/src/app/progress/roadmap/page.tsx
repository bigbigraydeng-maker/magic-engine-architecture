import type { Metadata } from "next";
import {
  ROADMAP_VERSIONS,
  type RoadmapVersion,
  type VersionStatus,
} from "@/data/dev-progress";

export const metadata: Metadata = {
  title: "版本路线图 — HiBiz",
  description: "HiBiz 版本发布与规划时间线（内部看板）",
};

function statusBadge(version: RoadmapVersion): { emoji: string; label: string } {
  switch (version.status) {
    case "released":
      return { emoji: "✅", label: "已发布" };
    case "current":
      return { emoji: "🔨", label: "当前" };
    case "next":
      return { emoji: "📋", label: "下一步" };
    default:
      return { emoji: "", label: "规划中" };
  }
}

function nodeClasses(status: VersionStatus): string {
  switch (status) {
    case "released":
      return "h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-emerald-600/20";
    case "current":
      return "relative h-4 w-4 rounded-full bg-amber-500 ring-4 ring-amber-400/30 animate-pulse";
    case "next":
      return "h-3 w-3 rounded-full border-2 border-stone-400 bg-white";
    default:
      return "h-2.5 w-2.5 rounded-full border-2 border-stone-300 bg-white";
  }
}

function cardAccent(status: VersionStatus): string {
  switch (status) {
    case "released":
      return "border-l-emerald-600";
    case "current":
      return "border-l-amber-500 bg-amber-50/20";
    case "next":
      return "border-l-stone-400 bg-stone-50/80";
    default:
      return "border-l-stone-300 bg-stone-50/40";
  }
}

function detailsOpen(status: VersionStatus): boolean {
  if (status === "released") return false;
  return true;
}

function RoadmapEntry({ version, isLast }: { version: RoadmapVersion; isLast: boolean }) {
  const { emoji, label } = statusBadge(version);
  const dateText = version.date ?? "—";
  const open = detailsOpen(version.status);

  return (
    <div className="relative flex gap-3 sm:gap-4">
      <div className="flex w-5 shrink-0 flex-col items-center pt-1.5 sm:w-6">
        <span className={nodeClasses(version.status)} aria-hidden />
        {!isLast ? (
          <span className="mt-2 w-px flex-1 min-h-[1.5rem] bg-stone-300" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-6 sm:pb-8">
        <details
          {...(open ? { open: true } : {})}
          className={`overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm ${version.status === "current" ? "ring-1 ring-amber-200/60" : ""}`}
        >
          <summary
            className={`cursor-pointer list-none border-l-4 bg-white p-4 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 sm:p-5 [&::-webkit-details-marker]:hidden ${cardAccent(version.status)}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-semibold text-emerald-900">{version.version}</span>
              <span className="text-stone-400">—</span>
              <span className="font-display text-base font-semibold text-stone-900 sm:text-lg">
                {version.title}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500 sm:text-sm">
              <time dateTime={version.date ?? undefined}>{dateText}</time>
              <span className="text-stone-300">·</span>
              <span>
                {emoji ? `${emoji} ` : null}
                {label}
              </span>
            </div>
            <p className="mt-2 text-xs text-stone-400 sm:hidden">点按展开要点</p>
          </summary>
          <div className="border-t border-stone-100 px-4 py-3 sm:px-5 sm:py-4">
            <ul className="space-y-2 border-l-2 border-emerald-200/80 pl-3 text-sm text-stone-700 sm:pl-4">
              {version.highlights.map((h, i) => (
                <li key={`${version.id}-${i}`} className="leading-relaxed">
                  <span className="text-emerald-700">•</span> {h}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <main className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
      <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-6">
        <h2 className="font-display text-xl font-semibold text-stone-900 sm:text-2xl">版本路线图</h2>
        <p className="mt-2 text-sm text-stone-600">
          垂直时间线；已发布版本默认折叠要点，当前版本默认展开并带脉冲节点。
        </p>
      </div>

      <div className="mt-8 sm:mt-10">
        {ROADMAP_VERSIONS.map((v, i) => (
          <RoadmapEntry key={v.id} version={v} isLast={i === ROADMAP_VERSIONS.length - 1} />
        ))}
      </div>

      <p className="pb-4 text-center text-xs text-stone-500">
        数据来自 <code className="rounded bg-stone-200/60 px-1">ROADMAP_VERSIONS</code>
      </p>
    </main>
  );
}
