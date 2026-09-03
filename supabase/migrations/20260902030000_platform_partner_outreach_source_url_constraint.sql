-- platform_partner_outreach: enforce "no verified status without a source_url"
-- at the database level (Codex review 2026-09-02, third pass).
--
-- sanitizePartnerCandidate() in src/lib/partner-outreach/types.ts is only a
-- TypeScript-level convenience — nothing stops a raw SQL insert, a future
-- import script, or an admin UI from writing official_partner_status
-- directly and skipping it entirely. A CHECK constraint is the one boundary
-- every write path (application code, Supabase Studio, a future MCP tool)
-- has to go through, so this is where "verified requires a source_url"
-- actually becomes unbypassable rather than merely documented.

create or replace function platform_partner_status_is_sourced(status jsonb)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
    from jsonb_each(coalesce(status, '{}'::jsonb)) as kv(platform, val)
    where val->>'status' = 'verified'
      and coalesce(trim(both from (val->>'source_url')), '') = ''
  );
$$;

comment on function platform_partner_status_is_sourced is
  'true unless official_partner_status has a platform marked verified with no (or blank) source_url — backs the platform_partner_outreach CHECK constraint of the same intent.';

alter table platform_partner_outreach
  add constraint official_partner_status_requires_source
  check (platform_partner_status_is_sourced(official_partner_status));
