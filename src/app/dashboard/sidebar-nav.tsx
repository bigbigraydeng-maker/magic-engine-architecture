'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Overview', emoji: '🏠', exact: true },
  // ── Step 1: Client Info ──
  { href: '/dashboard/clients', label: 'Clients', emoji: '👥', exact: false },
  // ── Step 2: Generate Content ──
  { href: '/dashboard/content', label: 'Content', emoji: '📝', exact: false },
  { href: '/dashboard/visuals', label: 'Launch Hub', emoji: '🚀', exact: false },
  // ── AI Intelligence ──
  { href: '/dashboard/ai-visibility', label: 'AI Visibility', emoji: '🤖', exact: false },
  { href: '/dashboard/geo-composer', label: 'GEO Composer', emoji: '🌐', exact: false },
  // ── Reporting ──
  { href: '/dashboard/reports', label: 'Reports', emoji: '📊', exact: false },
  // ── Admin ──
  { href: '/dashboard/admin/billing-monitor', label: 'Billing Monitor', emoji: '💳', exact: false },
]

export default function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {navItems.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + '/')
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
        )
      })}
    </nav>
  )
}
