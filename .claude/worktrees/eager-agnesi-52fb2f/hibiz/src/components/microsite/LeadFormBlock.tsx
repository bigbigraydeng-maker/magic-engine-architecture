"use client";

import { useState } from "react";
import type { FormFieldRow } from "@/lib/generation/form-presets";
import { submitLeadAction } from "@/app/actions/submit-lead";

export interface LeadFormBlockProps {
  formId: string;
  projectId: string;
  fields: FormFieldRow[];
  submitLabel: string;
  privacyNote: string;
  isTeal: boolean;
}

export function LeadFormBlock({ formId, projectId, fields, submitLabel, privacyNote, isTeal }: LeadFormBlockProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Honeypot — leave empty; bots often fill “company website”. */
  const [companyWebsiteTrap, setCompanyWebsiteTrap] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ""])),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(null);
    const res = await submitLeadAction({
      formId,
      projectId,
      data: values,
      honeypotCompany: companyWebsiteTrap,
    });
    if (res.ok) {
      setStatus("success");
      return;
    }
    setStatus("error");
    setErrorMessage(res.error);
  }

  if (status === "success") {
    return (
      <div
        className={`rounded-2xl border px-6 py-8 text-center text-sm ${
          isTeal ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        <p className="font-medium">Thank you — we&apos;ll be in touch.</p>
      </div>
    );
  }

  const btnClass = isTeal ? "bg-emerald-800 hover:bg-emerald-900" : "bg-amber-800 hover:bg-amber-900";

  return (
    <form onSubmit={onSubmit} className="relative space-y-4">
      <div
        className="pointer-events-none absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden opacity-0"
        aria-hidden="true"
      >
        <label htmlFor="hibiz-company-website">Company website</label>
        <input
          id="hibiz-company-website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={companyWebsiteTrap}
          onChange={(e) => setCompanyWebsiteTrap(e.target.value)}
        />
      </div>
      {fields.map((f) => (
        <div key={f.key}>
          <label htmlFor={`field-${f.key}`} className="block text-sm font-medium text-stone-700">
            {f.label}
            {f.required ? <span className="text-red-600"> *</span> : null}
          </label>
          {f.type === "textarea" ? (
            <textarea
              id={`field-${f.key}`}
              name={f.key}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-800 focus:ring-2"
              rows={3}
              placeholder={f.placeholder}
              required={f.required}
              maxLength={f.max_length}
            />
          ) : f.type === "select" && f.options && f.options.length > 0 ? (
            <select
              id={`field-${f.key}`}
              name={f.key}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-800 focus:ring-2"
              required={f.required}
            >
              <option value="">Choose…</option>
              {f.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`field-${f.key}`}
              name={f.key}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-800 focus:ring-2"
              placeholder={f.placeholder}
              type={f.type === "email" ? "email" : "text"}
              inputMode={f.type === "phone" ? "tel" : undefined}
              required={f.required}
              maxLength={f.max_length}
            />
          )}
        </div>
      ))}
      {errorMessage ? <p className="text-sm text-red-700">{errorMessage}</p> : null}
      <button
        type="submit"
        disabled={status === "loading"}
        className={`w-full rounded-lg py-3 text-sm font-semibold text-white disabled:opacity-60 ${btnClass}`}
      >
        {status === "loading" ? "Sending…" : submitLabel}
      </button>
      <p id="privacy-note" className="text-xs text-stone-500">
        {privacyNote}
      </p>
    </form>
  );
}
