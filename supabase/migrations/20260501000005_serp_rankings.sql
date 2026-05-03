-- P8.7: SERP Intelligence (Google Rank Tracker)

-- SERP rankings table (keyword rankings over time)
create table if not exists serp_rankings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  position int, -- 1-100+, NULL if not ranking
  search_volume int, -- Monthly search volume
  url text, -- Landing page URL for this keyword
  snippet text, -- Google snippet (if available)
  date date not null, -- Snapshot date (daily)
  created_at timestamptz default now(),

  constraint serp_rankings_unique_per_client_keyword_date
    unique(client_id, keyword, date)
);

-- SERP ranking history view (for trend analysis)
create table if not exists serp_ranking_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  position_start int, -- Position 4 weeks ago
  position_current int, -- Latest position
  position_change int, -- Movement (can be negative)
  date_start date, -- Start date of trend window
  date_end date, -- End date of trend window
  is_new boolean default false, -- Started ranking in this window
  is_lost boolean default false, -- Stopped ranking in this window
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint serp_history_unique_per_client_keyword
    unique(client_id, keyword, date_end)
);

-- Trigger for updated_at
create trigger serp_history_updated_at
  before update on serp_ranking_history
  for each row
  execute function update_updated_at_column();

-- Indexes for performance
create index idx_serp_rankings_client on serp_rankings(client_id);
create index idx_serp_rankings_keyword on serp_rankings(keyword);
create index idx_serp_rankings_date on serp_rankings(date);
create index idx_serp_history_client_keyword on serp_ranking_history(client_id, keyword);
create index idx_serp_history_date_end on serp_ranking_history(date_end);

-- RLS (enable row level security)
alter table serp_rankings enable row level security;
alter table serp_ranking_history enable row level security;

-- RLS policies (admin write; client read own)
create policy serp_rankings_admin_write
  on serp_rankings for insert
  with check (true);

create policy serp_history_admin_write
  on serp_ranking_history for insert
  with check (true);
