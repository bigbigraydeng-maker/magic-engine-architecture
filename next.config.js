/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip Next.js's own TS type-check pass — we run `tsc --noEmit` separately.
  // Needed because @supabase/phoenix ships a malformed .d.ts with an invalid
  // character at line 1, causing the built-in type check to fail even though
  // tsconfig.json has skipLibCheck: true.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warnings from pre-existing <img> tags, etc. should not block deploy.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'localhost:3001'],
    },
  },
};

module.exports = nextConfig;
