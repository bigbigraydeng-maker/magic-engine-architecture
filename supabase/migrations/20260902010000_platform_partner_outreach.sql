-- platform_partner_outreach: ME's own upstream B2B channel-partner outreach
-- pipeline (Meta / Google / TikTok official partners in AU/NZ). Internal
-- ops tool — this is ME prospecting for ITS OWN vendor/platform partners,
-- not a client-facing capability. No client_id: rows belong to ME, not to
-- any client's data.
--
-- Deliberately a SEPARATE table from outbound_prospects (Phase 35 client
-- prospecting): outbound_prospects' target entity is "will this business
-- become an ME CLIENT" (converted_client_id -> clients(id), dedup key
-- place_id, strength signals rating/review_count). This table's target
-- entity is "will this company become an ME UPSTREAM PARTNER" — no
-- Google-Places identity, no client conversion, and a fully different set
-- of commercial/partnership fields (branding rights, escalation support,
-- revenue share). Merging the two would overload converted_client_id and
-- the status vocabulary with two incompatible meanings; the reusable part
-- (status-machine / rule score / AI draft / human-approval-before-send /
-- opted_out terminal state / RLS template) is the *pattern*, copied here,
-- not the table itself.
--
-- RLS: written directly as `FOR ALL TO service_role` from the start.
-- outbound_prospects' original migration (20260706000001) omitted
-- `TO service_role` and needed a same-day production fix six weeks later
-- (20260803020000_rls_lock_policies_to_service_role.sql, 2,678 anon-readable
-- rows) — that mistake is not repeated here.

create table if not exists platform_partner_outreach (
  id                    uuid primary key default gen_random_uuid(),

  -- Step 1: candidate identity
  company_name          text        not null,
  country               text        not null check (country in ('AU', 'NZ')),
  website               text,
  domain                text,                              -- normalized (lowercase, no www/protocol) — dedup key

  -- Step 2: platform partner status — status must never be 'verified'
  -- without a source_url; see assertOfficialSourced() in
  -- src/lib/partner-outreach/types.ts, which enforces this before any row
  -- is written (a self-reported "we're a Meta agency" claim is NOT enough).
  -- Shape: { meta?: {status, source_url?}, google?: {...}, tiktok?: {...} }
  platforms             text[]      not null default '{}',  -- subset of meta|google|tiktok actually pursued
  official_partner_status jsonb     not null default '{}'::jsonb,

  -- Step 3: contact
  contact_name          text,
  contact_role          text,
  contact_email         text,
  contact_source        text,                              -- where the email/contact was found

  -- Step 4: qualification (see src/lib/partner-outreach/score.ts)
  fit_score             integer,                            -- 0-100
  score_breakdown       jsonb,
  priority              text check (priority in ('A', 'B', 'C', 'none')),

  b2b_partnership       text        not null default 'unknown' check (b2b_partnership in ('yes', 'no', 'unknown')),
  white_label           text        not null default 'unknown' check (white_label in ('yes', 'no', 'unknown')),
  support_escalation    text        not null default 'unknown' check (support_escalation in ('yes', 'no', 'unknown')),
  training_access       text        not null default 'unknown' check (training_access in ('yes', 'no', 'unknown')),
  event_access          text        not null default 'unknown' check (event_access in ('yes', 'no', 'unknown')),
  branding_rights       text        not null default 'unknown' check (branding_rights in ('yes', 'no', 'unknown')),
  partner_manager       text,

  -- Commercial terms — never inferred/estimated by AI (spec §19). Each
  -- sub-field null until the company states it in writing; pricing_status
  -- records which case we're in instead of guessing a number.
  commercial_model      jsonb       not null default '{"pricing_status": "unknown"}'::jsonb,

  -- Step 5: outreach draft (never auto-sent — see src/lib/partner-outreach/outreach.ts)
  email_subject         text,
  email_body            text,

  status                text        not null default 'discovered'
    check (status in ('discovered', 'qualified', 'drafted', 'approved', 'sent',
                      'replied', 'follow_up_1', 'follow_up_2',
                      'closed_won', 'closed_lost', 'opted_out')),
  delivery_status        text,
  reply_status            text,
  reply_category          text check (reply_category in ('A', 'B', 'C', 'D', 'E')),
  follow_up_due_at        timestamptz,
  follow_up_count         integer     not null default 0,

  notes                  text,
  source_urls            text[]      not null default '{}',
  last_verified_at        timestamptz,

  created_at             timestamptz not null default now(),
  sent_at                 timestamptz,
  updated_at              timestamptz not null default now()
);

-- Dedup: one row per company domain (spec §14 — first wave contacts a
-- company at most once). Partial index so candidates discovered before a
-- domain is resolved don't collide on null.
create unique index if not exists platform_partner_outreach_domain
  on platform_partner_outreach (domain) where domain is not null;

create index if not exists platform_partner_outreach_status_priority
  on platform_partner_outreach (status, priority, fit_score desc nulls last);
create index if not exists platform_partner_outreach_follow_up_due
  on platform_partner_outreach (follow_up_due_at) where follow_up_due_at is not null;

comment on table  platform_partner_outreach is 'ME''s own upstream Meta/Google/TikTok platform-partner outreach pipeline (internal BD tool, not client data)';
comment on column platform_partner_outreach.status is 'discovered | qualified | drafted | approved | sent | replied | follow_up_1 | follow_up_2 | closed_won | closed_lost | opted_out (permanent do-not-contact)';
comment on column platform_partner_outreach.official_partner_status is 'per-platform {status: verified|unverified|unknown, source_url}; verified requires source_url — see assertOfficialSourced()';
comment on column platform_partner_outreach.commercial_model is '{monthly_fee, annual_fee, minimum_spend, minimum_accounts, revenue_share, retainer, onboarding_fee, contract_length, pricing_status: stated|contact_required|unknown} — never AI-estimated';

alter table platform_partner_outreach enable row level security;
do $$ begin
  create policy "service_role_full" on platform_partner_outreach for all to service_role using (true);
exception when duplicate_object then null; end $$;
