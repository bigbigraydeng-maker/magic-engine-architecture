import type { CompiledIntentV2 } from "@/types/compiled-intent-v2";

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

export function versionHeaderText(v: CompiledIntentV2 | null): { title: string; updated?: string } {
  if (!v) {
    return { title: "—" };
  }
  if (!v.user_confirmed) {
    return { title: "尚未确认", updated: `更新 ${formatTimeShort(v.updated_at)}` };
  }
  const revs = v.revisions ?? [];
  if (v.schema_version === 2 && revs.length > 0) {
    const cur = v.current_version ?? revs[revs.length - 1]?.version ?? revs.length;
    return {
      title: `版本 ${cur}/${revs.length}`,
      updated: `最后更新 ${formatTimeShort(v.updated_at)}`,
    };
  }
  return { title: "版本 1/1", updated: `最后更新 ${formatTimeShort(v.updated_at)}` };
}
