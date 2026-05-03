-- P8.0.1: Create client_site_pages table for DNZ (Domain Snapshot) collection

create type page_type_enum as enum ('landing', 'product', 'service', 'blog', 'contact', 'about', 'other');

create table if not exists client_site_pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  url text not null,
  page_type page_type_enum not null default 'other',
  topics text[] default '{}',
  primary_keyword text,
  word_count integer,
  has_geo_block boolean default false,
  title text,
  markdown_content text,
  crawled_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  -- Unique constraint: one URL per client
  unique(client_id, url)
);

-- Indexes for query performance
create index idx_client_site_pages_client_id on client_site_pages(client_id);
create index idx_client_site_pages_client_page_type on client_site_pages(client_id, page_type);
create index idx_client_site_pages_updated_at on client_site_pages(updated_at);

-- Update trigger for updated_at
create or replace function update_client_site_pages_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger client_site_pages_updated_at_trigger
before update on client_site_pages
for each row
execute function update_client_site_pages_updated_at();

-- Enable RLS
alter table client_site_pages enable row level security;

-- RLS Policy: Users can only see pages for clients they have access to
create policy "Users can view client site pages"
  on client_site_pages for select
  using (
    auth.uid() in (select user_id from client_team where client_id = client_site_pages.client_id)
  );

create policy "Users can insert client site pages for their clients"
  on client_site_pages for insert
  with check (
    auth.uid() in (select user_id from client_team where client_id = client_site_pages.client_id)
  );

create policy "Users can update client site pages for their clients"
  on client_site_pages for update
  using (
    auth.uid() in (select user_id from client_team where client_id = client_site_pages.client_id)
  );

create policy "Users can delete client site pages for their clients"
  on client_site_pages for delete
  using (
    auth.uid() in (select user_id from client_team where client_id = client_site_pages.client_id)
  );
