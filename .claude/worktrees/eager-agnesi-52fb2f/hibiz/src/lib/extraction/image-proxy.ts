import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const BUCKET = "listing-images";
const MAX_IMAGES = 12;
const FETCH_MS = 10_000;
const MIN_BYTES = 400;
const MAX_BYTES = 6 * 1024 * 1024;

function extFromContentType(ct: string): string {
  const c = ct.toLowerCase();
  if (c.includes("png")) {
    return "png";
  }
  if (c.includes("webp")) {
    return "webp";
  }
  if (c.includes("gif")) {
    return "gif";
  }
  return "jpg";
}

/**
 * 将外链图片拉取后写入 Supabase Storage（需已创建 public bucket `listing-images`）。
 * 失败条目跳过；若全部失败返回空数组。
 */
export async function proxyImagesToStorage(
  imageUrls: string[],
  projectId: string,
  supabase: SupabaseClient,
): Promise<string[]> {
  const out: string[] = [];
  const safeProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "project";

  for (const rawUrl of imageUrls.slice(0, MAX_IMAGES)) {
    const u = rawUrl.trim();
    if (!u.startsWith("https://")) {
      continue;
    }
    try {
      const res = await fetch(u, {
        headers: {
          Referer: "https://www.trademe.co.nz/",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_MS),
        redirect: "follow",
        cache: "no-store",
      });
      if (!res.ok) {
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) {
        continue;
      }
      const ctRaw = res.headers.get("content-type");
      const ct = ctRaw?.split(";")[0]?.trim() || "image/jpeg";
      if (!ct.startsWith("image/")) {
        continue;
      }
      const ext = extFromContentType(ct);
      const path = `${safeProjectId}/${randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
        contentType: ct,
        upsert: false,
      });
      if (error) {
        console.warn("[proxyImagesToStorage] upload failed:", path, error.message);
        continue;
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (data.publicUrl) {
        out.push(data.publicUrl);
      }
    } catch (e) {
      console.warn("[proxyImagesToStorage] skip:", e instanceof Error ? e.message : e);
    }
  }

  return out;
}
