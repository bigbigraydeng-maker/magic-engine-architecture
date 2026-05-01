-- P8.6: Link Intelligence (DataForSEO backlinks data)

-- Create trigger function for updated_at timestamp (if not exists)
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Main backlinks table (snapshot-based, updated weekly)
create table if not exists backlink_data (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  target_domain text not null, -- e.g., "ctstours.co.nz"
  referring_domain text not null,
  referring_url text not null,
  anchor_text text,
  tld_rank int, -- Domain Rank of the referring domain (1-100)
  citation_flow int, -- Citation Flow from Majestic (1-100)
  trust_flow int, -- Trust Flow from Majestic (1-100)
  last_seen_date date,
  link_type text, -- 'do-follow' | 'no-follow' | 'internal'
  page_rank int,
  image_alt text,
  status_code int, -- HTTP status of referring page
  first_seen_date date,
  is_new boolean default false,
  is_lost boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint backlink_data_unique_per_client
    unique(client_id, target_domain, referring_url)
);

-- Link velocity snapshot (tracks gain/loss over time)
create table if not exists backlink_velocity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  target_domain text not null,
  snapshot_date date not null,
  total_backlinks int,
  new_backlinks int,
  lost_backlinks int,
  referring_domains_count int,
  avg_domain_rank numeric,
  created_at timestamptz default now(),

  constraint backlink_velocity_unique_per_client_domain_date
    unique(client_id, target_domain, snapshot_date)
);

-- Competitor backlinks comparison (for market baseline)
create table if not exists competitor_backlinks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  competitor_domain text not null,
  total_backlinks int,
  referring_domains_count int,
  avg_domain_rank numeric,
  snapshot_date date not null,
  created_at timestamptz default now(),

  constraint competitor_backlinks_unique
    unique(client_id, competitor_domain, snapshot_date)
);

-- Indexes for performance
create index idx_backlink_data_client on backlink_data(client_id);
create index idx_backlink_data_domain on backlink_data(target_domain);
create index idx_backlink_data_referring on backlink_data(referring_domain);
create index idx_backlink_velocity_client_date on backlink_velocity(client_id, snapshot_date);
create index idx_competitor_backlinks_client_date on competitor_backlinks(client_id, snapshot_date);

-- Updated_at trigger
create trigger backlink_data_updated_at
  before update on backlink_data
  for each row
  execute function update_updated_at_column();

-- RLS policies (admin only for writes; clients can read own data)
alter table backlink_data enable row level security;
alter table backlink_velocity enable row level security;
alter table competitor_backlinks enable row level security;

create policy backlink_data_admin_write
  on backlink_data for insert
  with check (true);

create policy backlink_velocity_admin_write
  on backlink_velocity for insert
  with check (true);

create policy competitor_backlinks_admin_write
  on competitor_backlinks for insert
  with check (true);
