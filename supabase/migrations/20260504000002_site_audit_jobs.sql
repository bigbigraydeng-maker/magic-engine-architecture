-- P8.0.4: Create site_audit_jobs table for async task tracking

create type job_status_enum as enum ('pending', 'in_progress', 'completed', 'failed');

create table if not exists site_audit_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  status job_status_enum not null default 'pending',

  -- Job configuration
  domain text not null,
  max_pages integer not null default 100,
  rate_limit_ms integer not null default 1000,

  -- Progress tracking
  total_urls_discovered integer default 0,
  total_urls_crawled integer default 0,
  total_pages_classified integer default 0,

  -- Error tracking
  error_message text,
  failed_urls text[] default '{}',

  -- Timestamps
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Indexes for query performance
create index idx_site_audit_jobs_client_id on site_audit_jobs(client_id);
create index idx_site_audit_jobs_status on site_audit_jobs(client_id, status);
create index idx_site_audit_jobs_created_at on site_audit_jobs(created_at desc);

-- Update trigger for updated_at
create or replace function update_site_audit_jobs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger site_audit_jobs_updated_at_trigger
before update on site_audit_jobs
for each row
execute function update_site_audit_jobs_updated_at();

-- Enable RLS
alter table site_audit_jobs enable row level security;

-- RLS Policy: Users can only see jobs for clients they have access to
create policy "Users can view site audit jobs"
  on site_audit_jobs for select
  using (
    auth.uid() in (select user_id from client_team where client_id = site_audit_jobs.client_id)
  );

create policy "Users can insert site audit jobs for their clients"
  on site_audit_jobs for insert
  with check (
    auth.uid() in (select user_id from client_team where client_id = site_audit_jobs.client_id)
  );

create policy "Users can update site audit jobs for their clients"
  on site_audit_jobs for update
  using (
    auth.uid() in (select user_id from client_team where client_id = site_audit_jobs.client_id)
  );
