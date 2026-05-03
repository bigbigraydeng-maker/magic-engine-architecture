-- Social posts (project-owned) + public microsite visit analytics + poster storage bucket

-- ─── social_posts ─────────────────────────────────────────────
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null references public.projects (id) on delete cascade,
  content_type text not null,
  captions jsonb not null default '{}'::jsonb,
  poster_url text,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint social_posts_content_type_check check (
    content_type in (
      'just_listed',
      'just_sold',
      'open_home',
      'market_update',
      'buying_tips'
    )
  ),
  constraint social_posts_status_check check (status in ('active', 'deleted'))
);

create index if not exists idx_social_posts_project_created on public.social_posts (project_id, created_at desc)
where
  deleted_at is null;

-- ─── site_visits ──────────────────────────────────────────────
create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid (),
  microsite_id uuid not null references public.microsites (id) on delete cascade,
  path text not null,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  user_agent text,
  visited_at timestamptz not null default now ()
);

create index if not exists idx_site_visits_microsite_visited on public.site_visits (microsite_id, visited_at desc);

-- ─── RLS ─────────────────────────────────────────────────────
alter table public.social_posts enable row level security;

alter table public.site_visits enable row level security;

create policy "social_posts_owner_all" on public.social_posts for all to authenticated using (
  exists (
    select
      1
    from
      public.projects p
    where
      p.id = social_posts.project_id
      and p.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.projects p
      where
        p.id = social_posts.project_id
        and p.user_id = auth.uid ()
    )
  );

-- Anonymous / logged-in visitors: insert only for published microsites
create policy "site_visits_public_insert" on public.site_visits for insert to anon, authenticated
with
  check (
    exists (
      select
        1
      from
        public.microsites m
      where
        m.id = site_visits.microsite_id
        and m.published_at is not null
        and m.published_model is not null
    )
  );

-- Project owners read their microsite visits
create policy "site_visits_select_owner" on public.site_visits for
select
  to authenticated using (
    exists (
      select
        1
      from
        public.microsites m
        inner join public.projects p on p.id = m.project_id
      where
        m.id = site_visits.microsite_id
        and p.user_id = auth.uid ()
    )
  );

-- ─── Storage: social-posters ───────────────────────────────────
insert into
  storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'social-posters',
    'social-posters',
    true,
    6291456,
    array['image/png', 'image/jpeg', 'image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "social_posters_public_read" on storage.objects;

create policy "social_posters_public_read" on storage.objects for
select
  using (bucket_id = 'social-posters');

drop policy if exists "social_posters_authenticated_insert" on storage.objects;

create policy "social_posters_authenticated_insert" on storage.objects for insert to authenticated
with
  check (bucket_id = 'social-posters');

drop policy if exists "social_posters_authenticated_update" on storage.objects;

create policy "social_posters_authenticated_update" on storage.objects
for update
  to authenticated using (bucket_id = 'social-posters')
with
  check (bucket_id = 'social-posters');

drop policy if exists "social_posters_authenticated_delete" on storage.objects;

create policy "social_posters_authenticated_delete" on storage.objects for delete to authenticated using (bucket_id = 'social-posters');
