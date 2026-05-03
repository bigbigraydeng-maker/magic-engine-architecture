import QRCode from "qrcode";

/** 为房源链接生成可嵌入 <img> 的 data URL（海报扫码，不展示明文 URL） */
export async function listingUrlToQrDataUrl(url: string): Promise<string> {
  const u = url.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    throw new Error("Invalid URL for QR");
  }
  return QRCode.toDataURL(u, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172aFF", light: "#FFFFFFFF" },
  });
}
