import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSubNav } from "@/components/project-sub-nav";
import { ProjectWorkflowSidebar } from "@/components/project-workflow-sidebar";

interface ProjectIdLayoutProps {
  children: ReactNode;
  params: { id: string };
}

export default async function ProjectIdLayout({ children, params }: ProjectIdLayoutProps) {
  const supabase = createClient();
  const { data: project } = await supabase.from("projects").select("id").eq("id", params.id).maybeSingle();
  if (!project) {
    notFound();
  }

  return (
    <div className="lg:flex lg:items-start lg:gap-8">
      <ProjectWorkflowSidebar projectId={params.id} />
      <div className="min-w-0 flex-1">
        <ProjectSubNav projectId={params.id} />
        {children}
      </div>
    </div>
  );
}
