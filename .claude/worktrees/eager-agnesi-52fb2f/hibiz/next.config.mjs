/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      /** NL 社媒：多图 + 表单 */
      bodySizeLimit: "15mb",
    },
  },
  // Helps some Windows builds; if vendor-chunks errors persist: npm run clean && npm run dev
  transpilePackages: [
    "@supabase/supabase-js",
    "@supabase/ssr",
    "@builder.io/sdk-react-nextjs",
  ],
};

export default nextConfig;
