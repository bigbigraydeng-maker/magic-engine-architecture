import type { FormFieldsFileV1 } from "@/lib/generation/form-presets";
import { contactLinesFromMerchant, safeExternalImageUrl } from "@/lib/merchant-profile/render-merge";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { RenderModelV1 } from "@/types/render-model";
import { EditableInlineText } from "./EditableInlineText";
import {
  ListingsModuleSection,
  OpenHomeModuleSection,
  ServicesModuleSection,
  TestimonialsModuleSection,
} from "./microsite-skeleton-sections";
import { LeadFormBlock } from "./LeadFormBlock";

interface RenderMicrositeProps {
  model: RenderModelV1;
  formFields?: FormFieldsFileV1 | null;
  preview?: boolean;
  /** When set, the lead form submits to Supabase (public live site only). */
  interactiveForm?: { formId: string; projectId: string } | null;
  /** Merchant-configured contact + property image (microsites.merchant_profile). */
  merchantProfile?: MerchantProfileV1 | null;
  /** 骨架预览：启用 hero 标题等 contentEditable 微调 */
  editableProjectId?: string | null;
}

export function RenderMicrosite({
  model,
  formFields,
  preview,
  interactiveForm,
  merchantProfile,
  editableProjectId,
}: RenderMicrositeProps) {
  const { theme } = model;
  const isTeal = theme.preset === "trust_teal";
  const hex = theme.skeleton_hex;
  const bgMain = hex ? "" : isTeal ? "bg-emerald-950" : "bg-stone-900";
  const headerBgStyle = hex ? { backgroundColor: hex.primary } : undefined;
  const accentText = hex ? "text-white/80" : isTeal ? "text-emerald-300" : "text-amber-200";
  const bulletAccent = hex?.accent ?? (isTeal ? "#10b981" : "#d97706");
  const heroImageUrl =
    safeExternalImageUrl(merchantProfile?.hero_image_url) ??
    safeExternalImageUrl(merchantProfile?.property_promo?.image_url) ??
    safeExternalImageUrl(merchantProfile?.avatar_url) ??
    safeExternalImageUrl(merchantProfile?.logo_url);

  const pageBg = hex?.background;
  const hasFormModule = model.modules.some((m) => m.type === "form");
  const hasContactModule = model.modules.some((m) => m.type === "contact");
  const heroBackdrop =
    hex?.primary && !heroImageUrl
      ? {
          backgroundImage: `linear-gradient(165deg, ${hex.primary} 0%, #0c0a09 55%, #050505 100%)`,
        }
      : undefined;

  return (
    <article
      className={`min-h-screen text-stone-900 ${pageBg ? "" : "bg-stone-50"}`}
      style={pageBg ? { backgroundColor: pageBg } : undefined}
    >
      {preview ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Preview — not the public live URL yet
        </div>
      ) : null}

      {model.modules.map((mod) => {
        if (mod.type === "hero") {
          const { content } = mod;
          const cinematicBgUrl = heroImageUrl ?? undefined;
          const cinematic = Boolean(cinematicBgUrl);
          const ctaBase =
            "inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-7 py-3 text-sm font-semibold shadow-lg transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80";
          const primaryCtaStyle = hex?.accent ? { backgroundColor: hex.accent } : undefined;
          const primaryCtaClass = `${ctaBase} text-white ${
            !hex?.accent ? (isTeal ? "bg-emerald-500 hover:bg-emerald-400" : "bg-amber-500 hover:bg-amber-400") : "hover:brightness-110"
          }`;
          const secondaryCtaClass = `${ctaBase} border border-white/50 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20`;

          const primaryCtaEl =
            hasFormModule && content.primary_cta_label.trim() ? (
              <a href="#form" className={primaryCtaClass} style={primaryCtaStyle}>
                {content.primary_cta_label}
              </a>
            ) : (
              <span className={primaryCtaClass} style={primaryCtaStyle}>
                {content.primary_cta_label}
              </span>
            );

          const secondaryCtaEl =
            content.secondary_cta_label && hasContactModule ? (
              <a href="#contact" className={secondaryCtaClass}>
                {content.secondary_cta_label}
              </a>
            ) : content.secondary_cta_label ? (
              <span className={secondaryCtaClass}>{content.secondary_cta_label}</span>
            ) : null;

          return (
            <header
              key={mod.id}
              className={
                cinematic
                  ? "relative isolate flex min-h-[min(88vh,56rem)] items-center overflow-hidden px-4 py-20 text-white sm:py-24"
                  : `${bgMain} px-4 py-20 text-white sm:py-24`
              }
              style={cinematic ? undefined : headerBgStyle ?? heroBackdrop}
            >
              {cinematic && cinematicBgUrl ? (
                <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static export; external URLs */}
                  <img src={cinematicBgUrl} alt="" className="h-full w-full object-cover object-center" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/30" />
                  {hex?.primary ? (
                    <div className="absolute inset-0 opacity-35 mix-blend-multiply" style={{ backgroundColor: hex.primary }} />
                  ) : null}
                </div>
              ) : null}
              <div className="mx-auto w-full max-w-4xl text-center">
                {merchantProfile?.logo_url?.trim() ? (
                  <div className={`mb-8 flex justify-center ${cinematic ? "drop-shadow-md" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={merchantProfile.logo_url.trim()}
                      alt=""
                      className="h-12 w-auto max-w-[220px] object-contain sm:h-14"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : null}
                {content.eyebrow ? (
                  <p className={`text-xs font-semibold uppercase tracking-[0.2em] sm:text-sm ${accentText}`}>{content.eyebrow}</p>
                ) : null}
                {editableProjectId && preview ? (
                  <EditableInlineText
                    projectId={editableProjectId}
                    moduleId={mod.id}
                    field="title"
                    initialText={content.title}
                    as="h1"
                    className="mt-4 block text-balance font-display text-4xl font-semibold leading-[1.1] tracking-tight outline-none ring-emerald-400/50 focus:ring-2 sm:text-5xl sm:leading-[1.08]"
                  />
                ) : (
                  <h1 className="mt-4 text-balance font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl sm:leading-[1.08]">
                    {content.title}
                  </h1>
                )}
                {editableProjectId && preview ? (
                  <EditableInlineText
                    projectId={editableProjectId}
                    moduleId={mod.id}
                    field="subtitle"
                    initialText={content.subtitle}
                    as="p"
                    className="mx-auto mt-5 block max-w-2xl text-lg leading-relaxed text-white/85 outline-none ring-emerald-400/50 focus:ring-2 sm:text-xl"
                  />
                ) : (
                  <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/85 sm:text-xl">{content.subtitle}</p>
                )}
                {content.subtitle_secondary ? (
                  <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-white/70">{content.subtitle_secondary}</p>
                ) : null}
                <div className="mt-10 flex flex-wrap justify-center gap-3 sm:mt-12">
                  {primaryCtaEl}
                  {secondaryCtaEl}
                </div>
              </div>
            </header>
          );
        }

        if (mod.type === "offer") {
          const { content } = mod;
          return (
            <section key={mod.id} className="px-4 py-14 sm:py-16">
              <div className="mx-auto max-w-3xl rounded-3xl border border-stone-200/80 bg-white p-8 shadow-sm sm:p-10">
                <h2 className="font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{content.heading}</h2>
                <ul className="mt-8 space-y-4 text-stone-700">
                  {content.bullets.map((b) => (
                    <li key={b} className="flex gap-3 text-base leading-snug">
                      <span className="mt-0.5 shrink-0 font-semibold" style={{ color: bulletAccent }}>
                        ✓
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {content.footnote ? <p className="mt-8 border-t border-stone-100 pt-6 text-sm text-stone-500">{content.footnote}</p> : null}
              </div>
            </section>
          );
        }

        if (mod.type === "form") {
          const { content } = mod;
          const fields = formFields?.fields ?? [];
          const canSubmit =
            interactiveForm != null && fields.length > 0 && interactiveForm.formId === content.form_ref.form_id;

          return (
            <section
              key={mod.id}
              id="form"
              className={`scroll-mt-6 border-y border-stone-200/90 px-4 py-14 sm:py-16 ${isTeal ? "bg-emerald-50/50" : "bg-amber-50/50"}`}
            >
              <div className="mx-auto max-w-xl">
                <h2 className="font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{content.heading}</h2>
                {content.description ? <p className="mt-2 text-sm text-stone-600">{content.description}</p> : null}
                <div className="mt-8 rounded-2xl border border-stone-200/90 bg-white p-6 shadow-md shadow-stone-900/5 sm:p-8">
                  {canSubmit ? (
                    <LeadFormBlock
                      formId={interactiveForm.formId}
                      projectId={interactiveForm.projectId}
                      fields={fields}
                      submitLabel={content.submit_label}
                      privacyNote={content.privacy_note}
                      isTeal={isTeal}
                    />
                  ) : (
                    <div className="space-y-4">
                      {fields.map((f) => (
                        <div key={f.key}>
                          <label className="block text-sm font-medium text-stone-700">{f.label}</label>
                          {f.type === "textarea" ? (
                            <textarea
                              readOnly
                              className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
                              rows={3}
                              placeholder={f.placeholder}
                            />
                          ) : f.type === "select" ? (
                            <select disabled className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                              <option value="">{f.placeholder || "Select"}</option>
                              {(f.options ?? []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              readOnly
                              className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
                              placeholder={f.placeholder}
                              type={f.type === "email" ? "email" : "text"}
                            />
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        className={`w-full rounded-lg py-3 text-sm font-semibold text-white ${isTeal ? "bg-emerald-800" : "bg-amber-800"}`}
                      >
                        {content.submit_label}
                      </button>
                      <p id="privacy-note" className="text-xs text-stone-500">
                        {content.privacy_note}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        }

        if (mod.type === "faq") {
          const { content } = mod;
          return (
            <section key={mod.id} className="bg-stone-50/80 px-4 py-14 sm:py-16">
              <div className="mx-auto max-w-3xl">
                <h2 className="font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{content.heading}</h2>
                <dl className="mt-8 space-y-4">
                  {content.items.map((item) => (
                    <div key={item.q} className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
                      <dt className="font-medium text-stone-900">{item.q}</dt>
                      <dd className="mt-2 text-sm leading-relaxed text-stone-600 sm:text-base">{item.a}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          );
        }

        if (mod.type === "about") {
          const { content } = mod;
          return (
            <section key={mod.id} className="px-4 py-14 sm:py-16">
              <div className="mx-auto max-w-3xl">
                {content.badge ? (
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{content.badge}</p>
                ) : null}
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{content.heading}</h2>
                <p className="mt-6 whitespace-pre-wrap text-lg leading-relaxed text-stone-700">{content.body}</p>
              </div>
            </section>
          );
        }

        if (mod.type === "contact") {
          const { content } = mod;
          const lines = contactLinesFromMerchant(content.lines, merchantProfile?.contact);
          const wxUrl = merchantProfile?.contact?.wechat_qr_url?.trim();
          return (
            <section key={mod.id} id="contact" className="scroll-mt-6 border-t border-stone-200/80 bg-white px-4 py-14 sm:py-16">
              <div className="mx-auto max-w-3xl">
                <h2 className="font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{content.heading}</h2>
                <ul className="mt-4 space-y-2 text-stone-700">
                  {lines.map((line) => (
                    <li key={line}>
                      {line.startsWith("WhatsApp: https://") ? (
                        <a href={line.replace("WhatsApp: ", "")} className="text-emerald-800 underline">
                          WhatsApp
                        </a>
                      ) : (
                        line
                      )}
                    </li>
                  ))}
                </ul>
                {wxUrl ? (
                  <div className="mt-6 flex flex-col items-center gap-2">
                    <p className="text-sm text-stone-600">微信</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={wxUrl} alt="" className="h-36 w-36 rounded-lg border border-stone-200 object-contain" />
                  </div>
                ) : null}
                {content.hours ? <p className="mt-4 text-sm text-stone-500">{content.hours}</p> : null}
              </div>
            </section>
          );
        }

        if (mod.type === "listings") {
          return <ListingsModuleSection key={mod.id} content={mod.content} />;
        }

        if (mod.type === "testimonials") {
          return <TestimonialsModuleSection key={mod.id} content={mod.content} />;
        }

        if (mod.type === "openHome") {
          return <OpenHomeModuleSection key={mod.id} content={mod.content} />;
        }

        if (mod.type === "services") {
          return <ServicesModuleSection key={mod.id} content={mod.content} />;
        }

        if (mod.type === "footer") {
          const { content } = mod;
          return (
            <footer
              key={mod.id}
              className={`border-t px-4 py-12 ${isTeal ? "border-emerald-900/20 bg-emerald-950 text-emerald-100" : "border-stone-800/20 bg-stone-900 text-stone-300"}`}
            >
              <div className="mx-auto max-w-3xl text-center text-sm">
                <p className="font-display text-base font-semibold text-white">{content.brand}</p>
                <p className="mt-5 text-left text-xs leading-relaxed text-stone-400">{content.disclaimer}</p>
              </div>
            </footer>
          );
        }

        return null;
      })}
    </article>
  );
}
