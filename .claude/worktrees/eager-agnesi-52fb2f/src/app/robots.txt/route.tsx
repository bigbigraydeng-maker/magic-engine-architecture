export async function GET() {
  const robots = `User-agent: *
Allow: /

Sitemap: https://magiclab.nz/sitemap.xml`;

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}