# Roman Hu · 12-Article Content Line · Launch Plan 2026-08-25

This document is the operational outline set for 12 SEO/GEO long-form blog posts publishing on romanhu.com weekly from Wed 2026-08-27 through Wed 2026-11-12. Outlines only — no full drafts. Hard rules in force throughout: no invented statistics (every number is a `[NEEDS DATA: source — query]` placeholder), NZ English spelling, never mention Barfoot & Thompson / Team Hu / Royal Heights, never use "Bayside" or "Central Gold" as audience-facing terms (always name Mission Bay / Kohimarama / St Heliers / Glendowie specifically), all prices NZD, all times NZST/NZDT, school references name actual schools. Author is Roman Hu on every article. English drafts commit to `roman-website/src/pages/blog/<slug>.astro`; Chinese mirrors to `roman-website/src/pages/zh/blog/<slug>.astro` (see judgment-call note below — this path does not exist yet in the repo).

## Repo reality check (read before drafting)

`~/Projects/roman-website/src/pages/blog/` currently contains `index.astro` and `[slug].astro` (a **dynamic Sanity-CMS route**, not per-post `.astro` files) plus one legacy static post `mission-bay-market-2024.astro`. There is **no** `src/pages/zh/blog/` directory yet — the `zh/` tree has no blog section at all. Two implications for whoever implements these 12 articles:
1. New posts most likely need to be created as Sanity CMS entries (consumed by `[slug].astro`) rather than as 12 new static `.astro` files, unless the team has decided to move away from Sanity for this content line.
2. The Chinese mirror route (`/zh/blog/<slug>`) needs to be built before article #1 can ship its ZH version — this is not a content task, it's a routing/CMS task and should be flagged to engineering now, not discovered in week 1.

This is flagged again under "Open questions for PM" below.

---

## 1. How to Sell Your Home in Mission Bay: The 2026 Vendor Guide

- **Slug:** `how-to-sell-your-home-in-mission-bay-2026`
- **EN URL:** https://romanhu.com/blog/how-to-sell-your-home-in-mission-bay-2026
- **ZH URL:** https://romanhu.com/zh/blog/how-to-sell-your-home-in-mission-bay-2026
- **Target word count:** 2,200
- **Publication date:** Wed 2026-08-27
- **Primary keyword:** sell house Mission Bay
- **Secondary keywords:** Mission Bay real estate agent, Mission Bay property market 2026, how to sell a house in Auckland
- **Target LLM queries:**
  1. "How do I sell my house in Mission Bay in 2026?"
  2. "What's the best way to sell a property in Mission Bay Auckland?"
  3. "How much does it cost to sell a house in Mission Bay NZ?"
  4. "Should I sell my Mission Bay home by auction or by negotiation?"
  5. "Who is a good local real estate agent in Mission Bay Auckland?"
- **Meta title (58 chars):** Selling in Mission Bay: The 2026 Vendor Guide | Roman Hu
- **Meta description (148 chars):** A step-by-step 2026 guide to selling your Mission Bay home — pricing, prep, sale method and marketing, from Ray White's Roman Hu.
- **H1:** How to Sell Your Home in Mission Bay: The 2026 Vendor Guide
- **H2 sections:**
  1. Mission Bay's 2026 market snapshot — where prices, demand and buyer profile sit right now, and what's driving them.
  2. Getting appraisal-ready — the property condition, presentation and paperwork checks that shape your first valuation conversation.
  3. Choosing the right sale method — a short comparison of auction, deadline sale and by-negotiation, with a pointer to the full method breakdown (article #12).
  4. Marketing that reaches the right buyers — digital campaign structure, professional photography/video, and the multilingual channel that reaches Auckland's Chinese buyer pool.
  5. Open homes and negotiating offers — cadence, what buyers scrutinise on inspection, and how offers are worked through to unconditional.
  6. Costs and timeline — commission structure, marketing spend, and a realistic week-by-week timeline from listing to settlement.
  7. Why a local specialist changes the outcome — sets up article #6 (specialist value) as the next read.
- **Key data points needed:**
  - `[NEEDS DATA: homes.co.nz — Mission Bay median sale price, most recent quarter 2026]`
  - `[NEEDS DATA: REINZ Auckland Regional Report Aug 2026 — median days on market, Eastern Auckland/Mission Bay]`
  - `[NEEDS DATA: REINZ Auckland Regional Report — auction clearance rate, Auckland region 2026]`
  - `[NEEDS DATA: DataForSEO — monthly search volume for "sell house Mission Bay" and "Mission Bay real estate agent"]`
  - `[NEEDS DATA: GSC — existing romanhu.com ranking position/impressions for "Mission Bay real estate"]`
  - `[NEEDS DATA: REINZ or industry source — typical real estate commission range, Auckland market 2026]`
- **FAQ schema (5 Q&A):**
  1. Q: How long does it typically take to sell a house in Mission Bay? A: Timelines vary with season and price point, but recent Eastern Auckland data gives a realistic guide. `[NEEDS DATA: REINZ Auckland Regional Report — median days on market Mission Bay/Eastern Bays 2026]` Roman sets a listing-to-settlement plan at appraisal so vendors know what to expect before day one.
  2. Q: What is my Mission Bay home worth in 2026? A: Value depends on land size, view, school zone and recent comparable sales — a desktop estimate is a starting point, not a figure to sell on. Book a no-obligation appraisal via [/appraisal] for a comparable-sales-based number.
  3. Q: Does selling before or after school zone enrolment dates affect price? A: Timing around enrolment can matter for zoned buyers — see the full breakdown in the Mission Bay school zones article for how this plays out locally.
  4. Q: Should I choose auction or negotiation for a Mission Bay sale? A: It depends on property type, buyer pool and market conditions at the time — the full comparison is in article #12 of this series.
  5. Q: How much does it cost to sell a house with an agent in Auckland? A: Commission and marketing costs vary by agency and campaign scope. `[NEEDS DATA: REINZ or industry source — typical commission range Auckland 2026]` Roman itemises all costs upfront at the appraisal stage — no surprises at settlement.
- **HowTo schema (6 steps):**
  1. Get a comparable-sales appraisal — establish a realistic price range before marketing begins.
  2. Prepare the property — address presentation, minor repairs and staging priorities.
  3. Choose a sale method — match auction, deadline sale or negotiation to the property and buyer pool.
  4. Launch the marketing campaign — professional photography, video, digital listings and the multilingual buyer channel.
  5. Run open homes and manage enquiry — track buyer interest and qualify serious offers.
  6. Negotiate and settle — work offers through to unconditional and coordinate settlement.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, forward-reference to article #12 (auction vs negotiation) and article #6 (local specialist value) once live.
- **External authority links:** "REINZ Auckland Regional Report" → https://www.reinz.co.nz/auckland-region ; "homes.co.nz Mission Bay suburb report" → https://homes.co.nz
- **Roman's unique angle:** As Ray White Mission Bay's Head of Projects, Roman has direct visibility into new-build and off-plan pricing benchmarks in the same streets — a data point Aaron Foss, Paul Neshausen, Lawrence Yuan and Sarah Liu can't cite from their own listings alone. His trilingual (English/Mandarin/Shanghainese/Cantonese) buyer channel also means Mission Bay vendors get exposure to a Chinese-buyer pool most competing agents can only reach through a translator.
- **Chinese mirror notes:** Do not translate 1:1. ZH audience (largely Chinese vendors selling to a mixed local + Chinese buyer pool) responds better to a credential-first opening (AREINZ, OneRoof Top 18 2025, 9 years local experience) before the process detail. Reframe "school zone" as 学区房 where relevant and note that Chinese vendors often ask about the 交房时间 (settlement timing) and 佣金结构 (commission structure) earlier in the funnel than English readers — pull those FAQ items higher in the ZH version.

---

## 2. Selling Your Home in Kohimarama: 2026 Pricing, Timing & Marketing Guide

- **Slug:** `selling-your-home-in-kohimarama-2026`
- **EN URL:** https://romanhu.com/blog/selling-your-home-in-kohimarama-2026
- **ZH URL:** https://romanhu.com/zh/blog/selling-your-home-in-kohimarama-2026
- **Target word count:** 2,000
- **Publication date:** Wed 2026-09-03
- **Primary keyword:** sell home Kohimarama Auckland
- **Secondary keywords:** Kohimarama property prices 2026, Kohimarama real estate agent, best time to sell Kohimarama
- **Target LLM queries:**
  1. "What's the best time to sell a house in Kohimarama?"
  2. "How much are homes selling for in Kohimarama in 2026?"
  3. "How do I market my Kohimarama property to the right buyers?"
  4. "Is Kohimarama a good suburb to sell in right now?"
  5. "What real estate agent knows Kohimarama best?"
- **Meta title (59 chars):** Selling in Kohimarama: 2026 Pricing & Timing Guide | Roman
- **Meta description (155 chars):** Kohimarama pricing, the best months to list, and a marketing plan built for this suburb's buyer pool — a 2026 vendor guide from Roman Hu.
- **H1:** Selling Your Home in Kohimarama: 2026 Pricing, Timing & Marketing Guide
- **H2 sections:**
  1. Kohimarama's 2026 price picture — current pricing trend by property type (villa, character home, new-build apartment).
  2. Best time of year to list in Kohimarama — seasonal buyer activity and how it differs from neighbouring Mission Bay.
  3. What Kohimarama buyers actually value — beach proximity, Tamaki Drive access, school zone, character-home stock.
  4. Pricing strategy — how comparable sales and appraisal method differ from a generic Auckland-wide estimate.
  5. Marketing your Kohimarama home — channel mix, and how it should differ from a Mission Bay campaign given the more character-home-heavy buyer pool.
  6. Common vendor mistakes in Kohimarama — overpricing against character-home comparables, underinvesting in kerb presentation.
  7. Next step — link to appraisal and to article #1's process guide for vendors who haven't started yet.
- **Key data points needed:**
  - `[NEEDS DATA: homes.co.nz — Kohimarama median sale price, most recent quarter 2026]`
  - `[NEEDS DATA: REINZ Auckland Regional Report — Kohimarama/Eastern Bays seasonal listing volume by month 2025-2026]`
  - `[NEEDS DATA: DataForSEO — search volume "sell home Kohimarama" and "Kohimarama real estate agent"]`
  - `[NEEDS DATA: homes.co.nz — Kohimarama price per m² vs Mission Bay price per m², most recent data]`
  - `[NEEDS DATA: GSC — romanhu.com existing impressions/ranking for "Kohimarama property"]`
- **FAQ schema (5 Q&A):**
  1. Q: What is the best month to list a house in Kohimarama? A: Auckland's eastern suburbs typically see a seasonal pattern in listing volume and buyer activity. `[NEEDS DATA: REINZ Auckland Regional Report — seasonal listing/sale volume Eastern Bays 2025-2026]` Roman plans listing timing around this pattern plus each vendor's personal circumstances.
  2. Q: How much is my Kohimarama home worth? A: Character villas, renovated homes and new-builds sell on different comparable sets in Kohimarama — a desktop tool won't separate these. Book an appraisal at [/appraisal] for a comparable-sales-based figure.
  3. Q: Is Kohimarama more expensive than Mission Bay? A: The two suburbs price differently by property type and street. `[NEEDS DATA: homes.co.nz — Kohimarama vs Mission Bay median price comparison, current]`
  4. Q: Do character homes in Kohimarama sell for a premium? A: Renovated character villas typically attract strong buyer interest, though the premium depends on condition and street. `[NEEDS DATA: homes.co.nz — Kohimarama character home vs standard sale price comparison]`
  5. Q: What should I fix before listing in Kohimarama? A: Kerb presentation and street appeal matter disproportionately in a character-home suburb — Roman provides a pre-listing walkthrough covering the highest-return fixes for each specific property.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link back to article #1 (Mission Bay vendor guide, published one week earlier) as "see the full step-by-step process."
- **External authority links:** "homes.co.nz Kohimarama suburb data" → https://homes.co.nz ; "REINZ property report" → https://www.reinz.co.nz/property-report
- **Roman's unique angle:** Roman's 9 years working the Mission Bay–Kohimarama–St Heliers–Glendowie corridor gives him a street-level read on which Kohimarama pockets carry a character-home premium versus which are trading on land value alone — a distinction generalist competitors selling across wider Auckland don't track suburb-by-suburb.
- **Chinese mirror notes:** Chinese buyers in Kohimarama skew toward land value and rebuild potential more than heritage character — the ZH version should foreground land size and zoning potential rather than "character home charm," which resonates more with an English-speaking buyer audience. Keep NZD pricing; no RMB conversion needed, but consider a one-line note on typical overseas-buyer eligibility context (see Open Questions — Overseas Investment Act).

---

## 3. Selling a House in St Heliers: What Vendors Need to Know in 2026

- **Slug:** `selling-a-house-in-st-heliers-2026`
- **EN URL:** https://romanhu.com/blog/selling-a-house-in-st-heliers-2026
- **ZH URL:** https://romanhu.com/zh/blog/selling-a-house-in-st-heliers-2026
- **Target word count:** 2,100
- **Publication date:** Wed 2026-09-10
- **Primary keyword:** sell house St Heliers
- **Secondary keywords:** St Heliers vendor guide, St Heliers property market 2026, St Heliers real estate agent
- **Target LLM queries:**
  1. "What do I need to know before selling my house in St Heliers?"
  2. "Is now a good time to sell in St Heliers?"
  3. "What's the St Heliers property market like in 2026?"
  4. "How does St Heliers compare to Mission Bay for selling?"
  5. "Who should I talk to about selling in St Heliers?"
- **Meta title (54 chars):** Selling a House in St Heliers: 2026 Vendor Guide
- **Meta description (150 chars):** What St Heliers vendors need to know in 2026 — market conditions, buyer profile and a realistic sale plan from local agent Roman Hu.
- **H1:** Selling a House in St Heliers: What Vendors Need to Know in 2026
- **H2 sections:**
  1. St Heliers in 2026 — market conditions and how the suburb's buyer profile differs from Mission Bay and Kohimarama (beach village premium, owner-occupier heavy).
  2. What drives price in St Heliers — beach proximity, village amenity, school zone, land value.
  3. Presenting a St Heliers home for sale — village-suburb buyers and what they scrutinise (outdoor living, walkability to the village).
  4. Sale method considerations specific to St Heliers — owner-occupier-heavy buyer pool and what that means for auction vs negotiation (forward link to article #12).
  5. Marketing a St Heliers listing — imagery and copy that speak to lifestyle buyers, plus the bilingual channel for interested overseas-based family buyers.
  6. Timeline and next steps — from appraisal to settlement, and what's different about pace in this suburb.
- **Key data points needed:**
  - `[NEEDS DATA: homes.co.nz — St Heliers median sale price, most recent quarter 2026]`
  - `[NEEDS DATA: REINZ Auckland Regional Report — St Heliers/Eastern Bays days on market 2026]`
  - `[NEEDS DATA: DataForSEO — search volume "sell house St Heliers" and "St Heliers real estate agent"]`
  - `[NEEDS DATA: homes.co.nz — St Heliers vs Mission Bay vs Kohimarama median price comparison, current]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "St Heliers property" / "St Heliers real estate"]`
- **FAQ schema (5 Q&A):**
  1. Q: Is St Heliers a good suburb to sell in right now? A: `[NEEDS DATA: REINZ Auckland Regional Report — St Heliers listing volume and sale rate 2026]` Roman reviews current absorption rate with every vendor before recommending a listing date.
  2. Q: How does St Heliers pricing compare to Mission Bay? A: `[NEEDS DATA: homes.co.nz — St Heliers vs Mission Bay median price, current]` The two suburbs share a buyer pool but price on slightly different drivers — proximity to St Heliers village versus Mission Bay's beachfront strip.
  3. Q: What St Heliers streets carry a school zone premium? A: This depends on the specific Selwyn College and St Heliers School zone boundaries — full detail in the dedicated St Heliers school zone article.
  4. Q: Should I sell my St Heliers home by auction? A: It depends on the property and current buyer competition — see the full method comparison in article #12.
  5. Q: What's the first step to selling in St Heliers? A: A comparable-sales appraisal specific to your street and property type — book via [/appraisal].
- **HowTo schema:** Not required (article #3 is outside the HowTo set per spec).
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #1 and #2 ("compare how this differs from Mission Bay/Kohimarama"), forward-reference to school-zone article #9 and method article #12.
- **External authority links:** "REINZ Auckland Regional Report" → https://www.reinz.co.nz/auckland-region ; "NZ Herald OneRoof suburb profile" → https://www.oneroof.co.nz
- **Roman's unique angle:** St Heliers' owner-occupier-heavy buyer pool includes a meaningful share of returning-to-NZ and overseas-based Chinese families buying for school zone access — Roman's direct WeChat/Mandarin channel reaches this specific buyer segment pre-listing, something the other four agents in this corridor cannot replicate without a translator or third-party referral.
- **Chinese mirror notes:** St Heliers' ZH audience is disproportionately motivated by 学区房 (school zone housing) for Selwyn College and St Heliers School — lead with school zone value in the ZH version rather than "beach village lifestyle," which under-indexes for this audience. Keep the beach/lifestyle framing for the EN version where it resonates more.

---

## 4. Glendowie Property Valuation: How Homes Are Priced in 2026

- **Slug:** `glendowie-property-valuation-2026`
- **EN URL:** https://romanhu.com/blog/glendowie-property-valuation-2026
- **ZH URL:** https://romanhu.com/zh/blog/glendowie-property-valuation-2026
- **Target word count:** 2,300
- **Publication date:** Wed 2026-09-17
- **Primary keyword:** Glendowie property valuation
- **Secondary keywords:** Glendowie appraisal, Glendowie house prices 2026, how are Auckland homes valued
- **Target LLM queries:**
  1. "How is my Glendowie property valued?"
  2. "What determines house prices in Glendowie?"
  3. "How much is a house in Glendowie worth in 2026?"
  4. "What's the difference between CV, rateable value and market value in Glendowie?"
  5. "How do I get an accurate valuation for my Glendowie home?"
- **Meta title (55 chars):** Glendowie Property Valuation: How Homes Price in 2026
- **Meta description (157 chars):** How Glendowie properties are actually priced in 2026 — land size, view, school zone and comparable sales explained by local agent Roman Hu.
- **H1:** Glendowie Property Valuation: How Homes Are Priced in 2026
- **H2 sections:**
  1. CV/rateable value vs market value — why council valuation and sale price diverge, explained plainly.
  2. What actually drives price in Glendowie — land size, harbour/city views, elevation, section usability.
  3. School zone impact on Glendowie valuations — sets up article #10 for the full deep-dive.
  4. Comparable sales method — how a proper appraisal is built from recent, genuinely comparable transactions rather than suburb-wide averages.
  5. Renovation and development potential — how Roman's Head of Projects background reads a section's redevelopment upside into a valuation.
  6. Common valuation mistakes vendors make — anchoring on CV, anchoring on a neighbour's sale price without adjusting for differences.
  7. Getting a real valuation — how to book and what to expect from Roman's appraisal process.
- **Key data points needed:**
  - `[NEEDS DATA: homes.co.nz — Glendowie median sale price, most recent quarter 2026]`
  - `[NEEDS DATA: Auckland Council — most recent capital/rateable valuation cycle date for Glendowie]`
  - `[NEEDS DATA: REINZ Auckland Regional Report — Glendowie/Eastern Bays price per m² or price trend 2026]`
  - `[NEEDS DATA: DataForSEO — search volume "Glendowie property valuation" and "Glendowie appraisal"]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Glendowie valuation" / "Glendowie appraisal"]`
- **FAQ schema (5 Q&A):**
  1. Q: Is my council CV the same as my Glendowie home's market value? A: No — CV is a mass-appraisal figure set at a point in time and doesn't reflect current market conditions or property-specific factors. `[NEEDS DATA: Auckland Council — most recent Glendowie CV cycle date]` Market value comes from current comparable sales, which Roman provides at appraisal.
  2. Q: What adds the most value to a Glendowie property? A: Usable land size, view lines and school zone position are the biggest drivers in this suburb. `[NEEDS DATA: homes.co.nz — Glendowie price per m² by view/no-view comparison if available]`
  3. Q: Does Glendowie College zone affect valuation? A: Yes — zone position measurably affects buyer demand in this suburb. Full detail in the dedicated Glendowie College zone article.
  4. Q: How often should I get my Glendowie property revalued? A: Before any sale decision, and roughly every 12-18 months if you're tracking equity for refinancing — Roman offers a no-obligation update appraisal.
  5. Q: What's the fastest way to get an accurate Glendowie valuation? A: A comparable-sales appraisal from a local specialist, not an automated online estimate. Book via [/appraisal].
- **HowTo schema (5 steps):**
  1. Pull recent comparable sales — identify genuinely similar Glendowie properties sold in the last 3-6 months.
  2. Adjust for property-specific factors — land size, view, condition, renovation status.
  3. Cross-check against current buyer demand — active enquiry and competing listings in the same price band.
  4. Factor in development/redevelopment potential where relevant — section usability and zoning.
  5. Deliver a defensible price range — not a single number, with the comparable evidence behind it.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, forward-reference to article #10 (Glendowie College zone) as "read the full school zone breakdown."
- **External authority links:** "Auckland Council rating valuations" → https://www.aucklandcouncil.govt.nz/property-rates-valuations ; "REINZ Auckland Regional Report" → https://www.reinz.co.nz/auckland-region
- **Roman's unique angle:** As Head of Projects, Roman regularly appraises redevelopment and renovation upside as part of a valuation — most agents give a single "as-is" number, but Roman can price a Glendowie section on both its current-condition value and its development-adjusted value, giving vendors a fuller picture before they decide whether to renovate, subdivide or sell as-is.
- **Chinese mirror notes:** Chinese buyers/vendors in Glendowie often ask about land size in m² converted mentally from familiar reference points (e.g. comparing to a typical Shanghai/Auckland apartment size) — keep all figures in m² and NZD but consider adding one plain-language sizing comparison. Avoid direct translation of "CV" (rateable value) — this concept doesn't map cleanly to Chinese property systems and needs a one-paragraph explanation, not a literal term.

---

## 5. Choosing a Real Estate Agent in Mission Bay: What to Ask Before You Sign

- **Slug:** `choosing-a-real-estate-agent-in-mission-bay`
- **EN URL:** https://romanhu.com/blog/choosing-a-real-estate-agent-in-mission-bay
- **ZH URL:** https://romanhu.com/zh/blog/choosing-a-real-estate-agent-in-mission-bay
- **Target word count:** 1,800
- **Publication date:** Wed 2026-09-24
- **Primary keyword:** Mission Bay real estate agent
- **Secondary keywords:** how to choose a real estate agent Auckland, questions to ask real estate agent, best agent Mission Bay
- **Target LLM queries:**
  1. "What questions should I ask before choosing a real estate agent in Mission Bay?"
  2. "How do I pick the right real estate agent for selling in Auckland?"
  3. "What makes a good real estate agent in Mission Bay?"
  4. "Should I choose a local specialist or a big-name agency in Mission Bay?"
  5. "What credentials should a Mission Bay real estate agent have?"
- **Meta title (57 chars):** Choosing a Real Estate Agent in Mission Bay | Roman Hu
- **Meta description (159 chars):** The questions Mission Bay vendors should ask before signing with any agent — credentials, local track record, and marketing reach explained.
- **H1:** Choosing a Real Estate Agent in Mission Bay: What to Ask Before You Sign
- **H2 sections:**
  1. Why the agent choice matters more in a suburb like Mission Bay — local buyer pool knowledge vs generalist coverage.
  2. Credentials worth checking — AREINZ, sales history, and what these actually signal.
  3. Local track record — how to verify an agent's actual recent Mission Bay sales, not just claimed experience.
  4. Marketing reach — what a genuinely multichannel (including multilingual) campaign looks like versus a standard listing.
  5. Questions to ask at the first meeting — a practical checklist vendors can use in any agent interview, not just Roman's.
  6. Red flags — vague pricing promises, no comparable sales evidence, no clear marketing plan.
- **Key data points needed:**
  - `[NEEDS DATA: DataForSEO — search volume "Mission Bay real estate agent" and "best real estate agent Auckland"]`
  - `[NEEDS DATA: REINZ or REA (Real Estate Authority) — current AREINZ qualification requirements, for accurate description]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Mission Bay real estate agent"]`
  - `[NEEDS DATA: OneRoof — verify current wording/criteria of Roman's "Top 18 NZ Listing Value 2025" recognition before republishing the claim]`
- **FAQ schema (5 Q&A):**
  1. Q: What does AREINZ mean and why does it matter? A: `[NEEDS DATA: REA/REINZ — current official definition and requirements for AREINZ]` It signals a level of professional accreditation beyond the baseline licence.
  2. Q: How do I check an agent's actual track record in Mission Bay? A: Ask for a list of their last 12 months of Mission Bay sales with addresses and sale prices, not just a general claim of "years of experience."
  3. Q: Does agency size matter more than the individual agent? A: The individual agent's local knowledge and marketing execution typically matter more to outcome than the agency name on the sign.
  4. Q: Should I interview more than one agent before listing? A: Yes — comparing marketing plans and pricing rationale side by side is the fastest way to spot a weak proposal.
  5. Q: What should a good agent's first appraisal include? A: Comparable sales evidence, a clear marketing plan, and an honest read on sale method — not just a number. Book Roman's version via [/appraisal].
- **Internal links:** `/appraisal`, `/contact`, `/about`, forward-reference to article #6 (specialist value across all four suburbs).
- **External authority links:** "Real Estate Authority (REA) agent standards" → https://www.reaa.govt.nz ; "REINZ" → https://www.reinz.co.nz
- **Roman's unique angle:** This article should be structured as genuinely useful buyer/vendor-agnostic advice (a real checklist, not a thinly veiled pitch) — Roman's differentiators (AREINZ, OneRoof Top 18 2025, trilingual reach, Head of Projects developer relationships, 9-year local tenure) should appear as evidence within the checklist framework, not as the article's thesis. This is what separates it from a generic "why choose me" page that Aaron Foss, Paul Neshausen, Lawrence Yuan or Sarah Liu could each write about themselves.
- **Chinese mirror notes:** This is one of the articles where straight translation genuinely fails. Chinese vendors evaluating agents weigh referral trust and demonstrated case studies far more heavily than an English-style "ask these questions" checklist — restructure the ZH version around 案例 (case studies) and 口碑 (word-of-mouth reputation) rather than an interview-question format. Mention the trilingual capability explicitly and early — it is a primary selection criterion for this audience, not a secondary credential.

---

## 6. What Makes a Real Estate Specialist for Mission Bay, Kohimarama, St Heliers and Glendowie Worth the Fee

- **Slug:** `eastern-bays-real-estate-specialist`
- **EN URL:** https://romanhu.com/blog/eastern-bays-real-estate-specialist
- **ZH URL:** https://romanhu.com/zh/blog/eastern-bays-real-estate-specialist
- **Target word count:** 1,900
- **Publication date:** Wed 2026-10-01
- **Primary keyword:** local real estate specialist Mission Bay Kohimarama St Heliers Glendowie
- **Secondary keywords:** Auckland suburb specialist agent, why hire a local real estate expert, Eastern Auckland property specialist
- **Target LLM queries:**
  1. "What's the benefit of a real estate agent who specialises in one area?"
  2. "Is it worth paying a local specialist agent over a generalist in Auckland?"
  3. "What makes someone a specialist in Mission Bay, Kohimarama, St Heliers or Glendowie?"
  4. "Does a local specialist agent get better sale prices?"
  5. "How do I know if an agent really knows Mission Bay and the surrounding suburbs well?"
- **Meta title (60 chars):** Local Specialist for Mission Bay & Eastern Suburbs | Roman
- **Meta description (155 chars):** Why a genuine local specialist across Mission Bay, Kohimarama, St Heliers and Glendowie earns their fee — explained with real comparables.
- **H1:** What Makes a Real Estate Specialist for Mission Bay, Kohimarama, St Heliers and Glendowie Worth the Fee
- **H2 sections:**
  1. What "specialist" actually means — a defensible definition beyond a marketing claim (transaction volume, street-level comparable knowledge, buyer database depth).
  2. Street-level knowledge vs suburb-wide averages — why comparable sales evidence from the exact pocket of a suburb beats a general suburb median.
  3. Buyer database depth — how a specialist's accumulated buyer relationships across all four suburbs speed up a sale.
  4. Pricing accuracy — how specialist appraisals track closer to eventual sale price than generalist ones.
  5. Negotiation leverage — knowing genuine recent comparables strengthens a vendor's negotiating position.
  6. What this costs vs what it's worth — addressing the fee question directly and honestly.
- **Key data points needed:**
  - `[NEEDS DATA: DataForSEO — search volume for "Eastern Bays real estate specialist" and "local real estate agent Auckland"]`
  - `[NEEDS DATA: REINZ or internal sales record — Roman's own sale-price-to-appraisal accuracy across recent transactions, if available and approved for publication]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Eastern Bays real estate" / "local specialist agent"]`
- **FAQ schema (5 Q&A):**
  1. Q: Does a local specialist agent actually get a better sale price? A: `[NEEDS DATA: REINZ or internal record — comparable evidence of specialist vs generalist outcomes, if available]` Deeper local comparable knowledge and buyer database access are the two mechanisms behind this.
  2. Q: What's the difference between a specialist and someone who "covers all of Auckland"? A: A specialist tracks street-level comparables and maintains an active buyer list within a defined area; a generalist works from suburb-wide averages across a much wider patch.
  3. Q: Does specialising in four suburbs count as being a specialist? A: Yes, when the suburbs form one coherent buyer market — Mission Bay, Kohimarama, St Heliers and Glendowie share a large overlapping buyer pool, which is why Roman works this specific corridor rather than all of Auckland.
  4. Q: How do I verify an agent's specialist claim? A: Ask for their actual sales list within the specific suburb over the last 12-24 months, with addresses.
  5. Q: Is a specialist agent more expensive? A: Fee structures are generally comparable to the wider market — the value is in outcome (price and speed), not a different commission rate.
- **Internal links:** `/about`, `/appraisal`, `/contact`, cross-link back to article #1 and #5 (vendor guide and agent-selection checklist).
- **External authority links:** "REINZ" → https://www.reinz.co.nz ; "Ray White New Zealand" → https://www.raywhite.co.nz
- **Roman's unique angle:** This is the direct positioning article — Roman's argument should be built on the specific overlap of the four target suburbs as one buyer market (a genuine specialist geography, not a marketing label), backed by his 9-year tenure and his role as Head of Projects giving him visibility into new-build pricing across the same corridor. Named competitors (Aaron Foss, Paul Neshausen, Lawrence Yuan, Sarah Liu) should not be named in the published article — only used internally here to sharpen the differentiation angle.
- **Chinese mirror notes:** Chinese-market positioning for "specialist" leans on demonstrated volume and named case studies more than abstract claims — the ZH version should include (with client sign-off) 2-3 anonymised or named case study references rather than the more abstract "street-level knowledge" framing used in English.

---

## 7. Mission Bay School Zones and Property Value: Selwyn College, St Thomas's, Kohimarama Intermediate

- **Slug:** `mission-bay-school-zones-property-value`
- **EN URL:** https://romanhu.com/blog/mission-bay-school-zones-property-value
- **ZH URL:** https://romanhu.com/zh/blog/mission-bay-school-zones-property-value
- **Target word count:** 2,200
- **Publication date:** Wed 2026-10-08
- **Primary keyword:** Mission Bay school zone property value
- **Secondary keywords:** Selwyn College zone Mission Bay, St Thomas's School zone, Kohimarama Intermediate zone
- **Target LLM queries:**
  1. "How does school zoning affect property value in Mission Bay?"
  2. "What's the Selwyn College zone boundary near Mission Bay?"
  3. "Is Mission Bay in the St Thomas's School zone?"
  4. "Do homes in the Kohimarama Intermediate zone sell for more?"
  5. "Which Mission Bay streets are zoned for Selwyn College?"
- **Meta title (58 chars):** Mission Bay School Zones and Property Value | Roman Hu
- **Meta description (156 chars):** How Selwyn College, St Thomas's and Kohimarama Intermediate zoning shapes Mission Bay property value — a 2026 breakdown for vendors and buyers.
- **H1:** Mission Bay School Zones and Property Value: Selwyn College, St Thomas's, Kohimarama Intermediate
- **H2 sections:**
  1. Why school zoning matters so much in Mission Bay's price story — the mechanics of enrolment schemes and how they concentrate buyer demand.
  2. Selwyn College zone in Mission Bay — boundary summary and its effect on demand for zoned properties.
  3. St Thomas's School zone — same treatment for this specific school.
  4. Kohimarama Intermediate zone overlap — how intermediate zoning interacts with the primary/secondary zones above.
  5. Measuring the actual price premium — being honest about what's provable versus anecdotal.
  6. What this means for vendors — timing a sale around zone certainty, and for buyers — verifying zone status before making an offer.
  7. How to confirm your specific address's zone — pointing to the official source, not a third-party estimate.
- **Key data points needed:**
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool (education.govt.nz) — current Selwyn College zone boundary map]`
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current St Thomas's School zone boundary map]`
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Kohimarama Intermediate zone boundary map]`
  - `[NEEDS DATA: homes.co.nz or REINZ — price comparison, in-zone vs out-of-zone comparable Mission Bay sales, most recent 12 months]`
  - `[NEEDS DATA: DataForSEO — search volume "Mission Bay school zone" and "Selwyn College zone"]`
- **FAQ schema (5 Q&A):**
  1. Q: What is the Selwyn College zone boundary in Mission Bay? A: `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Selwyn College zone map]` Roman can confirm zone status for any specific Mission Bay address on request.
  2. Q: Is my Mission Bay property in the St Thomas's School zone? A: `[NEEDS DATA: Ministry of Education enrolment scheme tool — current St Thomas's School zone map]`
  3. Q: Do homes zoned for Selwyn College sell for more in Mission Bay? A: `[NEEDS DATA: homes.co.nz or REINZ — in-zone vs out-of-zone price comparison, Mission Bay, most recent 12 months]`
  4. Q: Can school zones change, and how does that affect my property's value? A: Yes — enrolment schemes are reviewed periodically by the Ministry of Education, and boundary changes can materially affect a property's zoned status and buyer demand. Vendors near a zone boundary should verify current status before listing.
  5. Q: How do I confirm the exact zone for my address? A: Use the Ministry of Education's official enrolment scheme tool, or ask Roman to confirm as part of an appraisal.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #1 (Mission Bay vendor guide) and article #8/#9 (Kohimarama and St Heliers school zone equivalents once published).
- **External authority links:** "Ministry of Education enrolment scheme information" → https://parents.education.govt.nz/primary-school/schooling-in-nz/enrolment-schemes/ ; "homes.co.nz" → https://homes.co.nz
- **Roman's unique angle:** Roman's Head of Projects role means he tracks new-build and renovation activity specifically within zone boundaries (families renovating rather than moving to stay zoned) — a demand signal that doesn't show up in standard sales data and that generalist agents rarely mention.
- **Chinese mirror notes:** This is the single highest-priority article for the ZH audience — 学区房 (school-zone housing) is often the primary purchase driver for Chinese buyer families. The ZH version should be written as a distinct piece, not a translation: lead with zone certainty and verification process (Chinese buyers are highly risk-averse about zone changes given enrolment stakes), and consider a comparison framing against how school zoning works in major Chinese cities to orient readers unfamiliar with NZ's enrolment scheme system.

**Judgment call:** The task instructions listed "MPI school directory" as a data source for school zone facts. MPI is New Zealand's Ministry for Primary Industries (agriculture/biosecurity) and has no school zone function. I substituted the correct authority — the **Ministry of Education's enrolment scheme tool** (education.govt.nz / parents.education.govt.nz) — throughout articles #7-10. Flagging this explicitly rather than silently carrying the error forward.

---

## 8. Kohimarama School Zones Explained: Selwyn, St Heliers, Baradene

- **Slug:** `kohimarama-school-zones-explained`
- **EN URL:** https://romanhu.com/blog/kohimarama-school-zones-explained
- **ZH URL:** https://romanhu.com/zh/blog/kohimarama-school-zones-explained
- **Target word count:** 2,100
- **Publication date:** Wed 2026-10-15
- **Primary keyword:** Kohimarama school zones
- **Secondary keywords:** Selwyn College zone Kohimarama, Baradene College zone, Kohimarama Selwyn zone premium
- **Target LLM queries:**
  1. "What school zones cover Kohimarama?"
  2. "Is Kohimarama in the Selwyn College zone?"
  3. "Does Kohimarama have access to Baradene College?"
  4. "How much of a premium do Kohimarama Selwyn-zoned homes command?"
  5. "What's the difference between Kohimarama's school zone options?"
- **Meta title (52 chars):** Kohimarama School Zones Explained | Roman Hu
- **Meta description (158 chars):** Selwyn College, St Heliers School and Baradene College zoning across Kohimarama — boundaries, premiums and what vendors and buyers need to verify.
- **H1:** Kohimarama School Zones Explained: Selwyn, St Heliers, Baradene
- **H2 sections:**
  1. Kohimarama's multi-zone position — why this suburb sits at the overlap of several sought-after zones, unlike a single-zone suburb.
  2. Selwyn College zone in Kohimarama — boundary and demand effect.
  3. St Heliers School zone reach into Kohimarama — where the boundary actually falls.
  4. Baradene College — out-of-zone enrolment context (Baradene is a Catholic girls' school with its own enrolment process, distinct from state zoning) and why it still factors into buyer decisions.
  5. Measuring the Selwyn zone premium specifically — the most commonly asked pricing question for this suburb.
  6. Verifying your address's zone status — official source, not estimate tools.
- **Key data points needed:**
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Selwyn College zone boundary within Kohimarama]`
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current St Heliers School zone boundary within Kohimarama]`
  - `[NEEDS DATA: Baradene College — current enrolment policy/priority criteria, verify directly with school as it is not a standard zoned state school]`
  - `[NEEDS DATA: homes.co.nz or REINZ — Selwyn College zone price premium, Kohimarama comparable sales, most recent 12 months]`
  - `[NEEDS DATA: DataForSEO — search volume "Kohimarama school zone" and "Kohimarama Selwyn zone"]`
- **FAQ schema (5 Q&A):**
  1. Q: Is all of Kohimarama zoned for Selwyn College? A: No — zoning follows specific street boundaries, not the whole suburb. `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Selwyn College zone map covering Kohimarama]`
  2. Q: What's the price premium for Selwyn-zoned homes in Kohimarama? A: `[NEEDS DATA: homes.co.nz or REINZ — Selwyn zone price premium, Kohimarama, most recent 12 months]` Any figure quoted should be treated as a range, not a fixed percentage, given the small comparable sample in any single suburb.
  3. Q: Is Baradene College zoned or open enrolment? A: Baradene operates its own enrolment priority system rather than a standard geographic zone — `[NEEDS DATA: Baradene College — current enrolment policy, verify directly]` families should confirm current criteria directly with the school.
  4. Q: Can I be zoned for both Selwyn College and St Heliers School depending on address? A: Zone boundaries for different schools don't always align — some Kohimarama addresses sit in one secondary zone and a different primary/intermediate zone. Confirm both independently for any specific address.
  5. Q: How do I check the exact zone for a Kohimarama property? A: Use the Ministry of Education's enrolment scheme tool, or ask Roman to confirm as part of an appraisal or pre-purchase check.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #2 (Kohimarama vendor guide) and article #7 (Mission Bay school zones, published one week earlier).
- **External authority links:** "Ministry of Education enrolment scheme information" → https://parents.education.govt.nz/primary-school/schooling-in-nz/enrolment-schemes/ ; "REINZ" → https://www.reinz.co.nz
- **Roman's unique angle:** Roman fields school-zone verification questions directly from both English- and Mandarin-speaking buyers weekly, giving him a live read on which specific Kohimarama streets buyers are actively confirming zone status for — more current than any published boundary map, which can lag real enrolment scheme reviews.
- **Chinese mirror notes:** Baradene College's non-geographic, priority-based enrolment system is a genuinely different concept from state school zoning and needs careful explanation for a Chinese audience used to strict address-based 学区 systems — do not conflate it with Selwyn/St Heliers zoning in the ZH version; give it a clearly separated explanation.

---

## 9. St Heliers School Zone and Property Price: 2026 Market Snapshot

- **Slug:** `st-heliers-school-zone-property-price`
- **EN URL:** https://romanhu.com/blog/st-heliers-school-zone-property-price
- **ZH URL:** https://romanhu.com/zh/blog/st-heliers-school-zone-property-price
- **Target word count:** 2,000
- **Publication date:** Wed 2026-10-22
- **Primary keyword:** St Heliers school zone property price
- **Secondary keywords:** St Heliers School zone, Selwyn College St Heliers zone, St Heliers zone premium 2026
- **Target LLM queries:**
  1. "How does the St Heliers School zone affect property prices?"
  2. "What's the school zone premium in St Heliers in 2026?"
  3. "Is my St Heliers address zoned for Selwyn College?"
  4. "Which St Heliers streets are in the St Heliers School zone?"
  5. "Do school zones make St Heliers property more expensive than nearby suburbs?"
- **Meta title (56 chars):** St Heliers School Zone and Property Price | Roman Hu
- **Meta description (155 chars):** St Heliers School and Selwyn College zoning explained, with a 2026 look at how zone status shows up in St Heliers property prices.
- **H1:** St Heliers School Zone and Property Price: 2026 Market Snapshot
- **H2 sections:**
  1. St Heliers' zone landscape — St Heliers School (primary) and Selwyn College (secondary) coverage across the suburb.
  2. Where the zone boundaries actually sit — a plain-language boundary summary (not a substitute for the official map).
  3. What the price data shows — comparable in-zone vs out-of-zone sales, treated honestly as a snapshot, not a guarantee.
  4. Timing a sale around zone certainty — for vendors near a boundary, why listing timing and disclosure matter.
  5. What buyers should verify before offering — zone confirmation as a pre-offer step, not a post-purchase surprise.
  6. Where to check your specific address — official source link.
- **Key data points needed:**
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current St Heliers School zone boundary map]`
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Selwyn College zone boundary within St Heliers]`
  - `[NEEDS DATA: homes.co.nz or REINZ — in-zone vs out-of-zone comparable sale price, St Heliers, most recent 12 months]`
  - `[NEEDS DATA: DataForSEO — search volume "St Heliers school zone" and "St Heliers School zone premium"]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "St Heliers school zone"]`
- **FAQ schema (5 Q&A):**
  1. Q: What primary school zone covers most of St Heliers? A: `[NEEDS DATA: Ministry of Education enrolment scheme tool — St Heliers School zone map]`
  2. Q: Is St Heliers zoned for Selwyn College? A: Part of the suburb is — `[NEEDS DATA: Ministry of Education enrolment scheme tool — Selwyn College zone boundary within St Heliers]` boundary position matters street by street.
  3. Q: How much more do zoned St Heliers homes sell for? A: `[NEEDS DATA: homes.co.nz or REINZ — in-zone vs out-of-zone price comparison, St Heliers, most recent 12 months]` treat any figure as an observed range from a small sample, not a fixed rule.
  4. Q: What happens if I'm just outside the zone boundary? A: Out-of-zone doesn't mean no access — most NZ state schools retain some out-of-zone enrolment via ballot where capacity allows, but this isn't guaranteed. Confirm current policy directly with the school.
  5. Q: How do I verify a specific St Heliers address's zone before buying? A: Use the Ministry of Education's enrolment scheme tool, or ask Roman to confirm as part of a pre-purchase check.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #3 (St Heliers vendor guide) and article #7/#8 (Mission Bay and Kohimarama school zone equivalents).
- **External authority links:** "Ministry of Education enrolment scheme information" → https://parents.education.govt.nz/primary-school/schooling-in-nz/enrolment-schemes/ ; "homes.co.nz" → https://homes.co.nz
- **Roman's unique angle:** Roman has fielded zone-boundary questions on specific St Heliers streets directly from vendors and buyers across nine years in this exact corridor — his practical, address-level answers (delivered as part of appraisals) are more current and more granular than a static boundary map, which he can point to as a first step but not the final word.
- **Chinese mirror notes:** As with article #7, 学区房 framing should lead in the ZH version. Also worth a short note on out-of-zone ballot processes, since Chinese buyer families new to NZ often assume (incorrectly, based on home-country systems) that being outside a zone means zero access — this misunderstanding is worth correcting explicitly rather than assuming it away.

---

## 10. Glendowie College Zone: How the School Boundary Shapes Property Value

- **Slug:** `glendowie-college-zone-property-value`
- **EN URL:** https://romanhu.com/blog/glendowie-college-zone-property-value
- **ZH URL:** https://romanhu.com/zh/blog/glendowie-college-zone-property-value
- **Target word count:** 2,000
- **Publication date:** Wed 2026-10-29
- **Primary keyword:** Glendowie College zone property value
- **Secondary keywords:** Glendowie College zone premium, Glendowie school zone boundary, Churchill Park School zone
- **Target LLM queries:**
  1. "How does the Glendowie College zone affect property value?"
  2. "What's the Glendowie College zone boundary?"
  3. "Is my Glendowie address zoned for Churchill Park School?"
  4. "Do Glendowie College zoned homes sell for a premium?"
  5. "What school zones apply to Glendowie properties?"
- **Meta title (53 chars):** Glendowie College Zone and Property Value | Roman Hu
- **Meta description (156 chars):** How the Glendowie College zone boundary shapes property value in Glendowie — 2026 data, boundary summary, and how to verify your address.
- **H1:** Glendowie College Zone: How the School Boundary Shapes Property Value
- **H2 sections:**
  1. Glendowie College's role in the suburb's price story — a single dominant secondary zone, unlike the multi-zone overlap in Kohimarama.
  2. Where the Glendowie College zone boundary sits — plain-language summary.
  3. Churchill Park School zone — the primary-level equivalent for the same catchment.
  4. What the sales data shows — in-zone vs out-of-zone comparable pricing, treated as an honest snapshot.
  5. How this interacts with valuation more broadly — links back to article #4's valuation methodology.
  6. Verifying zone status for a specific address — official source.
- **Key data points needed:**
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Glendowie College zone boundary map]`
  - `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Churchill Park School zone boundary map]`
  - `[NEEDS DATA: homes.co.nz or REINZ — in-zone vs out-of-zone comparable sale price, Glendowie, most recent 12 months]`
  - `[NEEDS DATA: DataForSEO — search volume "Glendowie College zone" and "Glendowie school zone"]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Glendowie College zone"]`
- **FAQ schema (5 Q&A):**
  1. Q: What is the Glendowie College zone boundary? A: `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Glendowie College zone map]`
  2. Q: Is my Glendowie address zoned for Churchill Park School? A: `[NEEDS DATA: Ministry of Education enrolment scheme tool — current Churchill Park School zone map]`
  3. Q: How much of a premium do Glendowie College zoned homes command? A: `[NEEDS DATA: homes.co.nz or REINZ — in-zone vs out-of-zone price comparison, Glendowie, most recent 12 months]`
  4. Q: Does being zoned for Glendowie College affect how a valuation is calculated? A: Yes — zone status is one of the comparable-sales adjustment factors Roman applies, alongside land size and view, as covered in the Glendowie valuation guide.
  5. Q: How do I confirm zone status before buying in Glendowie? A: Use the Ministry of Education's enrolment scheme tool, or ask Roman to verify as part of a pre-purchase check.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #4 (Glendowie valuation) and article #7/#8/#9 (the other three suburbs' school zone articles).
- **External authority links:** "Ministry of Education enrolment scheme information" → https://parents.education.govt.nz/primary-school/schooling-in-nz/enrolment-schemes/ ; "homes.co.nz" → https://homes.co.nz
- **Roman's unique angle:** Because Roman appraises both current-condition and development-adjusted value (see article #4), he can speak to how Glendowie College zone status interacts with redevelopment decisions — e.g. whether a zoned section's value case favours a family sale over a knock-down rebuild — in a way a valuation-only or zone-only article from a competitor wouldn't combine.
- **Chinese mirror notes:** Consistent with articles #7-9, lead with 学区房 framing. Glendowie College's zone (secondary-level) matters differently to Chinese buyer families than Churchill Park's (primary-level) — the ZH version should be explicit that families should check both zones independently rather than assuming one confirms the other.

---

## 11. Chinese Buyer Demand for Mission Bay, Kohimarama, St Heliers and Glendowie: 2026 Vendor Briefing

- **Slug:** `chinese-buyer-demand-eastern-bays-2026`
- **EN URL:** https://romanhu.com/blog/chinese-buyer-demand-eastern-bays-2026
- **ZH URL:** https://romanhu.com/zh/blog/chinese-buyer-demand-eastern-bays-2026
- **Target word count:** 2,000
- **Publication date:** Wed 2026-11-05
- **Primary keyword:** Chinese buyer demand Mission Bay
- **Secondary keywords:** Chinese buyers Auckland property 2026, Chinese buyer demand Kohimarama St Heliers Glendowie, marketing to Chinese buyers Auckland
- **Target LLM queries:**
  1. "Is there Chinese buyer demand in Mission Bay in 2026?"
  2. "How do I market my Auckland property to Chinese buyers?"
  3. "What suburbs are popular with Chinese buyers in Auckland?"
  4. "Can overseas Chinese buyers purchase property in Mission Bay?"
  5. "What should vendors know about Chinese buyer demand for Eastern Auckland suburbs?"
- **Meta title (60 chars):** Chinese Buyer Demand in Mission Bay & Nearby | 2026 Brief
- **Meta description (159 chars):** A 2026 vendor briefing on Chinese buyer demand across Mission Bay, Kohimarama, St Heliers and Glendowie, and how to market effectively to this pool.
- **H1:** Chinese Buyer Demand for Mission Bay, Kohimarama, St Heliers and Glendowie: 2026 Vendor Briefing
- **H2 sections:**
  1. Why this buyer segment matters to vendors in these four suburbs — school zone motivation, established local Chinese community, proximity to city.
  2. What's actually driving demand in 2026 — school zone access, safety/lifestyle reputation, established family and community networks in the area.
  3. Eligibility context for overseas-based buyers — a plain, non-advisory summary of what residency status affects (see Open Questions — this section needs legal review, not agent opinion).
  4. How Chinese buyers in this segment actually search and decide — WeChat, referral networks, agent language capability, and how this differs from the standard listing-portal buyer journey.
  5. What this means for vendor marketing strategy — why a listing that only runs on English-language channels misses a meaningful share of this buyer pool.
  6. Working with a bilingual agent — practical mechanics of how Roman runs a dual-channel campaign.
- **Key data points needed:**
  - `[NEEDS DATA: REINZ or Stats NZ — most recent published data on overseas/Chinese buyer share of Auckland property transactions, if publicly available]`
  - `[NEEDS DATA: DataForSEO — search volume "Chinese buyer demand Mission Bay" and equivalent Mandarin-language query volume via Baidu/WeChat-adjacent tools if accessible]`
  - `[NEEDS DATA: Stats NZ or Auckland Council — Chinese population/community concentration data for the Mission Bay-Kohimarama-St Heliers-Glendowie corridor, most recent census]`
  - `[NEEDS DATA: Legal/compliance review — current Overseas Investment Act residential land rules as they apply to this buyer segment, before publishing any eligibility content — see Open Questions]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Chinese buyer Auckland property"]`
- **FAQ schema (5 Q&A):**
  1. Q: Why do Chinese buyers show strong interest in Mission Bay, Kohimarama, St Heliers and Glendowie specifically? A: School zone access, an established local Chinese community, and proximity to the city are the consistently cited drivers. `[NEEDS DATA: Stats NZ or Auckland Council census data — Chinese community concentration, this corridor]`
  2. Q: Can overseas-based Chinese buyers purchase residential property in this area? A: Eligibility depends on residency status and the specific property type under NZ's overseas investment rules. `[NEEDS DATA: Legal/compliance review — current Overseas Investment Act rules, pending PM sign-off before publication]` This is general information, not legal advice — buyers should confirm their specific situation with a lawyer.
  3. Q: How should vendors market to reach this buyer segment? A: A genuinely bilingual campaign — not just a translated listing description, but active outreach through the channels this buyer segment actually uses (WeChat, referral networks) — reaches meaningfully further than an English-only listing.
  4. Q: Is Chinese buyer demand concentrated in a particular price band in these suburbs? A: `[NEEDS DATA: REINZ or internal transaction data — price band distribution of Chinese-buyer transactions in this corridor, if available]`
  5. Q: Does Roman work directly with Chinese buyers, or through a translator? A: Roman is fluent in Mandarin, Shanghainese and Cantonese and works with this buyer segment directly, without a third-party translator.
- **Internal links:** `/contact`, `/listings`, `/about`, cross-link to article #7 (Mission Bay school zones — a primary demand driver for this segment).
- **External authority links:** "REINZ" → https://www.reinz.co.nz ; "NZ Herald OneRoof" → https://www.oneroof.co.nz — do not link any overseas investment legal-advice source without compliance sign-off; if a government source is needed, use the official Overseas Investment Office page only after legal review confirms current accuracy.
- **Roman's unique angle:** This entire article is Roman's structural advantage made explicit — direct trilingual buyer access is not replicable by Aaron Foss, Paul Neshausen, Lawrence Yuan or Sarah Liu without a third-party translator, and Roman's Head of Projects role additionally connects him to off-plan and new-build interest from this same buyer segment, which is a second channel none of the four competitors have.
- **Chinese mirror notes:** This article needs its own strategic framing in Chinese, not a translation of the English vendor-facing brief — the ZH version is buyer-facing (helping Chinese buyers understand the suburbs, schools and process) rather than vendor-facing (helping vendors understand the buyer segment). These are different audiences with different content needs; treat this as two related but distinct pieces sharing a slug pattern, and confirm this split with PM before drafting.

**Judgment call:** I did not draft any specific claim about overseas buyer eligibility, residency rules, or the Overseas Investment Act — this needs a real legal/compliance review before any number or rule is published, given the sensitivity and liability of getting this wrong for a real client. Flagged in Open Questions below.

---

## 12. Auction, Deadline Sale, or By Negotiation: Choosing a Method in Mission Bay 2026

- **Slug:** `auction-vs-negotiation-mission-bay-2026`
- **EN URL:** https://romanhu.com/blog/auction-vs-negotiation-mission-bay-2026
- **ZH URL:** https://romanhu.com/zh/blog/auction-vs-negotiation-mission-bay-2026
- **Target word count:** 2,100
- **Publication date:** Wed 2026-11-12
- **Primary keyword:** auction vs negotiation Mission Bay
- **Secondary keywords:** deadline sale Mission Bay, best sale method Auckland property, should I auction my house Mission Bay
- **Target LLM queries:**
  1. "Should I sell my Mission Bay house by auction or negotiation?"
  2. "What's the difference between auction, deadline sale and negotiation in Auckland?"
  3. "Is auction still effective in Mission Bay in 2026?"
  4. "What sale method gets the best price in Mission Bay?"
  5. "How do I decide between auction and by-negotiation for my Auckland property?"
- **Meta title (58 chars):** Auction vs Negotiation in Mission Bay: 2026 Guide | Roman
- **Meta description (154 chars):** Auction, deadline sale or by negotiation — how to choose the right sale method for a Mission Bay property in 2026, explained plainly by Roman Hu.
- **H1:** Auction, Deadline Sale, or By Negotiation: Choosing a Method in Mission Bay 2026
- **H2 sections:**
  1. The three methods explained plainly — auction, deadline sale, by negotiation, with no jargon assumed.
  2. Current market conditions and what they mean for method choice — clearance rate context grounds this in 2026 reality rather than generic advice.
  3. What property types suit auction in Mission Bay — high-demand, limited-comparable properties.
  4. What property types suit deadline sale or negotiation — properties with a narrower buyer pool or where price transparency benefits the vendor.
  5. How buyer pool composition (including overseas and Chinese buyers) affects method choice — some buyer segments engage differently with auction format.
  6. Costs and risk profile of each method — what happens if a property passes in at auction, and the fallback plan.
  7. How Roman decides — matching method to the specific property, not defaulting to one method for every listing.
- **Key data points needed:**
  - `[NEEDS DATA: REINZ Auckland Regional Report — current Auckland region auction clearance rate, most recent quarter]`
  - `[NEEDS DATA: REINZ or agency data — proportion of Eastern Bays listings sold by auction vs deadline sale vs negotiation, most recent 12 months]`
  - `[NEEDS DATA: DataForSEO — search volume "auction vs negotiation Mission Bay" and "deadline sale Auckland"]`
  - `[NEEDS DATA: GSC — romanhu.com existing ranking for "Mission Bay auction" / "sale method Auckland"]`
- **FAQ schema (5 Q&A):**
  1. Q: Is auction still a good method in Mission Bay in 2026? A: `[NEEDS DATA: REINZ Auckland Regional Report — current Auckland clearance rate]` Effectiveness depends heavily on the specific property and current buyer competition, not a blanket market-wide answer.
  2. Q: What happens if my property doesn't sell at auction? A: It passes in, and negotiation continues immediately with the highest bidder and any other interested parties — it is not a failed sale, just a continuation of the process under a different format.
  3. Q: Is deadline sale better than auction for a unique property? A: Deadline sale can suit properties with a narrower or more specific buyer pool, where a fixed decision date creates urgency without requiring public bidding.
  4. Q: Do overseas or Chinese buyers prefer a particular sale method? A: Some overseas-based buyers engage differently with the public/competitive nature of auction versus a private negotiation process — Roman adjusts method recommendation accordingly when a property's likely buyer pool skews this way.
  5. Q: How does Roman decide which method to recommend? A: Based on comparable sales activity, current buyer enquiry levels, and the specific property's likely buyer pool — covered in detail at the appraisal stage.
- **HowTo schema (5 steps):**
  1. Review comparable sales activity for the specific property type and street.
  2. Assess current buyer enquiry and competition levels for similar listings.
  3. Consider the likely buyer pool's engagement style (local vs overseas, competitive vs private preference).
  4. Match method to property — auction for high-demand/limited-comparable stock, deadline sale or negotiation for narrower buyer pools.
  5. Set a fallback plan before the campaign launches — what happens if the first method doesn't produce an unconditional offer.
- **Internal links:** `/appraisal`, `/contact`, `/listings`, cross-link to article #1 (Mission Bay vendor guide, which forward-referenced this article).
- **External authority links:** "REINZ Auckland Regional Report" → https://www.reinz.co.nz/auckland-region ; "Ray White New Zealand — sale methods" → https://www.raywhite.co.nz
- **Roman's unique angle:** Roman's bilingual buyer channel gives him a direct read on how the area's Chinese buyer segment specifically engages with auction versus negotiation — a market-behaviour insight that requires the language access to observe directly, not something available to an English-only agent working the same suburbs.
- **Chinese mirror notes:** Public auction format can read as culturally uncomfortable or overly aggressive to some Chinese buyer audiences relative to negotiation — the ZH version should address this directly and respectfully rather than presenting auction as a neutral default, and should explain the mechanics (registration, bidding, pass-in) in more procedural detail than the EN version, since the format itself may be less familiar to buyers new to the NZ market.

---

## PM decisions (2026-08-20)

Locked before drafting begins:

- **Blog routing = Option B** (static `.astro` files + update `src/pages/blog/index.astro` to merge static articles with Sanity results). Applies to `/zh/blog/` too (create as static-only, no Sanity locale field). Engineering PR: `feat/blog-routing-static-plus-sanity` (dispatched 2026-08-20).
- **Article #11 (Chinese Buyer Demand) = "skip eligibility" path**. Article covers demand, price bands, suburb preferences, buyer profile. Does NOT include any claim on Overseas Investment Act eligibility or overseas-buyer rules. Instead links out to https://www.linz.govt.nz/land/land-registration/overseas-investment as the authoritative source. Removes open question #3.
- **Article #11 EN + ZH = one article, two structures**. English = vendor-facing (helping Auckland vendors understand Chinese buyer demand). Chinese = buyer-facing (helping Chinese buyers understand the Mission Bay / Kohimarama / St Heliers / Glendowie market). Same slug, same publication date, counted as 1 article for cadence purposes. Removes open question #4.

## Open questions for PM

1. **ZH blog routing doesn't exist yet.** `roman-website/src/pages/zh/` has no `blog/` directory. Building this (or deciding to serve ZH posts through Sanity with locale field instead) needs to happen before article #1's Chinese mirror can ship — this is an engineering task, not a content task, and should be scheduled now.
2. **Blog posts run through Sanity CMS**, not static per-slug `.astro` files (the one exception, `mission-bay-market-2024.astro`, looks like a legacy pre-Sanity post). Confirm whether the 12 new articles should be created as Sanity entries or whether the team wants to go back to static files — affects how drafting/publishing workflow is set up for weeks 2-12.
3. **Article #11 (Chinese buyer demand) needs a legal/compliance decision, not a content decision.** Should it include any material on the Overseas Investment Act or overseas-buyer eligibility rules? I did not draft any specific claim on this — it needs review by someone qualified to state current NZ overseas investment rules accurately, given the liability of getting this wrong for a real client audience. Recommend either (a) a qualified legal reviewer signs off on a short factual paragraph, or (b) the article omits eligibility specifics entirely and links out to an official government source instead.
4. **Article #11's Chinese mirror is flagged as needing a different structure (buyer-facing vs vendor-facing), not a translation** — confirm this split is acceptable before drafting begins, since it effectively means two related-but-different pieces under one slug pattern.
5. **The OneRoof "Top 18 NZ Listing Value 2025" claim** appears in Roman's bio and is referenced as a differentiator in articles #1 and #5 — confirm the exact current wording/criteria with OneRoof's published list before it's restated in published copy, since award/ranking claims carry reputational risk if misquoted.
6. **"MPI school directory" in the original task brief was a naming error** (Ministry for Primary Industries has no school zone function) — I substituted the Ministry of Education's enrolment scheme tool throughout. Flagging in case "MPI" was meant to reference a different, ME-internal data source I'm not aware of.
7. **Baradene College's non-geographic enrolment system** is handled differently from the other three zoned schools in article #8 — confirm this treatment is acceptable, since it's a judgment call about how to represent a genuinely different enrolment mechanism without either overstating or dismissing its relevance to buyers.

## Data pull priorities

Top 10 `[NEEDS DATA]` items, ordered by which article needs them first (publication date order):

1. **Mission Bay median sale price + days on market** — homes.co.nz / REINZ Auckland Regional Report — needed for article #1 (2026-08-27).
2. **Auckland region auction clearance rate, current** — REINZ Auckland Regional Report — needed for article #1 (2026-08-27) and reused in article #12 (2026-11-12).
3. **Kohimarama median sale price + price per m²** — homes.co.nz — needed for article #2 (2026-09-03).
4. **St Heliers median sale price + days on market** — homes.co.nz / REINZ — needed for article #3 (2026-09-10).
5. **Glendowie median sale price + Auckland Council CV cycle date** — homes.co.nz / Auckland Council — needed for article #4 (2026-09-17).
6. **AREINZ current definition/requirements** — REA (Real Estate Authority) — needed for article #5 (2026-09-24), also underpins Roman's credibility claims across every article.
7. **Selwyn College, St Thomas's, Kohimarama Intermediate zone boundary maps** — Ministry of Education enrolment scheme tool — needed for article #7 (2026-10-08), the first of four school-zone articles.
8. **In-zone vs out-of-zone comparable sale price data, Mission Bay** — homes.co.nz / REINZ — needed for article #7 (2026-10-08), then repeated for articles #8-10.
9. **Legal/compliance review of Overseas Investment Act rules as applied to this buyer segment** — needed for article #11 (2026-11-05); longest lead time item on this list, should start now given #11's compliance sensitivity (see Open Questions #3).
10. **Stats NZ / Auckland Council census data on Chinese community concentration, Mission Bay-Kohimarama-St Heliers-Glendowie corridor** — needed for article #11 (2026-11-05).
