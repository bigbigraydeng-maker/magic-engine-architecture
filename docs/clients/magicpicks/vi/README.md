# Handoff: Magic Picks Visual Identity System

## Overview
Complete brand identity for Magic Picks — a new NZ direct-to-consumer home goods brand (trading name of VITOL TRADING LIMITED, NZBN 9429050577675). Covers logo, colour, typography, voice, application mockups, and design tokens. Primary use: implement this VI on the Magic Picks storefront (Shopify Horizon theme) and in paid social ad templates.

## About the Design Files
The bundled `Magic-Picks-Brand-Guidelines.html` is a **design reference built in HTML** — a prototype of the finished guidelines page, not production code to copy verbatim. Recreate the visual language (logo, colours, type, components) in the target codebase's existing environment (Shopify Liquid/theme JS for the storefront, or whatever stack serves the ad-creation tooling), following that codebase's established patterns. The `brand-assets/` SVGs ARE final production assets — use those files directly, don't redraw them.

## Fidelity
**High-fidelity.** Exact hex colours, named typefaces, and finished logo marks are specified below and in the guidelines page. Implement pixel-accurate, not "inspired by."

## Logo System
- **Logomark concept**: a rounded-square frame with one filled circle breaking its top-right corner — "the pick that stood out from the set." Deliberately not initials, not a chair, not a NZ map, not a shopping bag.
- **Primary lockup** (`logo-horizontal.svg`, 480×128 viewBox): mark + "Magic Picks" wordmark in Noto Serif 500, colour `#1F3B4D`.
- **Reverse lockup** (`logo-horizontal-reverse.svg`): same geometry, cream `#FBF6EF` stroke/text, clay-tint `#DE8B68` circle — for dark video overlays and coloured backgrounds.
- **Logomark alone**: `logomark.svg` (light), `logomark-reverse.svg` (dark), 64×64 viewBox.
- **Favicon**: `favicon.svg`, 32×32, simplified stroke weight for tiny render.

## Colour
| Token | Hex | Use |
|---|---|---|
| Primary — Harbour Ink | `#1F3B4D` | headlines, nav, primary buttons, logo |
| Primary dark | `#142A36` | hover/pressed state of primary |
| Primary tint | `#DCE6E8` | soft background fills |
| Secondary — Warm Clay | `#C15B3A` | CTAs, price badges, the mark's circle |
| Secondary tint | `#F3DDD2` | soft background fills |
| Accent — Twilight Mauve | `#8C5B6B` | small highlights/tags, used sparingly |
| Accent tint | `#EADDE1` | soft background fills |
| Background | `#FBF6EF` | page background |
| Surface | `#FFFFFF` | cards |
| Border | `#E7DDD0` | hairlines |
| Text primary | `#241F1B` | body copy |
| Text secondary | `#6E6459` | captions, meta |
| Sale | `#B8542E` | sale badges |
| Success | `#3F7A52` | confirmations |
| Warning | `#C08A3D` | warnings |
| Error | `#9C3B32` | errors |

Deliberately avoids Golden Ochre (`#C4912E`, the parent Magic Engine brand colour), red, and sage — see guidelines page section 01/03 for full reasoning.

## Typography
- **Display**: Noto Serif, weight 500–600. Headlines, section titles.
- **Body**: Noto Sans, weight 400–600, never below 400. Body copy, UI labels.
- **Signature accent**: Caveat 600 — used only for Jing's signature on the packing insert card, nowhere else.
- Both Noto Serif and Noto Sans carry full CJK coverage for future bilingual pages. Google Fonts CDN: `family=Noto+Serif:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&family=Caveat:wght@600`.
- Type scale: 64/600 headline, 32/600 section title, 18/500 subhead/price, 16/400 body, 13/400 caption.

## Voice & Tone
Direct, honest, quietly confident — "the friend who already did the research," never "shop now / sale / free shipping" hype language. See the guidelines page section 05 for the five example headlines plus one Chinese-language variant.

## Application Patterns (see guidelines page section 06)
- FB/IG ad thumbnails (1:1 and 4:5): dark product-photo field, mark + wordmark top-left, headline + price pill bottom-left.
- Mobile product hero (375 width): sticky-style header with mark, full-bleed product image, price in Warm Clay, primary-colour CTA button, one-line trust copy.
- Order confirmation email: Harbour Ink header band with reverse mark, white body.
- Packing insert card: white card, mark top, short thank-you line, Jing's signature in Caveat.

## Design Tokens
Both blocks are also embedded copy-ready in the guidelines page (section 07) with a one-click copy button.

```css
:root {
  --color-primary: #1F3B4D;
  --color-primary-dark: #142A36;
  --color-primary-tint: #DCE6E8;
  --color-secondary: #C15B3A;
  --color-secondary-tint: #F3DDD2;
  --color-accent: #8C5B6B;
  --color-accent-tint: #EADDE1;
  --color-bg: #FBF6EF;
  --color-surface: #FFFFFF;
  --color-border: #E7DDD0;
  --color-text-primary: #241F1B;
  --color-text-secondary: #6E6459;
  --color-sale: #B8542E;
  --color-success: #3F7A52;
  --color-warning: #C08A3D;
  --color-error: #9C3B32;
  --font-display: 'Noto Serif', serif;
  --font-body: 'Noto Sans', sans-serif;
  --font-signature: 'Caveat', cursive;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --space-1: 8px; --space-2: 16px; --space-3: 24px; --space-4: 32px; --space-5: 48px; --space-6: 64px;
}
```

JSON equivalent is in `tokens.json` in this folder.

## Assets
- `brand-assets/logo-horizontal.svg` — primary lockup
- `brand-assets/logo-horizontal-reverse.svg` — reverse lockup (dark/video)
- `brand-assets/logomark.svg` — mark only
- `brand-assets/logomark-reverse.svg` — mark only, reverse
- `brand-assets/favicon.svg` — 32×32 favicon
All original, geometric (rect + circle + text), created for this brand — no third-party or borrowed assets.

## Files
- `Magic Picks Brand Guidelines.dc.html` — full interactive guidelines reference (open in the Claude design tool that produced it; view as documentation, not a file to serve as-is)
- `brand-assets/` — the five SVG files above
- `tokens.json` — design tokens as JSON
