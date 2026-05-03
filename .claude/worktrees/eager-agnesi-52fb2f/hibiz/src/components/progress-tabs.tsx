"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  href: string;
  label: string;
}

const TABS: TabDef[] = [
  { href: "/progress", label: "任务进度" },
  { href: "/progress/roadmap", label: "版本路线图" },
  { href: "/progress/architecture", label: "文件架构" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/progress") {
    return pathname === "/progress" || pathname === "/progress/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProgressTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="border-b border-stone-200 bg-white" aria-label="看板分区">
      <div className="mx-auto flex max-w-3xl flex-wrap gap-x-1 gap-y-0 px-2 sm:gap-x-0 sm:px-4">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative min-h-[44px] flex-1 basis-[30%] px-2 py-3 text-center text-sm font-medium transition-colors sm:flex-none sm:basis-auto sm:px-4 ${
                active
                  ? "text-emerald-900 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-emerald-600 sm:after:left-4 sm:after:right-4"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
