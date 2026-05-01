-- P8.8: Local Visibility (Google Local Pack rankings)

-- Location codes mapping for AU/NZ cities
-- AU: Sydney (2036), Melbourne (2157), Brisbane (2174), Perth (2190), Adelaide (2091), Hobart (2147)
-- NZ: Auckland (2554), Wellington (2579), Christchurch (2555), Dunedin (2556)

-- Local SERP rankings table (rankings in specific cities)
create table if not exists local_serp_rankings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  city_name text not null, -- e.g., "Sydney", "Auckland"
  location_code int not null, -- DataForSEO location code
  country_code text not null, -- "AU" or "NZ"
  position int, -- 1-10 (Local Pack), NULL if not in pack
  date date not null, -- Snapshot date
  created_at timestamptz default now(),

  constraint local_rankings_unique
    unique(client_id, keyword, location_code, date)
);

-- Local ranking history (trends by city/keyword)
create table if not exists local_ranking_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  location_code int not null,
  city_name text not null,
  position_start int, -- Position 28 days ago
  position_current int, -- Latest position
  position_change int,
  date_start date,
  date_end date,
  is_new boolean default false, -- Entered local pack in window
  is_lost boolean default false, -- Exited local pack in window
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint local_history_unique
    unique(client_id, keyword, location_code, date_end)
);

-- Trigger for updated_at
create trigger local_history_updated_at
  before update on local_ranking_history
  for each row
  execute function update_updated_at_column();

-- City reference table (for quick lookups)
create table if not exists local_cities (
  id uuid primary key default gen_random_uuid(),
  city_name text not null,
  country_code text not null, -- "AU" or "NZ"
  location_code int not null unique,
  state_province text, -- For AU
  created_at timestamptz default now(),

  constraint cities_unique
    unique(city_name, country_code)
);

-- Insert AU cities
insert into local_cities (city_name, country_code, location_code, state_province) values
  ('Sydney', 'AU', 2036, 'NSW'),
  ('Melbourne', 'AU', 2157, 'VIC'),
  ('Brisbane', 'AU', 2174, 'QLD'),
  ('Perth', 'AU', 2190, 'WA'),
  ('Adelaide', 'AU', 2091, 'SA'),
  ('Hobart', 'AU', 2147, 'TAS'),
  ('Gold Coast', 'AU', 2171, 'QLD'),
  ('Canberra', 'AU', 2099, 'ACT')
on conflict (location_code) do nothing;

-- Insert NZ cities
insert into local_cities (city_name, country_code, location_code, state_province) values
  ('Auckland', 'NZ', 2554, NULL),
  ('Wellington', 'NZ', 2579, NULL),
  ('Christchurch', 'NZ', 2555, NULL),
  ('Dunedin', 'NZ', 2556, NULL),
  ('Hamilton', 'NZ', 2557, NULL),
  ('Tauranga', 'NZ', 2558, NULL)
on conflict (location_code) do nothing;

-- Indexes for performance
create index idx_local_rankings_client on local_serp_rankings(client_id);
create index idx_local_rankings_city on local_serp_rankings(location_code);
create index idx_local_rankings_keyword on local_serp_rankings(keyword);
create index idx_local_rankings_date on local_serp_rankings(date);
create index idx_local_history_client_city on local_ranking_history(client_id, location_code);
create index idx_local_history_date_end on local_ranking_history(date_end);
create index idx_local_cities_code on local_cities(location_code);

-- RLS
alter table local_serp_rankings enable row level security;
alter table local_ranking_history enable row level security;
alter table local_cities enable row level security;

-- RLS policies
create policy local_rankings_admin_write
  on local_serp_rankings for insert
  with check (true);

create policy local_history_admin_write
  on local_ranking_history for insert
  with check (true);

create policy local_cities_read_all
  on local_cities for select
  using (true);
