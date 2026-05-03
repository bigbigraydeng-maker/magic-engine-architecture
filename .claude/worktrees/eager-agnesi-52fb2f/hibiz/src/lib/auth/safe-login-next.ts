const DEFAULT_NEXT = "/app/projects";
const MAX_LEN = 512;

/** Avoid open redirects: only same-origin app paths. */
export function safeLoginNextPath(raw: string | null): string {
  if (!raw || raw.length > MAX_LEN) {
    return DEFAULT_NEXT;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return DEFAULT_NEXT;
  }
  if (!trimmed.startsWith("/app")) {
    return DEFAULT_NEXT;
  }
  return trimmed;
}
