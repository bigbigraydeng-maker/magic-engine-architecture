import { randomBytes } from "node:crypto";

const RESERVED = new Set(["app", "api", "login", "preview", "site", "auth", "admin", "www"]);

export function shortToken(): string {
  return randomBytes(4).toString("hex");
}

export function slugifySegment(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.length > 0 ? s : "page";
}

export function makeMicrositeSlug(projectName: string): string {
  const base = slugifySegment(projectName);
  let candidate = `${base}-${shortToken()}`;
  if (RESERVED.has(base)) {
    candidate = `${base}-x-${shortToken()}`;
  }
  return candidate;
}

export function makeFormPublicSlug(projectName: string): string {
  return `f-${slugifySegment(projectName)}-${shortToken()}`;
}
