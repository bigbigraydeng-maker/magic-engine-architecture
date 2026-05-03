-- HiBiz core schema (Phase 4 spec, MVP)
-- Run via Supabase CLI: supabase db push — or paste in SQL editor

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  status text not null default 'draft',
  primary_locale text not null default 'en-NZ',
  current_intent_id uuid,
  current_generation_id uuid,
  org_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now (),
  constraint projects_status_check check (
    status in (
      'draft',
      'intent_drafting',
      'intent_ready',
      'generating',
      'generation_failed',
      'ready_draft',
      'published'
    )
  )
);

create index if not exists idx_projects_user_updated on public.projects (user_id, updated_at desc)
where
  archived_at is null;

create table if not exists public.project_intents (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null references public.projects (id) on delete cascade,
  revision int not null,
  raw_prompt text not null,
  industry_hint text,
  compile_status text not null default 'pending',
  compiled jsonb,
  compiler_version text not null default 'compiler@0.1.0',
  compile_error jsonb,
  clarification jsonb,
  user_overrides jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now (),
  unique (project_id, revision),
  constraint project_intents_compile_status_check check (
    compile_status in ('pending', 'succeeded', 'failed', 'needs_clarification')
  )
);

create index if not exists idx_project_intents_project on public.project_intents (project_id, created_at desc);

alter table public.projects
drop constraint if exists projects_current_intent_id_fkey;

alter table public.projects
add constraint projects_current_intent_id_fkey foreign key (current_intent_id) references public.project_intents (id) on delete set null;

create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null references public.projects (id) on delete cascade,
  intent_id uuid not null references public.project_intents (id) on delete cascade,
  status text not null default 'queued',
  idempotency_key text,
  failure_code text,
  failure_detail jsonb,
  pipeline_meta jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now (),
  constraint generation_runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed'))
);

create unique index if not exists idx_generation_runs_idempotency on public.generation_runs (project_id, idempotency_key)
where
  idempotency_key is not null;

create index if not exists idx_generation_runs_project on public.generation_runs (project_id, created_at desc);

alter table public.projects
drop constraint if exists projects_current_generation_id_fkey;

alter table public.projects
add constraint projects_current_generation_id_fkey foreign key (current_generation_id) references public.generation_runs (id) on delete set null;

create table if not exists public.microsites (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null unique references public.projects (id) on delete cascade,
  slug text not null unique,
  draft_model jsonb not null default '{}'::jsonb,
  published_model jsonb,
  seo jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid (),
  project_id uuid not null references public.projects (id) on delete cascade,
  public_slug text not null unique,
  fields jsonb not null default '{"schema_version":1,"version":1,"fields":[]}'::jsonb,
  settings jsonb,
  status text not null default 'draft',
  embed_config jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint forms_status_check check (status in ('draft', 'active'))
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid (),
  form_id uuid not null references public.forms (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  payload jsonb not null,
  meta jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists idx_submissions_project on public.submissions (project_id, created_at desc);

create index if not exists idx_submissions_form on public.submissions (form_id, created_at desc);

-- Auto profile row
create or replace function public.handle_new_user () returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users for each row
execute procedure public.handle_new_user ();

-- updated_at on projects
create or replace function public.set_updated_at () returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;

create trigger projects_set_updated_at
before
update on public.projects for each row
execute procedure public.set_updated_at ();

-- RLS
alter table public.profiles enable row level security;

alter table public.projects enable row level security;

alter table public.project_intents enable row level security;

alter table public.generation_runs enable row level security;

alter table public.microsites enable row level security;

alter table public.forms enable row level security;

alter table public.submissions enable row level security;

create policy "profiles_select_own" on public.profiles for
select
  using (auth.uid () = user_id);

create policy "profiles_insert_own" on public.profiles for insert
with
  check (auth.uid () = user_id);

create policy "profiles_update_own" on public.profiles
for update
  using (auth.uid () = user_id);

create policy "projects_all_own" on public.projects for all using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

create policy "intents_via_project" on public.project_intents for all using (
  exists (
    select
      1
    from
      public.projects p
    where
      p.id = project_intents.project_id
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
        p.id = project_intents.project_id
        and p.user_id = auth.uid ()
    )
  );

create policy "runs_via_project" on public.generation_runs for all using (
  exists (
    select
      1
    from
      public.projects p
    where
      p.id = generation_runs.project_id
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
        p.id = generation_runs.project_id
        and p.user_id = auth.uid ()
    )
  );

create policy "microsites_via_project" on public.microsites for all using (
  exists (
    select
      1
    from
      public.projects p
    where
      p.id = microsites.project_id
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
        p.id = microsites.project_id
        and p.user_id = auth.uid ()
    )
  );

create policy "forms_via_project" on public.forms for all using (
  exists (
    select
      1
    from
      public.projects p
    where
      p.id = forms.project_id
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
        p.id = forms.project_id
        and p.user_id = auth.uid ()
    )
  );

create policy "submissions_select_via_project" on public.submissions for
select
  using (
    exists (
      select
        1
      from
        public.projects p
      where
        p.id = submissions.project_id
        and p.user_id = auth.uid ()
    )
  );

-- Inserts from public clients: use Edge Function + service role (bypasses RLS).
