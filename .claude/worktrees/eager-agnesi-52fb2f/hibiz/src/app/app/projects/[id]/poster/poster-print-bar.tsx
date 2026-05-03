"use client";

export function PosterPrintBar() {
  return (
    <div className="poster-no-print mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
      >
        Print / Save as PDF
      </button>
      <p className="text-xs text-stone-500">Use the browser print dialog — choose “Save as PDF” if you prefer a file.</p>
    </div>
  );
}
