# HiBiz Supabase 迁移 — 手动执行步骤

## 快速开始

1. 登录 https://supabase.com/dashboard → 选择项目 `ouyutdtyxxrefvzfbhib`
2. 左侧菜单 → **SQL Editor**
3. 新建查询 → 逐个粘贴下面的 4 段 SQL → 执行

---

## 迁移 1️⃣：核心表与 RLS（20260403120000_init_hibiz.sql）

```sql
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
```

✅ 执行完毕后继续下一个迁移

---

## 迁移 2️⃣：公开读 + 匿名提交（20260404120000_hibiz_public_rls.sql）

```sql
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
```

✅ 执行完毕后继续下一个迁移

---

## 迁移 3️⃣：限流函数（20260404200000_hibiz_lead_rate_limit_fn.sql）

```sql
-- Allow anonymous lead submission rate checks without exposing row contents (RLS blocks SELECT for anon).

create or replace function public.check_lead_rate_limit (p_form_id uuid, p_ip_hash text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hour_count int;
  ip_recent int;
begin
  if p_form_id is null or p_ip_hash is null or length(p_ip_hash) < 8 then
    return false;
  end if;

  /* Only count submissions for forms that are active on a published microsite (same rule as insert policy). */
  if not exists (
    select
      1
    from
      public.forms f
      inner join public.microsites m on m.project_id = f.project_id
    where
      f.id = p_form_id
      and f.status = 'active'
      and m.published_at is not null
      and m.published_model is not null
  ) then
    return false;
  end if;

  select
    count(*)::int into hour_count
  from
    public.submissions s
  where
    s.form_id = p_form_id
    and s.created_at > now() - interval '1 hour';

  if hour_count >= 80 then
    return false;
  end if;

  select
    count(*)::int into ip_recent
  from
    public.submissions s
  where
    s.form_id = p_form_id
    and s.created_at > now() - interval '10 minutes'
    and coalesce(s.meta ->> 'ip_hash', '') = p_ip_hash;

  if ip_recent >= 10 then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.check_lead_rate_limit is 'Returns true if a new public lead may be inserted (caps per form / per IP hash).';

revoke all on function public.check_lead_rate_limit (uuid, text) from public;

grant execute on function public.check_lead_rate_limit (uuid, text) to anon, authenticated;
```

✅ 执行完毕后继续下一个迁移

---

## 迁移 4️⃣：商家资料字段（20260405120000_merchant_profile.sql）

```sql
-- Merchant-facing contact + property promo (poster inputs). Stored on microsites so public published pages can read it via view.

alter table public.microsites
add column if not exists merchant_profile jsonb default null;

comment on column public.microsites.merchant_profile is 'v1: contact (phone, email, address) + property_promo (headline, details, image_url, trademe_url). No listing feed — manual promo only.';

drop view if exists public.microsites_published;

create view public.microsites_published with (security_invoker = true) as
select
  id,
  project_id,
  slug,
  published_model,
  seo,
  published_at,
  merchant_profile
from
  public.microsites
where
  published_at is not null
  and published_model is not null;

comment on view public.microsites_published is 'Safe columns for public rendering; includes merchant_profile for contact/poster data.';

grant select on public.microsites_published to anon, authenticated;
```

✅ 全部完成！

---

## 验证

执行以下 SQL 验证迁移成功：

```sql
-- 检查表是否存在
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 检查视图
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public';

-- 检查函数
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public';
```

应该看到：
- ✅ 表：profiles, projects, project_intents, generation_runs, microsites, forms, submissions
- ✅ 视图：microsites_published
- ✅ 函数：handle_new_user, set_updated_at, check_lead_rate_limit

---

## 完成后

1. 关闭此文件
2. 回到 Cursor 实现 **TradeMe 提取优化** 三个功能
3. 推送到 main → Render 自动部署

