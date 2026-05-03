-- HiBiz Sprint 1: project media library (media_assets + Storage bucket `media`)

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('upload', 'unsplash', 'ai_generated')),
  url text not null,
  thumbnail_url text,
  storage_path text,
  width int,
  height int,
  file_size_bytes int,
  mime_type text,
  unsplash_id text,
  unsplash_photographer text,
  unsplash_photographer_url text,
  unsplash_download_location text,
  ai_prompt text,
  ai_provider text,
  category text not null default 'general'
    check (
      category in ('general', 'hero', 'property', 'portrait', 'brand', 'poster', 'social')
    ),
  tags text[] not null default '{}',
  alt_text text,
  used_in text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_media_assets_project on public.media_assets (project_id);
create index if not exists idx_media_assets_category on public.media_assets (project_id, category);

alter table public.media_assets enable row level security;

create policy "Users see own project media"
  on public.media_assets for select
  using (auth.uid () = user_id);

create policy "Users insert own project media"
  on public.media_assets for insert
  with check (
    auth.uid () = user_id
    and exists (
      select 1
      from public.projects p
      where
        p.id = project_id
        and p.user_id = auth.uid ()
    )
  );

create policy "Users update own project media"
  on public.media_assets for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

create policy "Users delete own project media"
  on public.media_assets for delete
  using (auth.uid () = user_id);

-- Storage bucket: paths like {user_id}/{project_id}/{filename}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read"
  on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "media_authenticated_insert" on storage.objects;
create policy "media_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "media_authenticated_delete" on storage.objects;
create policy "media_authenticated_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
