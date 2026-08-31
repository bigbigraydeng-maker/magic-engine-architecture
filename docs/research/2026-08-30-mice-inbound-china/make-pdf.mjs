// Wrap the artifact HTML fragment into a print-ready document with Magic Engine
// watermarking, then render to PDF via headless Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const [srcArg, outArg, docTitle] = process.argv.slice(2);
const srcPath = path.resolve(srcArg);
const outPath = path.resolve(outArg);
const fragment = fs.readFileSync(srcPath, 'utf8');

// The fragment carries its own <title> and <link>/<style>; keep them, add print layer.
const PRINT_LAYER = `
<style id="pdf-print-layer">
  /* PDF is a fixed artefact: pin the light palette so it never renders dark. */
  :root, :root[data-theme="dark"] {
    --ground: #FFFFFF !important;
    --surface: #FFFFFF !important;
    --surface-2: #EEF1F5 !important;
    --line: #C9D2DB !important;
    --line-soft: #E1E7ED !important;
    --ink: #171D25 !important;
    --ink-2: #3A4550 !important;
    --ink-3: #5F6975 !important;
    --steel: #275670 !important;
    --steel-soft: #E6EDF2 !important;
    --copper: #99532A !important;
    --copper-soft: #F8EBE3 !important;
    --good: #2A6248 !important;
    --good-soft: #E4F0E9 !important;
    --warn: #7C5E17 !important;
    --warn-soft: #F6F0DE !important;
    --shadow: none !important;
  }

  @page {
    size: A4;
    margin: 15mm 13mm 16mm 13mm;
  }

  html, body { background: #FFFFFF !important; }
  body { font-size: 10.6pt; line-height: 1.62; }
  .wrap { max-width: none; padding: 0 !important; }

  /* Sticky nav is meaningless on paper. */
  .tocnav { display: none !important; }

  .masthead { padding-top: 0 !important; }
  .eyebrow { font-size: 8.2pt !important; gap: 4px 10px !important; }
  h1 { font-size: 27pt !important; }
  h2 { font-size: 15pt !important; }
  h3 { font-size: 11.4pt !important; }
  .standfirst { font-size: 11pt !important; }
  p, li, td, th { font-size: 10.4pt !important; }
  .caption, .stat-s, .roster-note, .tag, .pill, .sec-eyebrow, .note-t { font-size: 8.4pt !important; }
  thead th { font-size: 8pt !important; }
  .stat-v { font-size: 17pt !important; }
  footer .fine { font-size: 8pt !important; }

  section { margin-bottom: 26px !important; }
  h2, h3 { break-after: avoid-page; }
  .sec-head { break-after: avoid-page; }
  .tablewrap, .note, .card, .roster, .stats, .quote, .mono-list, .bars { break-inside: avoid; }
  .roster-row, .bar-row, tr { break-inside: avoid; }
  table { min-width: 0 !important; }
  .tablewrap { overflow: visible !important; }

  a { color: var(--steel) !important; text-decoration: none; }

  /* ---- watermark: repeats on every printed page ---- */
  #me-watermark {
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #me-watermark span {
    font-family: "Archivo", ui-sans-serif, sans-serif;
    font-weight: 700;
    font-size: 52pt;
    letter-spacing: -.03em;
    color: #C4912E;
    opacity: .06;
    transform: rotate(-30deg);
    transform-origin: center center;
    white-space: nowrap;
  }
  #me-stamp {
    position: fixed;
    left: 0; bottom: 0;
    z-index: 9998;
    pointer-events: none;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 7.4pt;
    letter-spacing: .1em;
    color: #C4912E;
    opacity: .5;
  }
  #me-stamp b { color: #171D25; opacity: .45; font-weight: 700; }

  @media screen {
    #me-watermark, #me-stamp { display: none; }
  }
</style>
<div id="me-watermark" aria-hidden="true"><span>Magic Engine</span></div>
<div id="me-stamp" aria-hidden="true"><b>MAGIC ENGINE</b> · 自主研究 · 2026-08-30 · 全部基于公开信息</div>
`;

const doc = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="author" content="Magic Engine">
<meta name="description" content="${docTitle}">
${fragment.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? `<title>${docTitle}</title>`}
</head>
<body>
${fragment.replace(/<title>[\s\S]*?<\/title>/, '')}
${PRINT_LAYER}
</body>
</html>`;

// ASCII-only temp filename: a CJK path breaks the file:// URL Chrome is handed.
const tmpHtml = path.join(path.dirname(outPath), '_print_source.html');
fs.writeFileSync(tmpHtml, doc);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=25000',
  `--print-to-pdf=${outPath}`,
  pathToFileURL(tmpHtml).href,
], { stdio: 'pipe' });

const size = fs.statSync(outPath).size;
console.log(`PDF written: ${outPath}`);
console.log(`size: ${(size / 1024).toFixed(0)} KB`);
