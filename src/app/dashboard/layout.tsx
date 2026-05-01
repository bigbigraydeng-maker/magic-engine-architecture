'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  {
    href: '/dashboard',
    label: 'Overview',
    emoji: '🏠',
    exact: true,
  },
  {
    href: '/dashboard/clients',
    label: 'Clients',
    emoji: '👥',
    exact: false,
  },
  {
    href: '/dashboard/content',
    label: 'Content',
    emoji: '📝',
    exact: false,
  },
  {
    href: '/dashboard/keywords',
    label: 'Keywords',
    emoji: '🔑',
    exact: false,
  },
  {
    href: '/dashboard/visuals',
    label: 'Launch Hub',
    emoji: '🚀',
    exact: false,
  },
  {
    href: '/dashboard/airtable',
    label: 'Airtable Views',
    emoji: '📊',
    exact: false,
  },
  {
    href: '/dashboard/link-intelligence',
    label: 'Link Intelligence',
    emoji: '🔗',
    exact: false,
  },
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <h1 className="text-lg font-bold text-white">Magic Engine</h1>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-7">Admin Dashboard</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <span className="text-base">{item.emoji}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-600">Phase 5 · Internal Use</p>
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
