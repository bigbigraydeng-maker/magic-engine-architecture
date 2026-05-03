import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HiBiz — AI microsites & lead forms for NZ businesses",
  description:
    "Describe your page in one sentence. HiBiz generates a mobile-friendly landing page and lead form for New Zealand real estate and immigration consultants.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${fraunces.variable} min-h-screen bg-stone-50 font-sans text-stone-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
