/**
 * Shared fixtures for crawler.test.ts's split-out suite files
 * (crawler-parsing / crawler-discovery / crawler-jina-fallback / crawler-crawling).
 *
 * Mechanical split (Codex review on PR #963, P1): the single crawler.test.ts
 * file exceeded the repo's 800-line-per-file cap. This module holds only the
 * fixture XML/HTML/markdown strings and the two Response-building helpers —
 * no test logic. See crawler-test-files.ts for the fixed manifest of split
 * files and the reverse-discovery guard that keeps this list honest.
 */

export const SITEMAP_XML_10_URLS = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page-1</loc></url>
  <url><loc>https://example.com/page-2</loc></url>
  <url><loc>https://example.com/page-3</loc></url>
  <url><loc>https://example.com/page-4</loc></url>
  <url><loc>https://example.com/page-5</loc></url>
  <url><loc>https://example.com/page-6</loc></url>
  <url><loc>https://example.com/page-7</loc></url>
  <url><loc>https://example.com/page-8</loc></url>
  <url><loc>https://example.com/page-9</loc></url>
  <url><loc>https://example.com/page-10</loc></url>
</urlset>`

export const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`

export const SITEMAP_POSTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/post-1</loc></url>
  <url><loc>https://example.com/post-2</loc></url>
  <url><loc>https://example.com/post-3</loc></url>
</urlset>`

export const SITEMAP_PAGES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
  <url><loc>https://example.com/services</loc></url>
</urlset>`

export const ROBOTS_TXT_WITH_SITEMAP = `User-agent: *
Allow: /

Sitemap: https://example.com/custom-sitemap.xml`

export const CUSTOM_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/custom-1</loc></url>
  <url><loc>https://example.com/custom-2</loc></url>
  <url><loc>https://example.com/custom-3</loc></url>
</urlset>`

export const ROBOTS_TXT_BLOCKING_ALL = `User-agent: *
Disallow: /`

export const ROBOTS_TXT_EMPTY = `User-agent: *
Allow: /`

export const HOMEPAGE_HTML_WITH_LINKS = `<!DOCTYPE html>
<html>
<head><title>Example Site</title></head>
<body>
  <a href="/page-a">Page A</a>
  <a href="/page-b">Page B</a>
  <a href="https://example.com/page-c">Page C</a>
  <a href="/page-d">Page D</a>
  <a href="https://example.com/page-e">Page E</a>
  <a href="https://other-domain.com/external">External link</a>
  <a href="https://cdn.example.com/asset">Subdomain link (filtered)</a>
  <a href="mailto:info@example.com">Email (filtered)</a>
</body>
</html>`

export const MARKDOWN_WITH_H1 = `# My Amazing Page Title

Some content here.`

export const MARKDOWN_WITH_TITLE_TAG = `<title>HTML Title Tag Page</title>

Some content without H1.`

export const MARKDOWN_NO_TITLE = `Just some plain text content without any heading.`

// ---------------------------------------------------------------------------
// Helper: build a fetch mock response
// ---------------------------------------------------------------------------

export function mockResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export function mockNotFound(): Response {
  return new Response('Not Found', { status: 404 })
}
