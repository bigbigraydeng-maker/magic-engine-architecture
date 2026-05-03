"use client";

import type { CompiledIntentV2, IntentRevisionV2 } from "@/types/compiled-intent-v2";

function formatTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export interface ProjectIntentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  revisions: IntentRevisionV2[];
  displayIntent: CompiledIntentV2 | null;
  onRollback: (rev: IntentRevisionV2) => void;
  pending: boolean;
}

export function ProjectIntentHistoryModal({
  open,
  onClose,
  revisions,
  displayIntent,
  onRollback,
  pending,
}: ProjectIntentHistoryModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hibiz-history-title"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <h3 id="hibiz-history-title" className="font-display text-lg font-semibold text-stone-900">
            确认历史
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            关闭
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">回滚会新增一条版本记录，不会删除旧历史。</p>
        <ul className="mt-4 space-y-4">
          {revisions.map((rev) => {
            const isCurrent = rev.version === (displayIntent?.current_version ?? rev.version);
            return (
              <li key={rev.version} className="rounded-xl border border-stone-100 bg-stone-50/80 p-4 text-sm">
                <p className="font-medium text-stone-900">
                  v{rev.version}
                  {isCurrent ? (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      当前
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-stone-600">
                  {rev.intent.industry}, {rev.intent.scene}
                </p>
                <p className="mt-1 text-xs text-stone-500">确认时间：{formatTimeShort(rev.confirmed_at)}</p>
                <button
                  type="button"
                  disabled={pending || isCurrent}
                  onClick={() => onRollback(rev)}
                  className="mt-3 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  回滚到此版本
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
