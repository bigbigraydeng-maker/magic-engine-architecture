import type { Metadata } from "next";
import Link from "next/link";
import {
  DEV_PROGRESS_LAST_UPDATED,
  DEV_PROGRESS_PHASES,
  overallCompletion,
  phaseCompletion,
  type ItemStatus,
} from "@/data/dev-progress";

export const metadata: Metadata = {
  title: "开发进度 — HiBiz",
  description: "HiBiz MVP 阶段进度与待办（内部看板）",
};

type FilterKey = "all" | ItemStatus;

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "done", label: "已完成" },
  { key: "in_progress", label: "进行中" },
  { key: "todo", label: "待办" },
  { key: "blocked", label: "阻塞" },
];

function parseFilter(raw: string | string[] | undefined): FilterKey {
  if (typeof raw !== "string") return "all";
  const allowed: FilterKey[] = ["all", "done", "in_progress", "todo", "blocked"];
  return allowed.includes(raw as FilterKey) ? (raw as FilterKey) : "all";
}

function statusLabel(s: ItemStatus): string {
  switch (s) {
    case "done":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "blocked":
      return "阻塞";
    default:
      return "待办";
  }
}

function statusStyles(s: ItemStatus): string {
  switch (s) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "in_progress":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "blocked":
      return "border-red-200 bg-red-50 text-red-900";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

interface ProgressPageProps {
  searchParams: { filter?: string | string[] };
}

export default function ProgressPage({ searchParams }: ProgressPageProps) {
  const filter = parseFilter(searchParams.filter);
  const overall = overallCompletion(DEV_PROGRESS_PHASES);

  const phasesVisible = DEV_PROGRESS_PHASES.map((phase) => ({
    ...phase,
    items: phase.items.filter((item) => filter === "all" || item.status === filter),
  })).filter((p) => p.items.length > 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <section
        className="rounded-2xl border border-stone-200/80 px-4 py-6 text-white shadow-sm sm:px-6 sm:py-8"
        style={{
          backgroundImage: "linear-gradient(135deg, #1c1917 0%, #14532d 48%, #0f172a 100%)",
        }}
      >
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">开发进度</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-300 sm:text-base">
          可视看板与 Obsidian 规格同步；条目与权重以{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-emerald-200 sm:text-sm">
            src/data/dev-progress.ts
          </code>{" "}
          为准。
        </p>
        <p className="mt-4 text-xs text-stone-400 sm:text-sm">最后更新 · {DEV_PROGRESS_LAST_UPDATED}</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm sm:mt-8 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-stone-300 sm:text-sm">整体完成度（加权）</p>
              <p className="mt-1 font-display text-4xl font-semibold tabular-nums text-white sm:text-5xl">
                {overall.pct}%
              </p>
            </div>
            <p className="text-xs text-stone-400 sm:text-sm">
              已完成条目 <span className="font-medium text-stone-200">{overall.done}</span> / {overall.total}
            </p>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/30 sm:mt-5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-200 transition-[width] duration-700 ease-out"
              style={{ width: `${overall.pct}%` }}
            />
          </div>
          <dl className="mt-3 flex flex-wrap gap-3 text-[10px] text-stone-400 sm:mt-4 sm:gap-4 sm:text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              已完成
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              进行中（按 55% 计）
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-stone-400" />
              待办 / 阻塞
            </div>
          </dl>
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-stone-700">按状态筛选任务</p>
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const href =
              opt.key === "all" ? "/progress" : `/progress?filter=${encodeURIComponent(opt.key)}`;
            const active = filter === opt.key;
            return (
              <Link
                key={opt.key}
                href={href}
                scroll={false}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  active
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </div>

      {phasesVisible.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-8 text-center text-sm text-stone-500">
          当前筛选下没有任务条目，请切换筛选条件。
        </p>
      ) : (
        <ol className="mt-8 space-y-10 sm:mt-10">
          {phasesVisible.map((phase, idx) => {
            const origIndex = DEV_PROGRESS_PHASES.findIndex((p) => p.id === phase.id);
            const displayNum = (origIndex >= 0 ? origIndex : idx) + 1;
            const origPhase = origIndex >= 0 ? DEV_PROGRESS_PHASES[origIndex] : phase;
            const { pct, done, total } = phaseCompletion(origPhase.items);
            return (
              <li key={phase.id}>
                <div className="flex gap-3 sm:gap-4">
                  <div className="flex w-9 shrink-0 flex-col items-center pt-1 sm:w-10">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-stone-900 bg-white font-display text-base font-semibold text-stone-900 shadow-sm sm:h-10 sm:w-10 sm:text-lg">
                      {displayNum}
                    </span>
                    {idx < phasesVisible.length - 1 ? (
                      <span className="mt-2 min-h-[2rem] w-px flex-1 bg-gradient-to-b from-stone-400 to-transparent" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-semibold text-stone-900 sm:text-xl">
                          {phase.title}
                        </h3>
                        <p className="mt-1 text-xs text-stone-500 sm:text-sm">{phase.summary}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-xl font-semibold tabular-nums text-emerald-900 sm:text-2xl">
                          {pct}%
                        </p>
                        <p className="text-[10px] text-stone-500 sm:text-xs">
                          {done}/{total} 项已完成
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100 sm:mt-4">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <ul className="mt-4 space-y-3 sm:mt-6">
                      {phase.items.map((item) => (
                        <li
                          key={item.id}
                          className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-sm sm:px-4 sm:py-3 ${statusStyles(
                            item.status,
                          )}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 font-medium leading-snug">{item.label}</span>
                            <span className="shrink-0 rounded-full border border-current/20 bg-white/40 px-2 py-0.5 text-xs font-medium">
                              {statusLabel(item.status)}
                            </span>
                          </div>
                          {item.note ? <p className="text-xs opacity-90">{item.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-12 border-t border-stone-200 pt-6 text-center text-[11px] text-stone-500 sm:mt-14 sm:pt-8 sm:text-xs">
        <p>
          与本页同步的 Obsidian 文档：Second-Brain → 01-Magiclab → Projects → HiBiz → 「10-开发进度」
        </p>
      </footer>
    </main>
  );
}
