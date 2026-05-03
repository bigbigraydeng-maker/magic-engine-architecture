import type { CompiledIntentV1 } from "@/types/compiled-intent";

export function isCompiledIntentV1(data: unknown): data is CompiledIntentV1 {
  if (!data || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.schema_version === 1 && typeof o.industry === "string" && typeof o.scene === "string";
}
