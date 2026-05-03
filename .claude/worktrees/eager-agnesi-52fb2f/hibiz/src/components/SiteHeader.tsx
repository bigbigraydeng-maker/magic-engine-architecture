import Link from "next/link";

export interface SiteHeaderProps {
  email?: string | null;
}

export function SiteHeader({ email }: SiteHeaderProps) {
  return (
    <header className="border-b border-stone-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight text-emerald-900">
          HiBiz
        </Link>
        <nav className="flex items-center gap-4 text-sm text-stone-600">
          <span className="text-xs uppercase tracking-wider text-stone-400">Magic Lab</span>
          {email ? (
            <>
              <Link href="/app/projects" className="hover:text-emerald-800">
                Projects
              </Link>
              <span className="max-w-[12rem] truncate text-stone-500">{email}</span>
            </>
          ) : (
            <Link href="/login" className="font-medium text-emerald-800 hover:text-emerald-950">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
