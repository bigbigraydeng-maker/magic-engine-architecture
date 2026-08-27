Paste the message below into Claude Code, in the root of the Magic Picks website repo, with this folder attached/uploaded alongside it.

---

Implement the Magic Picks visual identity across this site using the attached `design_handoff_magic_picks_vi/` package.

Read `README.md` in that folder first — it has exact hex values, type specs, and asset descriptions. `Magic Picks Brand Guidelines.dc.html` is a design reference only (don't serve it as-is); `brand-assets/*.svg` are final production logo/favicon files — use them directly. `tokens.json` mirrors the CSS variables in the README.

Do this:
1. Add the design tokens (colours, fonts, radii, spacing from the README's CSS block) as CSS custom properties in this codebase's existing theme/settings mechanism (e.g. Shopify `settings_data.json` + theme CSS, or this repo's own token file — follow whatever convention already exists here).
2. Load Noto Serif + Noto Sans (+ Caveat, signature use only) from Google Fonts, replacing any current brand fonts.
3. Swap in the logo files from `brand-assets/` — horizontal lockup in the header, logomark in the favicon slot, reverse lockup wherever there's a dark background or video overlay.
4. Re-skin primary buttons, headings, and body text to the new palette/type per the token mapping (primary = Harbour Ink `#1F3B4D`, secondary/CTA = Warm Clay `#C15B3A`, accent = Twilight Mauve `#8C5B6B`, warm cream background `#FBF6EF`).
5. Rebuild the product page hero, order confirmation email header, and any FB/IG ad-creation templates to match the mockups described in the README's "Application Patterns" section.
6. Update sale/success/warning/error badge colours to the semantic tokens.
7. Do NOT copy any markup or inline styles verbatim from the `.dc.html` reference — recreate the same visual result using this codebase's existing component patterns, framework, and file structure.

Flag anything in the README you can't fully match to this codebase's structure instead of guessing.
