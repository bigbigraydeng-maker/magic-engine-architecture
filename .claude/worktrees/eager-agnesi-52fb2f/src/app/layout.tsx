import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Magic Lab | AI Marketing Infrastructure',
  description: 'We build fast websites, SEO systems and AI-powered marketing tools that bring you customers.',
  keywords: ['AI marketing', 'website development', 'SEO optimization', 'GEO optimization', 'New Zealand'],
  authors: [{ name: 'Magic Lab' }],
  openGraph: {
    title: 'Magic Lab | AI Marketing Infrastructure',
    description: 'We build fast websites, SEO systems and AI-powered marketing tools that bring you customers.',
    url: 'https://magiclab.nz',
    siteName: 'Magic Lab',
    images: [
      {
        url: 'https://magiclab.nz/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Magic Lab',
      },
    ],
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}