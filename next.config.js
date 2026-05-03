/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip Next.js's own TS type-check pass — we run `tsc --noEmit` separately.
  // Needed because @supabase/phoenix ships a malformed .d.ts with an 