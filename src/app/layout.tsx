import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Magic Engine',
  description: 'AI-powered SEO, Social, Ads & GEO execution platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
