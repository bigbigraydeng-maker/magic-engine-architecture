/**
 * GEO Composer — snippet builder.
 *
 * Wraps the HTML block with platform-specific installation instructions,
 * producing a ready-to-share Copy-Paste guide for the client.
 *
 * Reference: ROADMAP.md P7.2.4, ARCHITECTURE.md §11.7
 */

export type SnippetPlatform = 'generic' | 'wordpress' | 'webflow'

export interface InstallSnippet {
  platform: SnippetPlatform
  html: string
  instructions: string[]
}

/**
 * Build installation snippets for all supported platforms.
 */
export function buildSnippets(html: string): InstallSnippet[] {
  return [
    buildGeneric(html),
    buildWordPress(html),
    buildWebflow(html),
  ]
}

/**
 * Generic HTML snippet — works on any website.
 */
function buildGeneric(html: string): InstallSnippet {
  return {
    platform: 'generic',
    html,
    instructions: [
      'Copy the HTML block below.',
      'Paste it inside the <body> tag of your page — ideally near the top, before </body>.',
      'Publish the page. AI crawlers will read it on their next visit.',
      'Repeat for each page you want to optimise (homepage, service pages, blog posts).',
    ],
  }
}

/**
 * WordPress-specific installation guide.
 */
function buildWordPress(html: string): InstallSnippet {
  return {
    platform: 'wordpress',
    html,
    instructions: [
      'In WordPress Admin, go to Appearance → Theme Editor (or use a Code Snippet plugin).',
      'To add to ALL pages: edit your theme\'s footer.php and paste before </body>.',
      'To add to a SINGLE page: edit the page in the Block Editor → add a "Custom HTML" block → paste the snippet.',
      'Alternatively, install the "Insert Headers and Footers" plugin and paste into the Footer Scripts box.',
      'Save changes and visit the page — view source to confirm the block is present.',
    ],
  }
}

/**
 * Webflow-specific installation guide.
 */
function buildWebflow(html: string): InstallSnippet {
  return {
    platform: 'webflow',
    html,
    instructions: [
      'Open your Webflow project in the Designer.',
      'For SITE-WIDE installation: go to Project Settings → Custom Code → paste into "Footer Code".',
      'For a SINGLE PAGE: select the page → Page Settings → Custom Code → paste into "Before </body> tag".',
      'Publish your site. The snippet will appear in the rendered HTML.',
    ],
  }
}
