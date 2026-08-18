# Magic Engine — Entity Definition v1 factual alignment (for #1049)

**Scope**: mechanical alignment of public-facing entity claims to #1049 Entity Definition v1. **No SEO / positioning / measurement / connector / deployment work.**

**Companion PRs**: #1043 (T0 main receipt · Draft) · #1051 (GEO 18/18 · Draft) · #1055 (measurement wiring · Draft, other window) · #1056 (Phase 1B tech SEO · Draft).

**Parent**: #1041 T0 Freeze Gate · **Source of truth**: #1049 Entity Definition v1 (frozen 2026-08-18 by PM).

---

## 1. Frozen facts from #1049 (source of truth for this PR)

| Field | Value |
|---|---|
| Public brand | Magic Engine |
| Product type | digital marketing product |
| Legal entity | Magic Engine AI Technology Limited |
| Jurisdiction | New Zealand |
| Public address | **not public** |
| Founder | Ray Deng |
| Founder title | Founder |
| Primary market | Australia + New Zealand |
| Canonical description | "Magic Engine helps English- and Chinese-speaking teams across Australia and New Zealand improve SEO, GEO, training, and launch-ready execution in one place—turning diagnosis into visible work." |
| Magic Lab | `proposed_future_holding_brand` — **not registered**, **not currently the legal parent/owner**; do not claim otherwise in public |

## 2. Overlap with #1056 (exact)

| File | #1056 change | This PR change | Line conflict? | Coordination |
|---|---|---|---|---|
| `website/about.html` | Adds `<script type="application/ld+json">` block in `<head>` (~L17) with `Organization: {name,url,email,areaServed}` | Body: replaces 3-line entity block with new entity line; adds a lead `<p>` carrying the frozen canonical description below `<h1>` | ❌ different lines / different sections | Whichever merges second **rebases** and keeps the `Organization` JSON-LD as the union: `{name, legalName, url, email, founder, areaServed}` (from this PR) rather than #1056's smaller set. |
| `website/cn/about.html` | Adds hreflang `x-default` in `<head>` | Body: entity-block replaced | ❌ different lines | Trivial rebase |
| `website/discover.html`, `website/features.html` | Head: hreflang + JSON-LD block | Footer entity line replaced | ❌ different sections | Trivial rebase |
| `website/cn/discover.html`, `website/cn/features.html` | Head: hreflang | Footer entity line replaced | ❌ different sections | Trivial rebase |
| `website/sitemap.xml` | lastmod updates on 4 URLs | untouched | ❌ | none |

**Recommended merge order**: Entity Alignment PR → #1056 (rebase). Reason: entity facts must precede any technical SEO work that would otherwise ship with the wrong footer/JSON-LD to production. Both PRs remain Draft until PM confirms.

**Entity Alignment PR explicitly does not touch**: `#1055` branch, `website/google-tag.js`, `scripts/phase1a/**`, any GA4/GSC/measurement/snapshot/connector code path, any `docs/marketing/me-phase1a-*` doc.

## 3. Public-facing changes (allowed by PM directive)

### 3.1 Homepage header + footer + JSON-LD (`website/index.html`)

- **Removed** `<span class="me-sub">by Magic Lab / 由 Magic Lab 出品</span>` under the logo (was line 55).
- **Removed** `"parentOrganization": { "@type": "Organization", "name": "Magic Lab" }` from the `Organization` JSON-LD.
- **Added** to the `Organization` JSON-LD (top-level fields only, no `address`, no `foundingLocation`):
  - `"legalName": "Magic Engine AI Technology Limited"`
  - `"founder": { "@type": "Person", "name": "Ray Deng", "jobTitle": "Founder" }`
  - `"email": "raydeng@magicengine.com.au"` (previously only in `contactPoint.email`; hoisting matches Schema.org Organization pattern)
- Footer `© 2026 Magic Engine by Magic Lab · Australia & New Zealand` → `© 2026 Magic Engine AI Technology Limited · Australia & New Zealand` (via bulk sed across 6 EN + 1 CN pages).

### 3.2 Footer entity line — all pages (single-line bulk replace)

All footer occurrences of `ABC Plus Home Pty Limited · ABN 45 674 442 445 · 98 Beatrice Ave, Ascot, Brisbane QLD 4007, Australia · raydeng@magicengine.com.au` → `Magic Engine AI Technology Limited · New Zealand · raydeng@magicengine.com.au`.

Applied across EN pages (`ai-search.html`, `ai-training.html`, `terms.html`, `privacy.html`, `about.html`, `geo.html`, `index.html`, `ai-search-faq.html`, `ai-marketing-smes.html`, `training.html`, `ads.html`, `features.html`, `discover.html`, `ai-search-snippets.html`, `cn.html`) and CN pages (`cn/about.html`, `cn/ads.html`, `cn/ai-automation.html`, `cn/ai-search-faq.html`, `cn/ai-marketing-smes.html`, `cn/ai-search-snippets.html`, `cn/ai-training.html`, `cn/ai-search.html`, `cn/discover.html`, `cn/index.html`, `cn/features.html`, `cn/geo.html`, `cn/training.html`, `cn/privacy.html`, `cn/terms.html`).

### 3.3 About page body — canonical description added

`website/about.html`: a new `<p class="lead">` inserted directly under the `<h1>About Magic Engine</h1>` carrying the frozen #1049 canonical description verbatim. Existing "Who we are" copy at L72-77 is **untouched** (PM §B.9: "不要顺带重写其他 positioning").

`website/cn/about.html`: **CN canonical text NOT added in this PR** — PM's #1049 froze the EN string; translating it to CN would be an act of positioning language creation. Flagged for PM confirmation before deploy (see PR body checklist).

The `data-zh` attribute on the new EN lead paragraph is temporarily populated with the EN string as a translation placeholder — PM to confirm the CN translation before merge.

### 3.4 About page entity block (about.html + cn/about.html)

3-line block `ABC Plus Home Pty Limited · ABN … <br> 98 Beatrice Ave … <br> raydeng@…` → 3-line block `Magic Engine AI Technology Limited <br> New Zealand <br> raydeng@magicengine.com.au`.

### 3.5 `llms.txt` — Legal entity section appended

```
## Legal entity

Magic Engine is operated by Magic Engine AI Technology Limited, a company registered in New Zealand. Magic Engine serves customers across Australia and New Zealand. Founder: Ray Deng.
```

Consistent with the About page canonical description and the index Organization JSON-LD.

## 4. Terms + Privacy (minimum entity-name diff; legal review required)

`website/terms.html`, `website/cn/terms.html`, `website/privacy.html`, `website/cn/privacy.html`:

- **Only change**: entity name replacement inside body copy: `ABC Plus Home Pty Limited` → `Magic Engine AI Technology Limited` (2 occurrences in each Terms, 1 in each Privacy).
- Entity block in body-footer replaced (per §3.4).
- Public physical address removed.
- **HTML comment marker inserted immediately inside `<head>`**:
  ```html
  <!-- LEGAL REVIEW REQUIRED BEFORE MERGE: operating-entity name updated per #1049 Entity Definition v1 to Magic Engine AI Technology Limited (New Zealand). Governing law, jurisdiction clause, New Zealand Privacy Act 2020 vs Australian Privacy Principles applicability, Australian Consumer Law reference, cross-border data disclosure, and NZ Company Number / NZBN display remain UNTOUCHED and require legal counsel review before this file is merged. See PR body for the exact diff. -->
  ```

**This PR explicitly does not touch, and this PR must not be interpreted as legally reviewing:**
- Governing law
- Jurisdiction clause
- New Zealand Privacy Act 2020 vs Australian Privacy Principles applicability boundary
- Australian Consumer Law reference
- Cross-border data disclosure sections
- NZ Company Number / NZBN display requirements
- Contract migration effect on existing customer agreements
- Terms/Privacy versioning/effective-date semantics

**PR checklist blocker**: these 4 files (EN + CN Terms + Privacy) **must not merge without legal counsel sign-off**. Even if the rest of the PR is approved, these four remain blocked.

## 5. Internal docs alignment (agent-facing facts)

Added Entity clarification callouts / notes at the top of each file, without rewriting historical body copy:

- `CLAUDE.md:12` — project positioning statement now names Magic Engine AI Technology Limited (NZ) as operator; Magic Lab explicitly flagged as `proposed_future_holding_brand`, unregistered, not current legal parent.
- `docs/PRODUCT.md` — new Entity clarification callout in the intro block. Historical "Magic Lab 旗下 / Magic Lab 在 2026 年的旗舰产品 / Magic Lab 团队" wording preserved verbatim (per PM: "不要修改历史 receipt 中的原始事实") but marked as internal-only working name that agents must not use in customer-facing outputs.
- `docs/ARCHITECTURE.md:0` — Entity clarification callout added above §0 战略定位; historical wording preserved.
- `docs/ROADMAP.md` — Entity clarification note added to intro; existing "Magic Lab Academy" and "Magic Lab Class" line-item mentions preserved as `internal working name; not a registered parent entity`.

**No history rewritten**. Existing `docs/history/CHANGELOG.md` and `docs/marketing/me-organic-growth-t0-baseline-*.md` (PR #1043) untouched — those are frozen receipts. Any correction to those goes as an additive clarification, not a rewrite.

## 6. Test results (§E)

| # | Test | Result |
|---|---|---|
| E.1a | `ABC Plus Home Pty Limited` in `website/**` | 0 occurrences (LEGAL REVIEW comment intentionally rewords the reference to keep grep clean) |
| E.1b | `ABN 45 674 442 445` in `website/**` | 0 occurrences |
| E.1c | `Magic Engine by Magic Lab` in `website/**` | 0 occurrences |
| E.1d | `parentOrganization` in `website/**` | 0 occurrences |
| E.1e | Legal-entity Brisbane address (`Beatrice Ave` / `Ascot QLD 4007` / `98 Beatrice`) | 0 occurrences |
| E.1f | `by Magic Lab` / `由 Magic Lab` anywhere in `website/**` | 0 occurrences |
| E.2 | EN + CN pages entity line consistency | Single canonical line: `Magic Engine AI Technology Limited · New Zealand · raydeng@magicengine.com.au` |
| E.3 | JSON-LD blocks parse via `json.loads` | **25/25 valid, 0 failed** |
| E.4 | Any `"address"` field in JSON-LD or `<address>` element on public site | 0 occurrences |
| E.5 | HTML structural sanity (all files parseable by python `html.parser`) | Passed (see §7 note) |
| E.6 | `llms.txt` Legal entity section consistent with About + JSON-LD | Yes — all three name `Magic Engine AI Technology Limited` + `New Zealand` + `Ray Deng · Founder` |
| E.7 | Exact overlap with #1056 | See §2 table — no line conflict, semantic coordination needed on `about.html` Organization JSON-LD union |

Non-Brisbane mentions retained (correctly — these are customer testimonials / market mentions, not legal-entity claims): `Café owner · Brisbane QLD` in customer quotes, `Auckland + Brisbane Chinese market` in ads targeting copy.

## 7. Notes

- All existing static HTML uses `data-en` / `data-zh` for i18n. The new About canonical `<p>` follows the same pattern; `data-zh` is temporarily populated with the EN string as a translation placeholder, subject to PM approval.
- The `website/cn/about.html` body is deliberately not enriched with a translated canonical description — see §3.3.
- No changes to `website/robots.txt`, `website/sitemap.xml`, `website/app.js`, `website/google-tag.js`, `website/meta-pixel.js`, `scripts/**`, `src/**`.

## 8. Actions NOT performed (per PM directive)

- ❌ merge — this PR is Draft
- ❌ deploy to Cloudflare Pages
- ❌ any production data mutation
- ❌ any change to `research/me-phase1a-gsc-ga4-wire` branch (#1055 territory)
- ❌ any change to `website/google-tag.js`, GA4/GSC connector, snapshot pipelines, Reference Loop files
- ❌ any legal review of Terms/Privacy content
- ❌ any claim that Magic Lab is a current legal entity or parent
- ❌ any positioning-language rewrite (existing About "Who we are", Terms/Privacy legal framework — untouched)
- ❌ any change to `docs/history/CHANGELOG.md` or frozen T0 receipts (#1043 doc)
- ❌ any CN translation of the frozen EN canonical description (deferred to PM)
