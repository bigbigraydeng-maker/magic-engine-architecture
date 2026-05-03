import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BuilderMicrositeSection } from "@/components/builder/BuilderMicrositeSection";
import { RenderMicrosite } from "@/components/microsite/RenderMicrosite";
import { isFormFieldsFileV1 } from "@/lib/generation/form-presets";
import { parseMerchantProfile } from "@/types/merchant-profile";
import { isRenderModelV1 } from "@/types/render-model";

interface PublicSitePageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: PublicSitePageProps): Promise<Metadata> {
  const supabase = createClient();
  const { data } = await supabase.from("microsites_published").select("seo").eq("slug", params.slug).maybeSingle();
  const seo = data?.seo;
  if (seo && typeof seo === "object" && seo !== null && "title" in seo) {
    const s = seo as { title?: string; description?: string };
    return {
      title: typeof s.title === "string" ? s.title : "Site",
      description: typeof s.description === "string" ? s.description : undefined,
    };
  }
  return { title: "Site" };
}

export default async function PublicSitePage({ params, searchParams }: PublicSitePageProps) {
  const supabase = createClient();
  const { data: row } = await supabase
    .from("microsites_published")
    .select("project_id, published_model, merchant_profile")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!row?.published_model || !isRenderModelV1(row.published_model)) {
    notFound();
  }

  const { data: formRow } = await supabase
    .from("forms")
    .select("id, fields")
    .eq("project_id", row.project_id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const formFields = formRow?.fields && isFormFieldsFileV1(formRow.fields) ? formRow.fields : null;
  const formId = formRow?.id ?? null;
  const merchantProfile = parseMerchantProfile(row.merchant_profile);

  const builderUrlPath =
    merchantProfile?.builder_url_path_override?.trim() || `/site/${params.slug}`;
  const showBuilderSection = merchantProfile?.builder_section_enabled === true;
  const builderAfter = merchantProfile?.builder_section_position === "after";

  const builderBlock = showBuilderSection ? (
    <BuilderMicrositeSection urlPath={builderUrlPath} searchParams={searchParams} />
  ) : null;

  return (
    <>
      {!builderAfter ? builderBlock : null}
      <RenderMicrosite
        model={row.published_model}
        formFields={formFields}
        interactiveForm={formId ? { formId, projectId: row.project_id } : null}
        merchantProfile={merchantProfile}
      />
      {builderAfter ? builderBlock : null}
    </>
  );
}
