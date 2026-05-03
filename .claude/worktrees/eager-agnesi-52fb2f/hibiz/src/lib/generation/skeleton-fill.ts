import { footerDisclaimer, formPrivacyNote } from "@/lib/generation/compliance";
import type { GeneratedCopyV1 } from "@/lib/generation/openai-copy";
import type { MerchantProfileV1 } from "@/types/merchant-profile";
import type { RenderModelV1, RenderModuleV1 } from "@/types/render-model";
import type { SkeletonModule } from "@/types/skeleton";
import type { TemplateSkeleton } from "@/types/skeleton";

export function buildPosterContactFromProfile(profile: MerchantProfileV1): {
  name: string;
  phone: string;
  email: string;
  logo_url: string | null;
  wechat_qr_url: string | null;
  whatsapp_url: string | null;
} {
  const name = profile.display_name?.trim() ?? "";
  const phone = profile.contact?.phone?.trim() ?? "";
  const email = profile.contact?.email?.trim() ?? "";
  const wa = profile.contact?.whatsapp?.trim() ?? "";
  const digits = wa.replace(/\D/g, "");
  const whatsapp_url = digits.length >= 8 ? `https://wa.me/${digits}` : null;
  return {
    name,
    phone,
    email,
    logo_url: profile.logo_url?.trim() ?? null,
    wechat_qr_url: profile.contact?.wechat_qr_url?.trim() ?? null,
    whatsapp_url,
  };
}

function contactLinesFromProfile(profile: MerchantProfileV1): string[] {
  const lines: string[] = [];
  const p = profile.contact?.phone?.trim();
  const e = profile.contact?.email?.trim();
  const a = profile.contact?.address?.trim();
  const w = profile.contact?.whatsapp?.trim();
  const wx = profile.contact?.wechat_qr_url?.trim();
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
  if (wx) {
    lines.push("WeChat: scan QR on file or contact via phone/email above.");
  }
  return lines;
}

function industryForDisclaimer(skeleton: TemplateSkeleton): "real_estate" | "immigration_education" {
  return skeleton.industry === "real_estate" ? "real_estate" : "immigration_education";
}

function skeletonModuleToRender(
  skeleton: TemplateSkeleton,
  mod: SkeletonModule,
  moduleIndex: number,
  profile: MerchantProfileV1,
  formId: string,
  publicSlug: string,
  projectName: string,
): RenderModuleV1 {
  const id = `sk_${skeleton.id}_${moduleIndex}_${mod.type}`;
  const ind = industryForDisclaimer(skeleton);
  const privacyNote = formPrivacyNote(ind);
  const brand = profile.company_name?.trim() || profile.display_name?.trim() || projectName;

  switch (mod.type) {
    case "hero":
      return {
        id,
        type: "hero",
        variant: mod.variant,
        content: {
          eyebrow: profile.company_name?.trim() ?? null,
          title: profile.display_name?.trim() || projectName,
          subtitle: profile.bio_zh?.trim() || "专业房产服务 · New Zealand",
          primary_cta_label: "联系我们",
          secondary_cta_label: profile.property_listings?.length ? "查看房源" : null,
          subtitle_secondary: profile.bio_en?.trim() ?? null,
          image: {
            placeholder: profile.avatar_url || profile.logo_url ? "custom" : "property_exterior",
            alt: brand,
          },
        },
      };
    case "listings": {
      const items = (profile.property_listings ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        description: l.description,
        images: l.images,
        bedrooms: l.bedrooms,
        bathrooms: l.bathrooms,
        price_hint: l.price_hint,
        trademe_url: l.trademe_url,
      }));
      return {
        id,
        type: "listings",
        variant: mod.variant,
        content: {
          heading: "在售房源",
          items,
        },
      };
    }
    case "about":
      return {
        id,
        type: "about",
        variant: mod.variant,
        content: {
          heading: profile.display_name?.trim() ? `关于 ${profile.display_name.trim()}` : "关于我们",
          body: profile.bio_zh?.trim() || profile.bio_en?.trim() || "我们服务于新西兰本地买家与卖家。",
          badge: profile.company_name?.trim() ?? null,
        },
      };
    case "testimonials":
      return {
        id,
        type: "testimonials",
        variant: mod.variant,
        content: {
          heading: "客户评价",
          items: [
            { quote: "沟通清晰、流程透明。", author: "Local vendor", role: "Seller" },
            { quote: "专业且回复及时。", author: "Buyer", role: "Purchaser" },
          ],
        },
      };
    case "openHome":
      return {
        id,
        type: "openHome",
        variant: mod.variant,
        content: {
          heading: "Open Home",
          lines: [
            "欢迎预约看房或私人参观。",
            "提交表单告知您方便的时间段，我们会尽快联系确认。",
          ],
          cta_label: "预约登记",
        },
      };
    case "services":
      return {
        id,
        type: "services",
        variant: mod.variant,
        content: {
          heading: "服务范围",
          items: [
            { title: "房屋买卖", description: "全流程挂牌、营销与谈判支持。" },
            { title: "买家顾问", description: "匹配房源与出价策略。" },
            { title: "市场咨询", description: "区域行情与定价建议。" },
          ],
        },
      };
    case "faq":
      return {
        id,
        type: "faq",
        variant: mod.variant,
        content: {
          heading: "常见问题",
          items: [
            { q: "如何预约看房？", a: "请填写表单或通过电话 / WhatsApp 联系我们。" },
            { q: "我的信息如何使用？", a: "仅用于回复您的咨询，符合新西兰隐私惯例。" },
          ],
        },
      };
    case "form":
      return {
        id,
        type: "form",
        variant: mod.variant,
        content: {
          heading: "留言咨询",
          description: null,
          form_ref: { form_id: formId, public_slug: publicSlug },
          submit_label: "提交",
          privacy_note: privacyNote,
        },
      };
    case "contact":
      return {
        id,
        type: "contact",
        variant: mod.variant,
        content: {
          heading: "联系方式",
          lines:
            contactLinesFromProfile(profile).length > 0
              ? contactLinesFromProfile(profile)
              : ["请在项目设置中补充电话与邮箱。"],
          hours: "Mon–Fri 9:00–17:00 NZST",
        },
      };
    case "footer":
      return {
        id,
        type: "footer",
        variant: mod.variant,
        content: {
          brand,
          disclaimer: footerDisclaimer(ind),
          links: [{ label: "Privacy", href: "#privacy-note" }],
        },
      };
    case "offer":
      return {
        id,
        type: "offer",
        variant: mod.variant,
        content: {
          heading: "为何选择我们",
          bullets: ["本地市场经验", "流程透明", "沟通及时"],
          footnote: null,
        },
      };
    default: {
      const _ex: never = mod.type;
      return _ex;
    }
  }
}

/**
 * 确定性填充：可见骨架模块 → RenderModel 区块（不含 AI 覆盖）。
 */
export function fillSkeletonDeterministic(input: {
  skeleton: TemplateSkeleton;
  profile: MerchantProfileV1;
  formId: string;
  publicSlug: string;
  projectName: string;
  activeModuleEntries: { mod: SkeletonModule; index: number }[];
}): RenderModelV1 {
  const { skeleton, profile, formId, publicSlug, projectName, activeModuleEntries } = input;
  const modules: RenderModuleV1[] = activeModuleEntries.map(({ mod, index }) =>
    skeletonModuleToRender(skeleton, mod, index, profile, formId, publicSlug, projectName),
  );

  const ind = industryForDisclaimer(skeleton);
  const preset = ind === "real_estate" ? "trust_teal" : "warm_neutral";

  return {
    schema_version: 1,
    template_id: `skeleton_${skeleton.id}_v1`,
    template_version: "1.0.0",
    theme: {
      preset,
      density: "comfortable",
      skeleton_hex: {
        primary: skeleton.theme.primary,
        accent: skeleton.theme.accent,
        background: skeleton.theme.background,
        fontFamily: skeleton.theme.fontFamily,
      },
    },
    seo: {
      title: projectName,
      description: `${brandLine(profile, projectName)} · HiBiz microsite`,
    },
    modules,
  };
}

function brandLine(profile: MerchantProfileV1, projectName: string): string {
  return profile.company_name?.trim() || profile.display_name?.trim() || projectName;
}

export function mergeGeneratedCopyIntoSkeletonModel(model: RenderModelV1, copy: GeneratedCopyV1): RenderModelV1 {
  const modules = model.modules.map((mod): RenderModuleV1 => {
    if (mod.type === "hero") {
      return {
        ...mod,
        content: {
          ...mod.content,
          eyebrow: copy.hero.eyebrow,
          title: copy.hero.title,
          subtitle: copy.hero.subtitle,
          subtitle_secondary: copy.hero.subtitle_secondary ?? mod.content.subtitle_secondary,
          primary_cta_label: copy.hero.primary_cta_label,
          secondary_cta_label: copy.hero.secondary_cta_label,
        },
      };
    }
    if (mod.type === "offer") {
      return {
        ...mod,
        content: {
          ...mod.content,
          heading: copy.offer.heading,
          bullets: copy.offer.bullets.length > 0 ? copy.offer.bullets : mod.content.bullets,
          footnote: copy.offer.footnote,
        },
      };
    }
    if (mod.type === "faq") {
      return {
        ...mod,
        content: {
          ...mod.content,
          heading: copy.faq.heading,
          items: copy.faq.items.length >= 2 ? copy.faq.items : mod.content.items,
        },
      };
    }
    if (mod.type === "about") {
      return {
        ...mod,
        content: {
          ...mod.content,
          heading: copy.about.heading,
          body: copy.about.body,
          badge: copy.about.badge,
        },
      };
    }
    if (mod.type === "contact") {
      return {
        ...mod,
        content: {
          ...mod.content,
          heading: copy.contact.heading,
          lines: copy.contact.lines.length > 0 ? copy.contact.lines : mod.content.lines,
          hours: copy.contact.hours ?? mod.content.hours,
        },
      };
    }
    if (mod.type === "form") {
      return {
        ...mod,
        content: {
          ...mod.content,
          heading: copy.form_section.heading,
          description: copy.form_section.description,
          submit_label: copy.form_section.submit_label,
        },
      };
    }
    return mod;
  });

  return {
    ...model,
    modules,
    seo: {
      title: copy.seo_title || model.seo.title,
      description: copy.seo_description,
    },
  };
}
