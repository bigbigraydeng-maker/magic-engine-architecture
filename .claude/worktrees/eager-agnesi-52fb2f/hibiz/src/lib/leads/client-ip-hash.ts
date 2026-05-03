import { createHash } from "node:crypto";

/** Hash client IP for rate limiting (not reversible without salt). */
export function hashClientIpForLeads(ipRaw: string): string {
  const salt =
    process.env.HIBIZ_LEAD_SALT?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL || "hibiz-lead-dev-fallback";
  return createHash("sha256").update(`${salt}:${ipRaw}`, "utf8").digest("hex").slice(0, 40);
}

export function getClientIpFromHeaders(getHeader: (name: string) => string | null): string {
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = getHeader("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}
