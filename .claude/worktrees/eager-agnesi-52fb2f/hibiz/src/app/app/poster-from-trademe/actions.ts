"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { makeMicrositeSlug } from "@/lib/generation/slugs";
import { sanitizePastedTradeMeUrl } from "@/lib/extraction/trademe-url-sanitize";
import { importListingFromUrl } from "../projects/merchant-profile-actions";

function clamp(s: string, max: number): string {
  return s.trim().slice(0, max);
}

const STANDALONE_PATH = "/app/poster-from-trademe";

/**
 * 不经过「生成微站」：新建最小 project + microsites 占位行，再执行与项目内相同的 TradeMe 导入，成功则进入可打印海报页。
 */
export async function submitPosterFromTradeMeStandalone(formData: FormData): Promise<void> {
  const rawUrl = clamp(sanitizePastedTradeMeUrl(String(formData.get("trademe_url") ?? "")), 500);
  if (!rawUrl) {
    redirect(`${STANDALONE_PATH}?notice=no_url`);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(STANDALONE_PATH)}`);
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: "TradeMe 海报",
      status: "draft",
    })
    .select("id")
    .single();

  if (pErr || !project) {
    redirect(`${STANDALONE_PATH}?notice=create_project_failed`);
  }

  const slug = makeMicrositeSlug("poster");
  const { error: msErr } = await supabase.from("microsites").insert({
    project_id: project.id,
    slug,
    draft_model: {},
  });

  if (msErr) {
    await supabase.from("projects").delete().eq("id", project.id);
    redirect(`${STANDALONE_PATH}?notice=create_microsite_failed`);
  }

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${project.id}`);
  revalidatePath(STANDALONE_PATH);

  const posterPath = `/app/projects/${project.id}/poster`;
  await importListingFromUrl(project.id, rawUrl, "poster", STANDALONE_PATH, posterPath);
}
