import type { MerchantContactV1 } from "@/types/merchant-profile";

/** Prefer merchant-configured contact lines on the Contact module. */
export function contactLinesFromMerchant(modelLines: string[], contact: MerchantContactV1 | undefined): string[] {
  const lines: string[] = [];
  const p = contact?.phone?.trim();
  const e = contact?.email?.trim();
  const a = contact?.address?.trim();
  const w = contact?.whatsapp?.trim();
  if (p) {
    lines.push(`Phone: ${p}`);
  }
  if (e) {
    lines.push(`Email: ${e}`);
  }
  if (a) {
    lines.push(`Address: ${a}`);
  }
  if (w) {
    const digits = w.replace(/\D/g, "");
    if (digits.length >= 8) {
      lines.push(`WhatsApp: https://wa.me/${digits}`);
    } else {
      lines.push(`WhatsApp: ${w}`);
    }
  }
  if (contact?.wechat_qr_url?.trim()) {
    lines.push("WeChat: 见下方二维码");
  }
  return lines.length > 0 ? lines : modelLines;
}

export function safeExternalImageUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const u = raw.trim();
  if (u.startsWith("https://")) {  // ✅ 仅 HTTPS，拒绝 HTTP
    return u;
  }
  return null;
}
