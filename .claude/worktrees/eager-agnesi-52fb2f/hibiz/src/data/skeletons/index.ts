import { SKELETON_AGENT_PRO } from "./agent-pro";
import { SKELETON_BILINGUAL_PRO } from "./bilingual-pro";
import { SKELETON_CLASSIC_AGENT } from "./classic-agent";
import { SKELETON_PROPERTY_SHOWCASE } from "./property-showcase";
import type { SkeletonIndustry, TemplateSkeleton } from "@/types/skeleton";

export const ALL_SKELETONS: readonly TemplateSkeleton[] = [
  SKELETON_CLASSIC_AGENT,
  SKELETON_PROPERTY_SHOWCASE,
  SKELETON_BILINGUAL_PRO,
  SKELETON_AGENT_PRO,
] as const;

export function getSkeletonById(id: string): TemplateSkeleton | undefined {
  return ALL_SKELETONS.find((s) => s.id === id);
}

export function getSkeletonsByIndustry(industry: SkeletonIndustry): readonly TemplateSkeleton[] {
  return ALL_SKELETONS.filter((s) => s.industry === industry);
}
