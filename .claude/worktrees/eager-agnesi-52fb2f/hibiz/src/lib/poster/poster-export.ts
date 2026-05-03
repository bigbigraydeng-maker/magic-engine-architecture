"use client";

import { toPng } from "html-to-image";

export type PosterAspectRatio = "1:1" | "4:5" | "9:16";

export const POSTER_PIXELS: Record<PosterAspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/**
 * Rasterise a DOM node (already laid out at design pixel size) to PNG.
 */
export async function exportPosterNodeToPng(node: HTMLElement): Promise<Blob> {
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 1,
    backgroundColor: "#ffffff",
  });
  const res = await fetch(dataUrl);
  return res.blob();
}
