import type { ReactNode } from "react";
import { ProgressTabs } from "@/components/progress-tabs";

interface ProgressLayoutProps {
  children: ReactNode;
}

export default function ProgressLayout({ children }: ProgressLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f4f0ea] text-stone-900">
      <header
        className="border-b border-stone-200/80 px-4 py-10 text-white sm:py-14"
        style={{
          backgroundImage: "linear-gradient(135deg, #1c1917 0%, #14532d 48%, #0f172a 100%)",
        }}
      >
        <div className="mx-auto max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300/90 sm:text-xs">
            HiBiz · internal
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:mt-3 sm:text-4xl md:text-5xl">
            项目看板
          </h1>
        </div>
      </header>

      <ProgressTabs />

      {children}
    </div>
  );
}
