import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CrazyContent - Social Media Content Automation',
  description: 'Automated social media content generation and analytics',
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
