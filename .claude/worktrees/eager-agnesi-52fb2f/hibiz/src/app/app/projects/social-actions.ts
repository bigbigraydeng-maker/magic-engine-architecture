"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateSocialCopy } from "@/lib/generation/openai-social-copy";
import { generateNlSocialCopy } from "@/lib/generation/openai-social-nl";
import { validateImageUpload } from "@/lib/upload/validate-image";
import { parseMerchantProfile, type PropertyListing } from "@/types/merchant-profile";
import { isSocialContentType, type SocialCaptionsV1 } from "@/types/social-content";

function formFieldString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function formOptionalNonEmpty(fd: FormData, key: string): string | null {
  const s = formFieldString(fd, key);
  return s.length > 0 ? s : null;
}

async function assertProjectOwner(supabase: ReturnType<typeof createClient>, projectId: string, userId: string) {
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return data?.id ?? null;
}

function pickListing(profileListings: PropertyListing[] | undefined, listingId: string | null): PropertyListing | null {
  if (!listingId?.trim() || !profileListings?.length) {
    return null;
  }
  return profileListings.find((l) => l.id === listingId) ?? null;
}

export async function generateSocialPost(formData: FormData): Promise<void> {
  const projectId = formFieldString(formData, "project_id");
  const contentTypeRaw = formFieldString(formData, "content_type");
  const listingId = formOptionalNonEmpty(formData, "listing_id");

  if (!projectId || !isSocialContentType(contentTypeRaw)) {
    redirect("/app/projects");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/projects/${projectId}/social`)}`);
  }

  const ownerOk = await assertProjectOwner(supabase, projectId, user.id);
  if (!ownerOk) {
    redirect("/app/projects");
  }

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
  const projectName = project?.name?.trim() || "Project";

  const { data: ms } = await supabase.from("microsites").select("merchant_profile").eq("project_id", projectId).maybeSingle();
  const profile = parseMerchantProfile(ms?.merchant_profile) ?? {
    schema_version: 1 as const,
  };

  const listing = pickListing(profile.property_listings, listingId);

  let captions: SocialCaptionsV1;
  try {
    captions = await generateSocialCopy({
      contentType: contentTypeRaw,
      profile,
      projectName,
      listing,
    });
  } catch {
    redirect(`/app/projects/${projectId}/social?type=${encodeURIComponent(contentTypeRaw)}&notice=gen_error`);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("social_posts")
    .insert({
      project_id: projectId,
      content_type: contentTypeRaw,
      captions,
      status: "active",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted?.id) {
    redirect(`/app/projects/${projectId}/social?type=${encodeURIComponent(contentTypeRaw)}&notice=save_error`);
  }

  revalidatePath(`/app/projects/${projectId}/social`);
  revalidatePath(`/app/projects/${projectId}/social/history`);
  redirect(`/app/projects/${projectId}/social?post=${inserted.id}`);
}

export async function generateSocialNlPost(formData: FormData): Promise<void> {
  const projectId = formFieldString(formData, "project_id");
  const prompt = formFieldString(formData, "prompt");

  if (!projectId) {
    redirect("/app/projects");
  }

  if (prompt.length < 3) {
    redirect(`/app/projects/${projectId}/social/nl?notice=nl_prompt_short`);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/projects/${projectId}/social/nl`)}`);
  }

  const ownerOk = await assertProjectOwner(supabase, projectId, user.id);
  if (!ownerOk) {
    redirect("/app/projects");
  }

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
  const projectName = project?.name?.trim() || "Project";

  const { data: ms } = await supabase.from("microsites").select("merchant_profile").eq("project_id", projectId).maybeSingle();
  const profile = parseMerchantProfile(ms?.merchant_profile) ?? {
    schema_version: 1 as const,
  };

  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const entry of rawFiles) {
    if (entry instanceof File && entry.size > 0) {
      files.push(entry);
    }
  }
  if (files.length > 12) {
    redirect(`/app/projects/${projectId}/social/nl?notice=nl_too_many_files`);
  }

  let captions: SocialCaptionsV1;
  try {
    captions = await generateNlSocialCopy({
      userPrompt: prompt,
      profile,
      projectName,
      files,
    });
  } catch {
    redirect(`/app/projects/${projectId}/social/nl?notice=nl_gen_error`);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("social_posts")
    .insert({
      project_id: projectId,
      content_type: "nl_upload",
      captions,
      status: "active",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted?.id) {
    redirect(`/app/projects/${projectId}/social/nl?notice=save_error`);
  }

  revalidatePath(`/app/projects/${projectId}/social`);
  revalidatePath(`/app/projects/${projectId}/social/nl`);
  revalidatePath(`/app/projects/${projectId}/social/history`);
  redirect(`/app/projects/${projectId}/social?post=${inserted.id}`);
}

export async function deleteSocialPost(formData: FormData): Promise<void> {
  const projectId = formFieldString(formData, "project_id");
  const postId = formFieldString(formData, "post_id");
  if (!projectId || !postId) {
    redirect("/app/projects");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/projects/${projectId}/social/history`)}`);
  }

  const ownerOk = await assertProjectOwner(supabase, projectId, user.id);
  if (!ownerOk) {
    redirect("/app/projects");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("social_posts")
    .update({ status: "deleted", deleted_at: now, updated_at: now })
    .eq("id", postId)
    .eq("project_id", projectId);

  if (error) {
    redirect(`/app/projects/${projectId}/social/history?notice=delete_error`);
  }

  revalidatePath(`/app/projects/${projectId}/social`);
  revalidatePath(`/app/projects/${projectId}/social/history`);
  redirect(`/app/projects/${projectId}/social/history?notice=deleted`);
}

export async function uploadSocialPosterFromForm(formData: FormData): Promise<void> {
  const projectId = formFieldString(formData, "project_id");
  const postId = formFieldString(formData, "post_id");
  const nextRaw = formFieldString(formData, "next_path");
  const nextPath =
    nextRaw.startsWith("/app/") && nextRaw.length > 4 ? nextRaw.slice(0, 500) : `/app/projects/${projectId}/social?post=${postId}`;

  if (!projectId || !postId) {
    redirect("/app/projects");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const ownerOk = await assertProjectOwner(supabase, projectId, user.id);
  if (!ownerOk) {
    redirect("/app/projects");
  }

  const { data: row } = await supabase
    .from("social_posts")
    .select("id")
    .eq("id", postId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!row) {
    redirect(nextPath + (nextPath.includes("?") ? "&" : "?") + "notice=poster_no_post");
  }

  const file = formData.get("poster");
  if (!(file instanceof File) || file.size <= 0) {
    redirect(nextPath + (nextPath.includes("?") ? "&" : "?") + "notice=poster_no_file");
  }

  const validated = await validateImageUpload(file, 6 * 1024 * 1024);
  if (!validated) {
    redirect(nextPath + (nextPath.includes("?") ? "&" : "?") + "notice=poster_invalid");
  }

  const path = `${user.id}/${projectId}/${postId}.${validated.ext}`;
  const { error: upErr } = await supabase.storage.from("social-posters").upload(path, validated.buffer, {
    contentType: validated.mime,
    upsert: true,
  });

  if (upErr) {
    redirect(nextPath + (nextPath.includes("?") ? "&" : "?") + "notice=poster_upload_error");
  }

  const publicUrl = supabase.storage.from("social-posters").getPublicUrl(path).data.publicUrl;
  const now = new Date().toISOString();

  await supabase.from("social_posts").update({ poster_url: publicUrl, updated_at: now }).eq("id", postId).eq("project_id", projectId);

  revalidatePath(`/app/projects/${projectId}/social`);
  revalidatePath(`/app/projects/${projectId}/social/history`);
  redirect(nextPath + (nextPath.includes("?") ? "&" : "?") + "notice=poster_saved");
}
