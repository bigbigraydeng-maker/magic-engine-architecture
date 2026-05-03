"use client";

const WORKFLOW_STEPS: { id: string; step: number; label: string; description: string }[] = [
  { id: "workflow-compile-v2", step: 1, label: "Compile Intent", description: "AI 理解你的需求" },
  { id: "workflow-intent", step: 2, label: "Intent Input", description: "输入你的想法" },
  { id: "workflow-preview", step: 3, label: "Preview Draft", description: "预览网站效果" },
  { id: "workflow-merchant", step: 4, label: "Business Info", description: "完善商家信息" },
];

const SECONDARY_LINKS: { label: string; path: string }[] = [{ label: "🧰 工具箱", path: "/toolkit" }];

export interface ProjectWorkflowSidebarProps {
  projectId: string;
}

export function ProjectWorkflowSidebar({ projectId }: ProjectWorkflowSidebarProps) {
  return (
    <aside className="space-y-8">
      {/* 主工作流 */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-4">📋 工作流</p>
        <nav className="space-y-2">
          {WORKFLOW_STEPS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="group flex items-start gap-3 rounded-lg py-2.5 px-3 transition-all hover:bg-indigo-50 hover:text-indigo-900"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 group-hover:bg-indigo-200">
                {item.step}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900">{item.label}</p>
                <p className="text-xs text-stone-500">{item.description}</p>
              </div>
            </a>
          ))}
        </nav>
      </div>

      {/* 分割线 */}
      <div className="h-px bg-stone-200"></div>

      {/* 二级链接 */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-4">🔗 快速链接</p>
        <nav className="space-y-2">
          {SECONDARY_LINKS.map((link) => (
            <a
              key={link.path}
              href={`/app/projects/${projectId}${link.path}`}
              className="flex items-center gap-2 rounded-lg py-2 px-3 text-sm text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      {/* 帮助提示 */}
      <div className="rounded-lg bg-blue-50 p-3 border border-blue-200">
        <p className="text-xs font-medium text-blue-900 mb-2">💡 工作流提示</p>
        <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
          <li>输入你的商业想法</li>
          <li>点击「Compile」让AI理解</li>
          <li>预览生成的网站</li>
          <li>补充商家信息后发布</li>
        </ol>
      </div>
    </aside>
  );
}
