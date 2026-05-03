"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ProjectSubNavProps {
  projectId: string;
}

export function ProjectSubNav({ projectId }: ProjectSubNavProps) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;
  const items: { href: string; label: string }[] = [
    { href: base, label: "项目" },
    { href: `${base}/toolkit`, label: "工具箱" },
    { href: `${base}/dashboard`, label: "数据" },
    { href: `${base}/leads`, label: "线索" },
  ];

  function isActive(href: string): boolean {
    if (href === base) {
      return pathname === base;
    }
    if (href === `${base}/toolkit`) {
      return pathname === `${base}/toolkit` || pathname.startsWith(`${base}/toolkit/`);
    }
    if (href === `${base}/social`) {
      return pathname === `${base}/social` || pathname.startsWith(`${base}/social?`);
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="mb-8 flex flex-wrap gap-2 border-b border-stone-200 pb-3 text-sm">
      {items.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              active ? "bg-emerald-800 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
