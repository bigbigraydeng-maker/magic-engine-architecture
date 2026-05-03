"use client";

import { useRef, useState } from "react";
import { SocialPosterPreview } from "@/components/social/SocialPosterPreview";
import { SharePackExport } from "@/components/social/SharePackExport";
import type { PosterAspectRatio } from "@/lib/poster/poster-export";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { SocialCaptionsV1, SocialContentType } from "@/types/social-content";

const ASPECTS: { id: PosterAspectRatio; label: string }[] = [
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "9:16", label: "9:16" },
];

export interface SocialPostWorkspaceProps {
  projectId: string;
  postId: string;
  contentType: SocialContentType;
  captions: SocialCaptionsV1;
  profile: MerchantProfileV1;
  projectName: string;
  tagline?: string;
}

export function SocialPostWorkspace({
  projectId,
  postId,
  contentType,
  captions,
  profile,
  projectName,
  tagline,
}: SocialPostWorkspaceProps) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<PosterAspectRatio>("1:1");

  return (
    <div className="space-y-10">
      <section>
        <h3 className="font-display text-lg font-semibold text-stone-900">海报预览</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAspect(a.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                aspect === a.id ? "bg-emerald-800 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <SocialPosterPreview
            captureRef={captureRef}
            contentType={contentType}
            profile={profile}
            projectName={projectName}
            aspect={aspect}
            tagline={tagline}
          />
        </div>
      </section>

      <SharePackExport captions={captions} projectId={projectId} postId={postId} captureRef={captureRef} />
    </div>
  );
}
