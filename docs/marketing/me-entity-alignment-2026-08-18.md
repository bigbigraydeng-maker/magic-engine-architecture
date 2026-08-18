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
- No changes to `website/robots.txt`, `website/sitemap.xml`, `website/app.js`, `website/google-tag.js`, `website/meta-pixel.js`, `scripts/**`.
- **Revised 2026-08-19 (round 2)**: `src/**` IS now in scope — see §9. The round-1 scan was limited to `website/**` and therefore missed the Next.js app's own public entity pages, which carried the same wrong facts.

## 9. Round 2 (2026-08-19) — app-layer entity surfaces + main refresh

Round 1 (commit `ed098cf9`) scanned and fixed **`website/**` only**. A whole-repo scan in round 2 found the
Next.js app serves its own public entity pages that round 1 never touched, still claiming the old facts.

### 9.1 Branch refreshed onto latest main

`git merge origin/main` (no rebase, per repo git rules). Main tip `1d66c7f3`; #1055 merge `330e4a5e` confirmed as
an ancestor of main before any work started. Merge was clean — **0 conflicts**. Main had touched none of the
`website/**` HTML in between; its only overlap with this branch's file set was `CLAUDE.md`, `docs/ROADMAP.md`
and `website/google-tag.js` (the last is #1055 territory and remains untouched here).

### 9.2 Public app pages corrected

| File | Wrong claim (before) | Now |
|---|---|---|
| `src/app/about/page.tsx` | `Magic Lab — operator of Magic Engine`; `98 Beatrice Terrace, Ascot, Brisbane, Queensland, Australia`; footer `© Magic Lab` | `Magic Engine AI Technology Limited — operator of Magic Engine`; `New Zealand`; footer `© Magic Engine AI Technology Limited` |
| `src/app/contact/page.tsx` | Brisbane street address; footer `© Magic Lab` | `New Zealand`; footer entity corrected |
| `src/app/privacy/page.tsx` | Contact block `Magic Lab` + Brisbane street address | Entity name + `New Zealand`; **`LEGAL REVIEW REQUIRED BEFORE MERGE` marker added at file head** |
| `src/app/terms/page.tsx` | `operated by Magic Lab`, `owned by Magic Lab`, `Magic Lab shall not be liable` (3 occurrences) | Entity name in all 3; **`LEGAL REVIEW REQUIRED BEFORE MERGE` marker added at file head** |
| `src/app/layout.tsx` | `authors` / `creator` / `publisher` metadata all `Magic Lab` — emitted on **every** app page | All three now `Magic Engine AI Technology Limited` |
| `src/app/authorisation/page.tsx` | `Magic Engine is built and operated by Magic Lab, which is the name you will see on invoices…`; footer `© Magic Lab` | Entity name in both. This is the platform-facing authorisation/anti-phishing disclosure — the invoice name it promises must match the real operating entity |
| `src/app/page.tsx` | Homepage footer `© Magic Lab. All rights reserved.` | `© Magic Engine AI Technology Limited. All rights reserved.` |
| `README.md` | `Magic Lab 2026 旗舰产品` in the repo subtitle | Subtitle de-parented; Magic Lab explicitly marked `proposed_future_holding_brand, unregistered, not current legal parent` |

`src/app/terms/page.tsx` §9 Governing Law (`the laws of New South Wales, Australia`) is **deliberately untouched** —
an NZ-incorporated operator with an NSW governing-law clause is exactly the kind of question this PR is not
allowed to answer. It is a **legal blocker**, listed in §9.5.

### 9.3 Canonical internal marker normalised

The exact machine-readable label `proposed_future_holding_brand, unregistered, not current legal parent` now appears in
`CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md` — round 1 had the meaning in prose
but not one consistent greppable token.

### 9.4 `Magic Lab` occurrences deliberately RETAINED (not entity claims)

Left alone on purpose; flagged here so a future scan does not read silence as an oversight:

- `src/app/unauthorized/page.tsx`, `src/components/auth/FeatureLockGate.tsx`, `src/lib/auth/client-access.ts`,
  `src/lib/mtc/charge.ts`, `src/lib/messaging/adapters/messenger.ts`, `src/app/api/**` error strings — internal
  support/team copy shown to authenticated users ("contact the Magic Lab team"), not a legal-entity or ownership claim.
- `public/decks/magic-lab-class-membership/**` — Magic Lab Class is a separate brand/product surface, out of scope for
  the Magic Engine entity layer.
- `src/lib/diagnostic/scheduled-run.ts` + tests, `supabase/migrations/**` — `Magic Lab` there is a **client record name**
  in the database. Factual; renaming it would corrupt data references.
- `website/**` "Brisbane" hits — customer testimonials (`Café owner · Brisbane QLD`) and ads-targeting copy
  (`Auckland + Brisbane Chinese market`, `areaServed` on `cn/ads.html`). Market/service-area facts, not the entity address.

### 9.5 Legal blockers (unchanged + newly surfaced)

Must be answered by counsel before ANY of the Terms/Privacy files merge:

1. Governing law + jurisdiction — `website/terms.html`, `website/cn/terms.html` **and now `src/app/terms/page.tsx`
   (currently New South Wales, Australia, against an NZ operating entity)**.
2. NZ Privacy Act 2020 vs Australian Privacy Principles applicability boundary (both website and `src/app/privacy/page.tsx`).
3. Australian Consumer Law reference.
4. Cross-border data disclosure.
5. NZ Company Number / NZBN public display requirement (nothing displayed today).
6. Contract migration effect on customer agreements signed under the previous operating entity.
7. Whether the previous operating entity must remain named anywhere for continuity of existing contracts.

### 9.6 CN canonical description — RESOLVED by PM 2026-08-19 (option a)

PM froze the CN canonical description and chose option (a), a translation:

> Magic Engine 帮助澳大利亚和新西兰的英语及中文团队，在一个平台中提升 SEO、GEO、培训和可上线的执行能力，把诊断转化为清晰可见的实际工作。

Applied in two places, **this sentence only** — no other CN positioning copy was written, extended or rewritten:

- `website/cn/about.html` — new `<p class="lead">` directly under `<h1>关于 Magic Engine</h1>`, mirroring the EN page's structure. The page carries no `data-en`/`data-zh` attributes anywhere, so the paragraph is plain text in the page's own convention.
- `website/about.html` — the lead paragraph's `data-zh` attribute previously held the EN string as an explicitly temporary placeholder (§7). It now holds the frozen CN string. `data-en` and the rendered EN body text are unchanged.

**Semantic equivalence check** (EN → CN, clause by clause):

| EN clause | CN clause | Equivalent |
|---|---|---|
| helps | 帮助 | ✅ |
| English- and Chinese-speaking teams | 英语及中文团队 | ✅ |
| across Australia and New Zealand | 澳大利亚和新西兰的 | ✅ |
| improve SEO, GEO, training, and launch-ready execution | 提升 SEO、GEO、培训和可上线的执行能力 | ✅ |
| in one place | 在一个平台中 | ✅ meaning preserved; CN says "platform" where EN says "place" — slightly more specific, still the same claim |
| turning diagnosis into visible work | 把诊断转化为清晰可见的实际工作 | ✅ meaning preserved; CN adds "清晰/实际" (clear/actual) as natural Chinese emphasis |

No claim exists in one language and not the other. Both strings are PM-frozen; the two nuances above are recorded, not edited.

**Still untranslated on `website/cn/about.html` (pre-existing, out of scope)**: the "Who we are" / "Our name" body paragraphs are still English on the CN page. That predates this PR and is positioning copy, so it is left alone.

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
