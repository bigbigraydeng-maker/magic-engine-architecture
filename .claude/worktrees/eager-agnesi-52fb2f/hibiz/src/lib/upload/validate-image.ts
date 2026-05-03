/**
 * Server-side image upload validation.
 * Checks MIME type allowlist + magic bytes to prevent non-image uploads.
 */

const ALLOWED_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** JPEG: FF D8 FF, PNG: 89 50 4E 47, WebP: 52 49 46 46 ... 57 45 42 50 */
const MAGIC_SIGNATURES: readonly { mime: string; bytes: readonly number[]; offset?: number }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

export interface ValidatedImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
  buffer: Buffer;
}

function detectMimeFromBytes(buf: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buf.length < offset + sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buf[offset + i] === b);
    if (match) return sig.mime;
  }
  return null;
}

function mimeToExt(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * Validate an uploaded file is a real image (JPEG/PNG/WebP).
 * Returns null if the file fails validation.
 */
export async function validateImageUpload(
  file: File,
  maxBytes: number = 5 * 1024 * 1024,
): Promise<ValidatedImage | null> {
  if (file.size <= 0 || file.size > maxBytes) {
    return null;
  }

  // Check declared MIME type
  const declaredMime = file.type?.toLowerCase() ?? "";
  if (declaredMime && !ALLOWED_MIME.has(declaredMime)) {
    return null;
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Verify magic bytes match an allowed image format
  const detectedMime = detectMimeFromBytes(buffer);
  if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
    return null;
  }

  return {
    mime: detectedMime as ValidatedImage["mime"],
    ext: mimeToExt(detectedMime),
    buffer,
  };
}
