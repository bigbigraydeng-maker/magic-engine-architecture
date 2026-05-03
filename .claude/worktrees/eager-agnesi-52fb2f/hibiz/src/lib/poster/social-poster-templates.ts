import { resolveSkeletonHex } from "@/lib/generation/assemble-skeleton";
import { getSkeletonById } from "@/data/skeletons";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { SocialContentType } from "@/types/social-content";

const HEADLINE: Record<SocialContentType, { line1: string; line1Zh: string }> = {
  just_listed: { line1: "JUST LISTED", line1Zh: "新上市" },
  just_sold: { line1: "JUST SOLD", line1Zh: "已成交" },
  open_home: { line1: "OPEN HOME", line1Zh: "开放看房" },
  market_update: { line1: "MARKET UPDATE", line1Zh: "市场快报" },
  buying_tips: { line1: "BUYING TIPS", line1Zh: "买房贴士" },
  nl_upload: { line1: "YOUR STORY", line1Zh: "品牌动态" },
};

export function getSocialPosterColors(profile: MerchantProfileV1): {
  primary: string;
  accent: string;
  background: string;
} {
  const sid = profile.skeleton_id?.trim() || "classic-agent";
  const sk = getSkeletonById(sid) ?? getSkeletonById("classic-agent");
  if (!sk) {
    return { primary: "#1e3a5f", accent: "#c9952c", background: "#ffffff" };
  }
  const hex = resolveSkeletonHex(sk, profile);
  return { primary: hex.primary, accent: hex.accent, background: hex.background };
}

export function getSocialPosterHeadline(contentType: SocialContentType): { line1: string; line1Zh: string } {
  return HEADLINE[contentType];
}

export function getSocialPosterSubtitle(profile: MerchantProfileV1, projectName: string): string {
  return profile.display_name?.trim() || profile.company_name?.trim() || projectName;
}
