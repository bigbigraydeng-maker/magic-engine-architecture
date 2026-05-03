"use client";

import { useMemo, type LegacyRef } from "react";
import {
  getSocialPosterColors,
  getSocialPosterHeadline,
  getSocialPosterSubtitle,
} from "@/lib/poster/social-poster-templates";
import { POSTER_PIXELS, type PosterAspectRatio } from "@/lib/poster/poster-export";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { SocialContentType } from "@/types/social-content";

export interface SocialPosterPreviewProps {
  contentType: SocialContentType;
  profile: MerchantProfileV1;
  projectName: string;
  aspect: PosterAspectRatio;
  /** Optional one-liner (e.g. listing title or promo headline). */
  tagline?: string;
  /** Ref to the outer capture node (design pixel size). */
  captureRef: React.RefObject<HTMLDivElement | null>;
}

export function SocialPosterPreview({
  contentType,
  profile,
  projectName,
  aspect,
  tagline,
  captureRef,
}: SocialPosterPreviewProps) {
  const colors = useMemo(() => getSocialPosterColors(profile), [profile]);
  const headline = getSocialPosterHeadline(contentType);
  const subtitle = getSocialPosterSubtitle(profile, projectName);
  const { width, height } = POSTER_PIXELS[aspect];
  const scale = useMemo(() => {
    const maxPreview = 320;
    const s = Math.min(1, maxPreview / Math.max(width, height));
    return s;
  }, [width, height]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">导出尺寸 {width}×{height}px（{aspect}）</p>
      <div
        className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 p-4"
        style={{ maxWidth: "100%" }}
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: width * scale, height: height * scale }}>
          <div ref={captureRef as LegacyRef<HTMLDivElement>} style={{ width, height, backgroundColor: colors.background }}>
            <div className="flex h-full w-full flex-col justify-between p-10" style={{ fontFamily: "system-ui, sans-serif" }}>
              <div>
                <p className="text-sm font-semibold tracking-[0.2em]" style={{ color: colors.accent }}>
                  {headline.line1}
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight" style={{ color: colors.primary }}>
                  {headline.line1Zh}
                </p>
                <div className="mt-6 h-1 w-24 rounded-full" style={{ backgroundColor: colors.accent }} />
                {tagline ? (
                  <p className="mt-8 max-w-[90%] text-xl font-medium leading-snug" style={{ color: colors.primary }}>
                    {tagline}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-lg font-semibold" style={{ color: colors.primary }}>
                  {subtitle}
                </p>
                {profile.contact?.phone ? (
                  <p className="mt-1 text-base opacity-90" style={{ color: colors.primary }}>
                    {profile.contact.phone}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
