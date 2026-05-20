'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

interface Props {
  clientId: string
  clientName: string
}

const NAV_ITEMS = (clientId: string) => [
  { href: `/portal/${clientId}`,         label: 'Overview' },
  { href: `/portal/${clientId}/report`,  label: 'Monthly Report' },
  { href: `/portal/${clientId}/content`, label: 'Content' },
]

export default function PortalNav({ clientId, clientName }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    router.push('/portal/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        {/* Brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">✨</span>
          <span className="text-sm font-semibold text-gray-900 hidden sm:block">
            {clientName}
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1 flex-1">
          {NAV_ITEMS(clientId).map(item => {
            const active = item.href === `/portal/${clientId}`
              ? pathname === item.href
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Sign out */}
        <button
          onClick={() => void handleSignOut()}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
