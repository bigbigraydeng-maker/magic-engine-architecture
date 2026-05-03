"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isFormFieldsFileV1 } from "@/lib/generation/form-presets";
import { validateFormPayload } from "@/lib/forms/validate-payload";
import { getClientIpFromHeaders, hashClientIpForLeads } from "@/lib/leads/client-ip-hash";

export type SubmitLeadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitLeadAction(input: {
  formId: string;
  projectId: string;
  data: Record<string, string>;
  /** Honeypot — must stay empty for humans; filled by bots → silent success, no insert. */
  honeypotCompany?: string;
}): Promise<SubmitLeadResult> {
  const { formId, projectId, data } = input;
  const honeypot = typeof input.honeypotCompany === "string" ? input.honeypotCompany.trim() : "";
  if (honeypot.length > 0) {
    return { ok: true };
  }

  if (
    typeof formId !== "string" ||
    formId.length === 0 ||
    typeof projectId !== "string" ||
    projectId.length === 0
  ) {
    return { ok: false, error: "Invalid form." };
  }

  const h = headers();
  const ipRaw = getClientIpFromHeaders((name) => h.get(name));
  const ipHash = hashClientIpForLeads(ipRaw);

  const supabase = createClient();

  const { data: rateOk, error: rpcErr } = await supabase.rpc("check_lead_rate_limit", {
    p_form_id: formId,
    p_ip_hash: ipHash,
  });

  if (rpcErr) {
    return { ok: false, error: "Could not send right now. Please try again." };
  }
  if (rateOk !== true) {
    return { ok: false, error: "Too many submissions. Please wait and try again." };
  }

  const { data: formRow, error: formErr } = await supabase
    .from("forms")
    .select("id, project_id, fields")
    .eq("id", formId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .maybeSingle();

  if (formErr || !formRow || !isFormFieldsFileV1(formRow.fields)) {
    return { ok: false, error: "This form is not available." };
  }

  const validated = validateFormPayload(formRow.fields.fields, data);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const ua = h.get("user-agent") ?? "";
  const shortUa = ua.length > 200 ? `${ua.slice(0, 200)}…` : ua;

  const { error: insErr } = await supabase.from("submissions").insert({
    form_id: formId,
    project_id: projectId,
    payload: validated.payload,
    meta: {
      source: "hibiz_web",
      submitted_at: new Date().toISOString(),
      ip_hash: ipHash,
      user_agent: shortUa,
    },
  });

  if (insErr) {
    return { ok: false, error: "Could not send right now. Please try again." };
  }

  return { ok: true };
}
