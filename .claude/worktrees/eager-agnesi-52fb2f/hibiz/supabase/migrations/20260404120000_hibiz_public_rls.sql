-- Public read paths + anonymous lead inserts (Phase: publish & live site)

-- Anonymous can read published microsite rows (RLS ORs with owner policies).
-- App should query only safe columns; prefer view below for defense in depth.
create policy "microsites_public_select" on public.microsites for
select
  to anon,
  authenticated using (
    published_at is not null
    and published_model is not null
  );

-- Published-only projection (no draft_model) for API consumers
create or replace view public.microsites_published with (security_invoker = true) as
select
  id,
  project_id,
  slug,
  published_model,
  seo,
  published_at
from
  public.microsites
where
  published_at is not null
  and published_model is not null;

comment on view public.microsites_published is 'Safe columns for public rendering; RLS on microsites still applies.';

grant select on public.microsites_published to anon, authenticated;

-- Active forms on projects that already have a published microsite
create policy "forms_public_select" on public.forms for
select
  to anon,
  authenticated using (
    status = 'active'
    and exists (
      select
        1
      from
        public.microsites m
      where
        m.project_id = forms.project_id
        and m.published_at is not null
        and m.published_model is not null
    )
  );

-- Visitor submissions (no service role required)
create policy "submissions_public_insert" on public.submissions for insert to anon, authenticated
with
  check (
    exists (
      select
        1
      from
        public.forms f
        inner join public.microsites m on m.project_id = f.project_id
      where
        f.id = submissions.form_id
        and f.project_id = submissions.project_id
        and f.status = 'active'
        and m.published_at is not null
        and m.published_model is not null
    )
  );
