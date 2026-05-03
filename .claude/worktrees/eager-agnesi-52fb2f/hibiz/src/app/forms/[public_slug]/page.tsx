import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LeadFormBlock } from "@/components/microsite/LeadFormBlock";
import { isFormFieldsFileV1 } from "@/lib/generation/form-presets";

interface PublicFormPageProps {
  params: { public_slug: string };
}

export async function generateMetadata({ params }: PublicFormPageProps): Promise<Metadata> {
  return {
    title: `Contact — ${params.public_slug}`,
    description: "Send a message",
  };
}

export default async function PublicFormPage({ params }: PublicFormPageProps) {
  const supabase = createClient();
  const { data: formRow } = await supabase
    .from("forms")
    .select("id, project_id, fields")
    .eq("public_slug", params.public_slug)
    .eq("status", "active")
    .maybeSingle();

  if (!formRow?.fields || !isFormFieldsFileV1(formRow.fields)) {
    notFound();
  }

  const fields = formRow.fields.fields;

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-12 max-w-lg items-center px-4">
          <Link href="/" className="text-sm font-medium text-emerald-900 hover:underline">
            HiBiz
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="font-display text-2xl font-semibold text-stone-900">Get in touch</h1>
        <p className="mt-2 text-sm text-stone-600">Fill in the form below and we&apos;ll respond as soon as we can.</p>
        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <LeadFormBlock
            formId={formRow.id}
            projectId={formRow.project_id}
            fields={fields}
            submitLabel="Submit"
            privacyNote="We will use your details only to respond to this enquiry."
            isTeal
          />
        </div>
      </main>
      <footer className="pb-8 text-center text-xs text-stone-400">
        <Link href="/" className="hover:text-stone-600">
          Powered by HiBiz
        </Link>
      </footer>
    </div>
  );
}
