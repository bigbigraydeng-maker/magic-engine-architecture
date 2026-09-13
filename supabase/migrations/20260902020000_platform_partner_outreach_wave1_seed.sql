-- Platform Partner Outreach — wave-1 + remaining researched candidates (2026-09-02)
-- Generated from src/lib/partner-outreach/score.ts + outreach.ts — run in Supabase Studio SQL Editor.
-- Wave-1 rows (status=drafted) carry a real email_subject/email_body; the rest are status=discovered.
insert into platform_partner_outreach
  (company_name, country, website, domain, platforms, official_partner_status,
   contact_email, contact_source, fit_score, score_breakdown, priority,
   b2b_partnership, white_label, support_escalation, training_access, event_access, branding_rights,
   commercial_model, email_subject, email_body, status, notes, source_urls, last_verified_at)
values
  ('Adhesion', 'NZ', 'https://www.adhesion.co.nz', 'adhesion.co.nz', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Auckland, NZ; media-buying-only; self-links a Meta partner-directory ID but the page is login-walled', ARRAY['https://www.adhesion.co.nz/about-us/meta-facebook-partner']::text[], now()),
  ('Carter Media', 'AU', 'https://cartermedia.com.au', 'cartermedia.com.au', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, 'info@cartermedia.com.au', 'website', 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'AU; media-buying-only', ARRAY['https://cartermedia.com.au/meta-ads-agency']::text[], now()),
  ('Emote Digital', 'AU', 'https://www.emotedigital.com.au', 'emotedigital.com.au', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Melbourne, AU; self-claim only, no badge or directory link', ARRAY['https://www.emotedigital.com.au/digital-marketing-agency-melbourne/meta-partner/']::text[], now()),
  ('GMS Media Group', 'AU', 'https://gmsmediagroup.com', 'gmsmediagroup.com', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Sydney AU + Waikato NZ offices; media-buying-only', ARRAY['https://gmsmediagroup.com/gms-media-group-is-now-a-meta-business-partner/']::text[], now()),
  ('Patch Agency', 'AU', 'https://patchagency.com.au', 'patchagency.com.au', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, 'info@patchagency.com.au', 'website', 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Brisbane, AU; media-buying-only', ARRAY['https://patchagency.com.au/services/meta-advertising/']::text[], now()),
  ('Innovate Digital', 'NZ', 'https://innovatedigital.nz', 'innovatedigital.nz', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Christchurch, NZ; self-claim only, no badge or directory link', ARRAY['https://innovatedigital.nz/services/meta-ads']::text[], now()),
  ('Lucid Leads', 'NZ', 'https://www.lucidleads.co.nz', 'lucidleads.co.nz', ARRAY['meta']::text[], '{"meta":{"status":"unverified"}}'::jsonb, 'jason@lucidleadsnz.co.nz', 'website', 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Auckland, NZ; page shows a Google Partner badge but no matching Meta badge — weaker evidence than the self-claim text alone', ARRAY['https://www.lucidleads.co.nz/services/meta-ads-auckland/']::text[], now()),
  ('Soul+Wolf', 'AU', 'https://soulandwolf.com.au', 'soulandwolf.com.au', ARRAY['meta','tiktok']::text[], '{"meta":{"status":"unverified"},"tiktok":{"status":"unverified"}}'::jsonb, 'hello@soulandwolf.com.au', 'website', 8, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":3,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'South Melbourne, AU; media-buying/performance-focused on both platforms; no badge or directory link for either claim', ARRAY['https://soulandwolf.com.au/pages/meta-ads','https://soulandwolf.com.au/pages/tiktok']::text[], now()),
  ('Globital', 'AU', 'https://www.globitalmarketing.com.au', 'globitalmarketing.com.au', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://www.globitalmarketing.com/au/white-label-pay-per-click-ppc-resellers-program/"}}'::jsonb, 'aus@globitalmarketing.com', 'search result, not verbatim-verified on page', 42, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":15,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'yes', 'yes', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Globital', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We saw that Globital runs a White Label PPC Resellers Program as a Google Premier Partner.
A reseller program like that lines up closely with the agency-to-agency partnership we''re exploring.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Globital while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'Robina, QLD, AU; explicit white-label PPC reseller program — closest match to ME upstream-partner ask', ARRAY['https://www.globitalmarketing.com/au/white-label-pay-per-click-ppc-resellers-program/']::text[], now()),
  ('Blue Water Digital', 'AU', 'https://bluewater.digital', 'bluewater.digital', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://bluewater.digital/services/white-label-google-ads-management/"}}'::jsonb, 'info@bluewaterdigital.com.au', 'search result, not verbatim-verified on page', 42, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":15,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'yes', 'yes', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Blue Water Digital', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We noticed Blue Water Digital runs a white-label Google Ads management program for other agencies, alongside your Google Ads Partner status.
That existing agency-to-agency structure looks like a strong starting point for the kind of upstream platform partnership we''re building.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Blue Water Digital while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'Western Sydney/Penrith, AU; badge says "Google Ads Partner Agency" (standard tier, not Premier); explicit white-label program for other agencies', ARRAY['https://bluewater.digital/services/white-label-google-ads-management/']::text[], now()),
  ('Four Dots', 'AU', 'https://fourdots.com', 'fourdots.com', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://fourdots.com/white-label-seo-services"}}'::jsonb, null, null, 42, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":15,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'yes', 'yes', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Four Dots', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We noticed Four Dots is a Google Premier Partner offering white-label SEO to agencies internationally, including from your Sydney office.
That agency-scaling model is close to the upstream partnership we''re building across AU/NZ.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Four Dots while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU (Sydney office); Premier Partner (top 3%); white-label SEO for agencies — BUT multi-national HQ (New York/Belgrade/Novi Sad/Sydney/Hong Kong), Sydney is one of five offices, not a single AU/NZ HQ', ARRAY['https://fourdots.com/white-label-seo-services']::text[], now()),
  ('SimplySEO', 'NZ', 'https://www.simplyseo.nz', 'simplyseo.nz', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://www.simplyseo.nz/white-label-google-ads/"}}'::jsonb, 'admin@simplyseo.nz', 'website footer, plaintext', 42, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":15,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'yes', 'yes', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / SimplySEO', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We came across SimplySEO''s white-label Google Ads service for agencies across New Zealand, alongside your Google Partner status.
That agency-facing offering is exactly the kind of upstream relationship we''re looking to build in New Zealand.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across SimplySEO while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'NZ; NZ-wide white-label Google Ads for agencies; badge present but Premier vs standard tier not stated on page', ARRAY['https://www.simplyseo.nz/white-label-google-ads/']::text[], now()),
  ('SearchMax', 'AU', 'https://www.searchmax.com.au', 'searchmax.com.au', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://www.searchmax.com.au/searchmax-among-the-top-3-of-google-partners-in-the-country/"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / SearchMax', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We saw that SearchMax has held Google Premier Partner status since 2017 and ranks among the top 3% of Google Partners in the country.
That level of platform standing is exactly what we''re looking for in an upstream Google partner relationship.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across SearchMax while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU; Premier Partner top 3%; nav has an "Agency Partnerships" link but the page 404s; media-buying-oriented', ARRAY['https://www.searchmax.com.au/searchmax-among-the-top-3-of-google-partners-in-the-country/']::text[], now()),
  ('Online Marketing Gurus', 'AU', 'https://www.onlinemarketinggurus.com.au', 'onlinemarketinggurus.com.au', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://www.onlinemarketinggurus.com.au/"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'AU; Premier 2026 badge; media-buying-only (SEO/PPC/social)', ARRAY['https://www.onlinemarketinggurus.com.au/']::text[], now()),
  ('Unbound', 'NZ', 'https://www.unbound.nz', 'unbound.nz', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://www.unbound.nz/google-ads/unbound-named-among-top-3-of-nz-agencies-as-2026-google-premier-partner/"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Unbound', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We noticed Unbound was named among the top 3% of NZ agencies as a 2026 Google Premier Partner.
That platform standing in the New Zealand market is directly relevant to the partner ecosystem we''re building here.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Unbound while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'NZ; Premier Partner, top 3% NZ; media-buying-only', ARRAY['https://www.unbound.nz/google-ads/unbound-named-among-top-3-of-nz-agencies-as-2026-google-premier-partner/']::text[], now()),
  ('Search Republic', 'NZ', 'https://searchrepublic.co.nz', 'searchrepublic.co.nz', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://searchrepublic.co.nz/search-republic-your-google-premier-partner/"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'NZ; Premier Partner; media-buying-only; /contact/ page 404s, verify contact route manually', ARRAY['https://searchrepublic.co.nz/search-republic-your-google-premier-partner/']::text[], now()),
  ('Conversion Marketing', 'NZ', 'https://conversionmarketing.co.nz', 'conversionmarketing.co.nz', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://conversionmarketing.co.nz/conversion-marketing-google-premier-partner-status-2026/"}}'::jsonb, 'info@conversionmarketing.co.nz', 'website footer, plaintext', 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Takapuna, Auckland, NZ; Premier Partner; media-buying-only', ARRAY['https://conversionmarketing.co.nz/conversion-marketing-google-premier-partner-status-2026/']::text[], now()),
  ('Google Ads Guy (Crystal Marketing)', 'AU', 'https://googleadguy.com.au', 'googleadguy.com.au', ARRAY['google']::text[], '{"google":{"status":"verified","source_url":"https://googleadguy.com.au"}}'::jsonb, 'hello@crystalmarketing.com.au', 'website', 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'AU; 2026 Premier Partner, top 3% AU; media-buying-only', ARRAY['https://googleadguy.com.au']::text[], now()),
  ('The Pistol', 'AU', 'https://thepistol.com.au', 'thepistol.com.au', ARRAY['tiktok']::text[], '{"tiktok":{"status":"verified","source_url":"https://partners.tiktok.com/partner-details/7289198090165157890/pc/en"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / The Pistol', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We found The Pistol listed on TikTok''s official Partner Directory, including as one of the first TikTok Data Connection Developers.
Given that platform-level standing, we''d value understanding how a partnership with TikTok Marketing Partners like The Pistol works from the outside.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across The Pistol while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU; listed on TikTok’s own Partner Directory; first-wave TikTok Data Connection Developer (2024); strongest official-source evidence in the batch', ARRAY['https://partners.tiktok.com/partner-details/7289198090165157890/pc/en','https://ads.tiktok.com/business/en/blog/badged-agency-marketing-partners','https://www.bandt.com.au/the-pistol-announced-as-tiktok-marketing-partner/']::text[], now()),
  ('Alpha Digital', 'AU', 'https://www.alphadigital.com.au', 'alphadigital.com.au', ARRAY['tiktok']::text[], '{"tiktok":{"status":"verified","source_url":"https://partners.tiktok.com/partner-details/7095898843165753346"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Alpha Digital', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We came across Alpha Digital''s listing on TikTok''s official Marketing Partner Directory.
As a full-service digital agency with that platform standing, you seemed like a natural fit to ask how TikTok partner arrangements with other agencies typically work.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Alpha Digital while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU; listed on TikTok’s own Partner Directory + own LinkedIn announcement; full-service digital agency, not pure media-buying', ARRAY['https://partners.tiktok.com/partner-details/7095898843165753346']::text[], now()),
  ('We The People', 'AU', 'https://www.wethepeople.com.au', 'wethepeople.com.au', ARRAY['tiktok']::text[], '{"tiktok":{"status":"verified","source_url":"https://mumbrella.com.au/tiktok-badge-we-the-people-as-tiktok-marketing-partner-722370"}}'::jsonb, null, null, 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / We The People', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We saw that TikTok badged We The People as a Marketing Partner, and that your team also serves the New Zealand market.
That dual AU/NZ presence and TikTok partner standing is directly relevant to the upstream partnership we''re building across both markets.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across We The People while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU HQ + Auckland NZ team; independent media (Mumbrella) confirms TikTok badged them; NZ-specific claim is self-reported only', ARRAY['https://mumbrella.com.au/tiktok-badge-we-the-people-as-tiktok-marketing-partner-722370']::text[], now()),
  ('Growth Huntr', 'AU', 'https://growthhuntr.com', 'growthhuntr.com', ARRAY['tiktok']::text[], '{"tiktok":{"status":"verified","source_url":"https://ads.tiktok.com/business/en/blog/badged-agency-marketing-partners"}}'::jsonb, 'harry@ghuntr.com', 'website contact page', 27, '[{"signal":"official_platform_status","points":20,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, 'Partnership enquiry — Magic Engine / Growth Huntr', 'Hi team,

I''m reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.

We noticed Growth Huntr is listed on TikTok''s official blog as a Badged Agency Marketing Partner for the APAC region.
That official standing made you one of the clearer TikTok partner candidates we found in Australia.

We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner that may be able to provide some combination of: platform escalation and support; partner education and training; access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a clearly defined and compliant partnership relationship.

Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?

We would also be interested to understand:
- which Meta, Google and/or TikTok partner programs you currently participate in;
- what platform support or escalation capabilities may extend to your downstream partners;
- whether our team could access partner training or events;
- how Magic Engine would be permitted to describe the relationship publicly; and
- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.

We would be happy to arrange a short introductory call if this is something your team supports.

Best regards,
Big Ray Deng
Magic Engine
Australia & New Zealand

We came across Growth Huntr while researching upstream platform partners in AU/NZ. If this isn''t the right fit or the right contact, just let us know and we won''t follow up further.', 'drafted', 'AU; TikTok official blog lists as APAC Badged Agency Partner (Australia); media-buying-only (Meta/Google/TikTok/Pinterest account management)', ARRAY['https://ads.tiktok.com/business/en/blog/badged-agency-marketing-partners']::text[], now()),
  ('Megaphone', 'AU', 'https://megaphone.com.au', 'megaphone.com.au', ARRAY['tiktok']::text[], '{"tiktok":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Cremorne VIC, AU; claims "TikTok Gold Partner" — a tier name not found in TikTok’s public program naming, likely conflating Academy training completion with partner status; mixed third-party reviews', ARRAY['https://megaphone.com.au/tiktok-growth-agency/','https://megaphone.com.au/services/tiktok-advertising/']::text[], now()),
  ('Creative Converters', 'AU', 'https://www.creativeconverters.com', 'creativeconverters.com', ARRAY['tiktok']::text[], '{"tiktok":{"status":"unverified"}}'::jsonb, null, null, 7, '[{"signal":"official_platform_status","points":0,"max":20},{"signal":"support_escalation","points":0,"max":25},{"signal":"training_or_event_access","points":0,"max":15},{"signal":"b2b_partnership","points":0,"max":15},{"signal":"branding_rights","points":0,"max":10},{"signal":"au_nz_presence","points":5,"max":5},{"signal":"commercial_flexibility","points":0,"max":5},{"signal":"multi_platform_capability","points":2,"max":5}]'::jsonb, 'none', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', '{"pricing_status":"unknown"}'::jsonb, null, null, 'discovered', 'Melbourne, AU; appears in a TikTok case-study page but not the badged-partner listing; scraped contact email looked malformed (domain concatenation artifact), needs manual lookup', ARRAY['https://www.creativeconverters.com/','https://ads.tiktok.com/business/en-AU/inspiration/creative-converters']::text[], now())
on conflict (domain) where domain is not null do nothing;
