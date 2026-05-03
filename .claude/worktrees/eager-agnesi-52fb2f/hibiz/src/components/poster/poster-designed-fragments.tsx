import type { MerchantContactV1 } from "@/types/merchant-profile";

export function QrBlock({
  dataUrl,
  captionZh,
  captionEn,
}: {
  dataUrl: string;
  captionZh: string;
  captionEn: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt=""
        width={200}
        height={200}
        className="h-44 w-44 rounded-xl bg-white p-2 shadow-lg"
      />
      <p className="mt-2 text-[11px] leading-snug opacity-90">
        <span className="block">{captionZh}</span>
        <span className="mt-0.5 block font-mono text-[10px] opacity-80">{captionEn}</span>
      </p>
    </div>
  );
}

export function ListingAgentCard({
  name,
  company,
  phone,
  photoUrl,
  variant,
}: {
  name: string | null | undefined;
  company: string | null | undefined;
  phone: string | null | undefined;
  photoUrl: string | null | undefined;
  variant: "coastal" | "light" | "minimal";
}) {
  if (!name?.trim() && !company?.trim() && !photoUrl?.trim() && !phone?.trim()) {
    return null;
  }

  const textMuted =
    variant === "coastal"
      ? "text-emerald-100/90"
      : variant === "minimal"
        ? "text-stone-500"
        : "text-stone-600";
  const nameClass =
    variant === "coastal" ? "text-white font-semibold" : "font-semibold text-stone-900";
  const ring = variant === "coastal" ? "ring-2 ring-white/30" : "ring-2 ring-stone-200";
  const phoneClass =
    variant === "coastal" ? "text-teal-100/95" : variant === "minimal" ? "text-stone-600" : "text-stone-700";

  return (
    <div
      className={`flex items-center justify-center gap-4 ${
        variant === "coastal" ? "rounded-2xl bg-black/20 px-5 py-4 backdrop-blur-md" : "rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-3"
      }`}
    >
      {photoUrl?.trim() ? (
        <div className={`h-16 w-16 shrink-0 overflow-hidden rounded-full ${ring}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl.trim()} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        </div>
      ) : (
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
            variant === "coastal" ? "bg-white/15 text-white/90" : "bg-stone-200 text-stone-600"
          }`}
        >
          {(name?.trim() ?? company?.trim() ?? phone?.trim() ?? "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 text-left">
        {name?.trim() ? <p className={`text-lg leading-tight ${nameClass}`}>{name.trim()}</p> : null}
        {company?.trim() ? <p className={`mt-0.5 text-sm ${textMuted}`}>{company.trim()}</p> : null}
        {phone?.trim() ? <p className={`mt-1.5 text-sm font-medium ${phoneClass}`}>{phone.trim()}</p> : null}
        {!name?.trim() && !company?.trim() && !phone?.trim() ? <p className={`text-sm ${textMuted}`}>Listing agent</p> : null}
      </div>
    </div>
  );
}

export function ContactBlock({ contact }: { contact: MerchantContactV1 | undefined }) {
  return (
    <div className="mt-auto border-t border-white/15 pt-6 text-center text-sm text-white/90">
      {contact?.phone ? <p>Phone: {contact.phone}</p> : null}
      {contact?.email ? <p className={contact?.phone ? "mt-1" : ""}>Email: {contact.email}</p> : null}
      {contact?.address ? <p className="mt-2 whitespace-pre-line text-white/80">{contact.address}</p> : null}
      {!contact?.email && !contact?.address ? (
        <p className="text-white/45">商家联系可在项目页「Business details」补充邮箱与地址</p>
      ) : null}
    </div>
  );
}

export function ImageGrid({
  urls,
  rounded,
  emptyHintClass,
}: {
  urls: string[];
  rounded: string;
  emptyHintClass: string;
}) {
  if (urls.length === 0) {
    return (
      <div
        className={`flex h-52 items-center justify-center border border-dashed px-3 text-center text-sm ${rounded} ${emptyHintClass}`}
      >
        添加图片 URL 或从 TradeMe 导入（海报展示最多 3 张，其余请扫码查看）
      </div>
    );
  }
  if (urls.length === 1) {
    return (
      <div className={`overflow-hidden ${rounded}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[0]}
          alt=""
          className="max-h-80 w-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }
  const gridClass =
    urls.length === 2 ? "grid grid-cols-2 gap-2" : urls.length === 3 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3";
  return (
    <div className={`${gridClass} ${rounded} overflow-hidden`}>
      {urls.map((src) => (
        <div key={src} className="aspect-[4/3] overflow-hidden bg-black/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        </div>
      ))}
    </div>
  );
}

export function BrandLogoRow({ url }: { url: string | null | undefined }) {
  if (!url?.trim()) {
    return null;
  }
  return (
    <div className="mb-4 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url.trim()} alt="" className="h-12 w-auto max-w-[180px] object-contain" referrerPolicy="no-referrer" />
    </div>
  );
}

export function WechatWhatsappRow({
  wechatQrUrl,
  whatsappUrl,
  variant,
}: {
  wechatQrUrl: string | null | undefined;
  whatsappUrl: string | null | undefined;
  variant: "light" | "dark" | "minimal";
}) {
  if (!wechatQrUrl?.trim() && !whatsappUrl?.trim()) {
    return null;
  }
  const textClass =
    variant === "dark" ? "text-teal-100/90" : variant === "minimal" ? "text-stone-600" : "text-stone-700";
  return (
    <div className={`mt-4 flex flex-wrap items-end justify-center gap-6 text-sm ${textClass}`}>
      {whatsappUrl?.trim() ? (
        <a href={whatsappUrl.trim()} className="font-medium underline">
          WhatsApp
        </a>
      ) : null}
      {wechatQrUrl?.trim() ? (
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs opacity-80">WeChat</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={wechatQrUrl.trim()} alt="" className="h-24 w-24 rounded-lg border border-white/20 object-contain" />
        </div>
      ) : null}
    </div>
  );
}
