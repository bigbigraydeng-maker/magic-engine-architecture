"use client";

import { useState } from "react";
import { uploadSocialPosterFromForm } from "@/app/app/projects/social-actions";
import { exportPosterNodeToPng } from "@/lib/poster/poster-export";
import type { SocialCaptionsV1 } from "@/types/social-content";

type PlatformKey = keyof SocialCaptionsV1["platforms"];

const PLATFORM_TABS: { id: PlatformKey; label: string }[] = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "xiaohongshu", label: "小红书" },
];

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SharePackExportProps {
  captions: SocialCaptionsV1;
  projectId: string;
  postId: string;
  captureRef: React.RefObject<HTMLDivElement | null>;
}

export function SharePackExport({ captions, projectId, postId, captureRef }: SharePackExportProps) {
  const [platform, setPlatform] = useState<PlatformKey>("facebook");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const text = captions.platforms[platform];

  async function copyText(s: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(s);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  async function handleDownloadPoster(): Promise<void> {
    const el = captureRef.current;
    if (!el) {
      return;
    }
    setBusy(true);
    try {
      const blob = await exportPosterNodeToPng(el);
      downloadBlob(blob, `hibiz-social-poster-${postId.slice(0, 8)}.png`);
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadPoster(): Promise<void> {
    const el = captureRef.current;
    if (!el) {
      return;
    }
    setBusy(true);
    try {
      const blob = await exportPosterNodeToPng(el);
      const file = new File([blob], "poster.png", { type: "image/png" });
      const fd = new FormData();
      fd.set("project_id", projectId);
      fd.set("post_id", postId);
      fd.set("poster", file);
      fd.set("next_path", `/app/projects/${projectId}/social?post=${postId}`);
      await uploadSocialPosterFromForm(fd);
    } finally {
      setBusy(false);
    }
  }

  async function handleNativeShare(): Promise<void> {
    const el = captureRef.current;
    if (!el) {
      return;
    }
    setBusy(true);
    try {
      const blob = await exportPosterNodeToPng(el);
      const file = new File([blob], "poster.png", { type: "image/png" });
      const shareData: ShareData = {
        title: "HiBiz poster",
        text: `${text.zh}\n\n${text.en}`.slice(0, 2800),
        files: [file],
      };
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        downloadBlob(blob, `hibiz-social-poster-${postId.slice(0, 8)}.png`);
        await copyText(`${text.zh}\n\n---\n\n${text.en}`, "fallback");
      }
    } catch {
      /* user cancel or unsupported */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold text-stone-900">分享包</h3>
      <p className="mt-1 text-xs text-stone-500">按平台查看文案、复制或下载海报；移动端可尝试系统分享。</p>

      {captions.image_plan ? (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50/90 p-4">
          <p className="text-sm font-semibold text-stone-900">配图与顺序建议（基于你上传的素材）</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-stone-600">中文</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm text-stone-800">{captions.image_plan.zh}</pre>
            </div>
            <div>
              <p className="text-xs font-medium text-stone-600">English</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm text-stone-800">{captions.image_plan.en}</pre>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {PLATFORM_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPlatform(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              platform === t.id ? "bg-emerald-800 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-stone-800">中文</p>
            <button
              type="button"
              onClick={() => void copyText(text.zh, "zh")}
              className="text-xs font-semibold text-emerald-800 hover:underline"
            >
              {copied === "zh" ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-800">
            {text.zh}
          </pre>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-stone-800">English</p>
            <button
              type="button"
              onClick={() => void copyText(text.en, "en")}
              className="text-xs font-semibold text-emerald-800 hover:underline"
            >
              {copied === "en" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-800">
            {text.en}
          </pre>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDownloadPoster()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
        >
          下载海报 PNG
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleUploadPoster()}
          className="rounded-lg border border-emerald-800 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
        >
          上传海报到项目
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleNativeShare()}
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
        >
          系统分享…
        </button>
      </div>
    </div>
  );
}
