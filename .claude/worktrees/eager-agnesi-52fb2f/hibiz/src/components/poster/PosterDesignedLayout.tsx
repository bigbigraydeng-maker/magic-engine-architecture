import type { PosterTemplateId } from "@/data/poster-templates";
import type { MerchantContactV1 } from "@/types/merchant-profile";
import {
  BrandLogoRow,
  ContactBlock,
  ImageGrid,
  ListingAgentCard,
  QrBlock,
  WechatWhatsappRow,
} from "@/components/poster/poster-designed-fragments";
import { PosterListingAddressLine, PosterListingPriceStats } from "@/components/poster/poster-listing-fields";

export interface PosterDesignedLayoutProps {
  templateId: PosterTemplateId;
  headline: string;
  /** 海报正文：中英摘要或 Property details 回退（简短说明） */
  details: string;
  /** 海报主图区：建议最多 3 张（与 TradeMe 首屏多图一致） */
  imageUrls: string[];
  /** TradeMe 完整地址行（与标题分列） */
  listingAddress?: string | null;
  /** 页面上展示的标价/议价文案；无则整块不显示 */
  listingPriceHint?: string | null;
  listingBedrooms?: number | null;
  listingBathrooms?: number | null;
  /** 卧卫标签语言（与项目海报摘要语言一致） */
  posterLocale?: "en" | "zh";
  contact: MerchantContactV1 | undefined;
  /** 扫码打开 Trade Me（不在版面上印明文 URL） */
  listingQrDataUrl: string | null;
  listingAgentName?: string | null;
  listingAgentCompany?: string | null;
  /** 优先 listing 导入；否则回退到 Contact 电话 */
  listingAgentPhone?: string | null;
  listingAgentPhotoUrl?: string | null;
  /** 骨架 / 商家资料：公司 Logo */
  brandLogoUrl?: string | null;
  /** 微信二维码图 URL */
  wechatQrUrl?: string | null;
  /** WhatsApp 链接 */
  whatsappUrl?: string | null;
}

export function PosterDesignedLayout({
  templateId,
  headline,
  details,
  imageUrls,
  listingAddress,
  listingPriceHint,
  listingBedrooms,
  listingBathrooms,
  posterLocale = "zh",
  contact,
  listingQrDataUrl,
  listingAgentName,
  listingAgentCompany,
  listingAgentPhone,
  listingAgentPhotoUrl,
  brandLogoUrl,
  wechatQrUrl,
  whatsappUrl,
}: PosterDesignedLayoutProps) {
  const qrCaptionZh = "扫码查看 Trade Me 完整房源与全部图片";
  const qrCaptionEn = "Scan for full listing & gallery";

  if (templateId === "grid_gallery") {
    return (
      <div
        className="poster-sheet mx-auto flex max-w-[210mm] flex-col bg-[#faf9f7] p-8 shadow-lg print:border-0 print:shadow-none"
        style={{ minHeight: "297mm" }}
      >
        <div className="text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-stone-400">HiBiz · gallery</p>
          <BrandLogoRow url={brandLogoUrl} />
          <div className="mt-4">
            <PosterListingAddressLine listingAddress={listingAddress} variant="light" />
          </div>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-stone-900">{headline}</h2>
        </div>
        <div className="mt-6">
          <ImageGrid
            urls={imageUrls}
            rounded="rounded-2xl"
            emptyHintClass="border-stone-300 bg-stone-100 text-stone-500"
          />
        </div>
        <div className="mt-5">
          <PosterListingPriceStats
            listingPriceHint={listingPriceHint}
            listingBedrooms={listingBedrooms}
            listingBathrooms={listingBathrooms}
            variant="light"
            locale={posterLocale}
          />
        </div>
        {details ? (
          <p className="mt-6 whitespace-pre-wrap text-center text-sm leading-relaxed text-stone-600">{details}</p>
        ) : null}
        <div className="mt-6">
          <ListingAgentCard
            name={listingAgentName}
            company={listingAgentCompany}
            phone={listingAgentPhone}
            photoUrl={listingAgentPhotoUrl}
            variant="light"
          />
        </div>
        {listingQrDataUrl ? (
          <div className="mt-8 flex justify-center">
            <QrBlock dataUrl={listingQrDataUrl} captionZh={qrCaptionZh} captionEn={qrCaptionEn} />
          </div>
        ) : null}
        <WechatWhatsappRow wechatQrUrl={wechatQrUrl} whatsappUrl={whatsappUrl} variant="light" />
        <div className="mt-10 border-t border-stone-200 pt-6 text-center text-sm text-stone-700">
          {contact?.phone ? <p>Phone: {contact.phone}</p> : null}
          {contact?.email ? <p className="mt-1">Email: {contact.email}</p> : null}
          {contact?.address ? <p className="mt-2 whitespace-pre-line text-stone-600">{contact.address}</p> : null}
        </div>
        <p className="mt-8 text-center font-mono text-[9px] text-stone-300">HiBiz · magiclab.com</p>
      </div>
    );
  }

  if (templateId === "minimal_luxury") {
    return (
      <div
        className="poster-sheet mx-auto max-w-[210mm] border-[3px] border-double border-stone-300 bg-white p-12 shadow-lg print:border-double print:shadow-none"
        style={{ minHeight: "297mm" }}
      >
        <div className="flex min-h-[240mm] flex-col">
          <p className="text-center font-mono text-[9px] uppercase tracking-[0.5em] text-stone-400">Property</p>
          <BrandLogoRow url={brandLogoUrl} />
          <div className="mt-6">
            <PosterListingAddressLine listingAddress={listingAddress} variant="minimal" />
          </div>
          <h2 className="mt-4 text-center font-display text-4xl font-light tracking-tight text-stone-900">{headline}</h2>
          <div className="mx-auto mt-6 w-24 border-t border-stone-300" />
          <div className="mt-8 w-full max-w-xl mx-auto">
            <ImageGrid
              urls={imageUrls}
              rounded="rounded-sm border border-stone-200"
              emptyHintClass="border-stone-200 bg-stone-50 text-stone-400"
            />
          </div>
          <div className="mt-6">
            <PosterListingPriceStats
              listingPriceHint={listingPriceHint}
              listingBedrooms={listingBedrooms}
              listingBathrooms={listingBathrooms}
              variant="minimal"
              locale={posterLocale}
            />
          </div>
          {details ? (
            <p className="mt-8 whitespace-pre-wrap text-center text-sm font-light leading-loose text-stone-600">{details}</p>
          ) : null}
          <div className="mx-auto mt-8 max-w-md">
            <ListingAgentCard
              name={listingAgentName}
              company={listingAgentCompany}
              phone={listingAgentPhone}
              photoUrl={listingAgentPhotoUrl}
              variant="minimal"
            />
          </div>
          {listingQrDataUrl ? (
            <div className="mt-8 flex justify-center">
              <QrBlock dataUrl={listingQrDataUrl} captionZh={qrCaptionZh} captionEn={qrCaptionEn} />
            </div>
          ) : null}
          <WechatWhatsappRow wechatQrUrl={wechatQrUrl} whatsappUrl={whatsappUrl} variant="minimal" />
          <div className="mt-auto border-t border-stone-200 pt-8 text-center text-xs font-light text-stone-500">
            {contact?.phone ? <p>{contact.phone}</p> : null}
            {contact?.email ? <p className="mt-1">{contact.email}</p> : null}
            {contact?.address ? <p className="mt-2 whitespace-pre-line">{contact.address}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="poster-sheet mx-auto max-w-[210mm] overflow-hidden rounded-sm shadow-2xl print:shadow-none"
      style={{ minHeight: "297mm" }}
    >
      <div
        className="relative px-8 pb-12 pt-14 text-white"
        style={{
          background: "linear-gradient(168deg, #022c26 0%, #115e59 38%, #0d9488 72%, #134e4a 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <p className="relative text-center font-mono text-[10px] uppercase tracking-[0.45em] text-teal-200/85">
          New Zealand property
        </p>
        <div className="relative">
          <BrandLogoRow url={brandLogoUrl} />
        </div>
        <div className="relative mt-4">
          <PosterListingAddressLine listingAddress={listingAddress} variant="dark" />
        </div>
        <h2 className="relative mt-4 text-center font-display text-[2.1rem] font-semibold leading-[1.15] tracking-tight sm:text-[2.45rem]">
          {headline}
        </h2>

        <div className="relative mt-8">
          <ImageGrid
            urls={imageUrls}
            rounded="rounded-xl"
            emptyHintClass="border-white/30 bg-white/5 text-white/50"
          />
        </div>

        <div className="relative mt-6">
          <PosterListingPriceStats
            listingPriceHint={listingPriceHint}
            listingBedrooms={listingBedrooms}
            listingBathrooms={listingBathrooms}
            variant="dark"
            locale={posterLocale}
          />
        </div>

        {details ? (
          <div className="relative mx-auto mt-8 max-w-xl rounded-2xl bg-black/15 px-6 py-5 text-left backdrop-blur-sm">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal-200/80">简介</p>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.65] text-teal-50">{details}</p>
          </div>
        ) : null}

        <div className="relative mx-auto mt-8 max-w-lg">
          <ListingAgentCard
            name={listingAgentName}
            company={listingAgentCompany}
            phone={listingAgentPhone}
            photoUrl={listingAgentPhotoUrl}
            variant="coastal"
          />
        </div>

        {listingQrDataUrl ? (
          <div className="relative mt-10 flex justify-center">
            <QrBlock dataUrl={listingQrDataUrl} captionZh={qrCaptionZh} captionEn={qrCaptionEn} />
          </div>
        ) : null}

        <WechatWhatsappRow wechatQrUrl={wechatQrUrl} whatsappUrl={whatsappUrl} variant="dark" />
        <ContactBlock contact={contact} />
        <p className="relative mt-8 text-center font-mono text-[9px] text-teal-300/45">HiBiz · magiclab.com</p>
      </div>
    </div>
  );
}
