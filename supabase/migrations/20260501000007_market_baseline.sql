-- P8.9: Market Baseline (行业竞争水位参考)

-- Market baseline snapshot for industry comparison
create table if not exists market_baseline (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  industry_avg_position float, -- 行业平均排名
  industry_avg_volume int, -- 行业平均搜索量
  top_10_domains text[] default array[]::text[], -- Top 10 竞品域名列表
  difficulty_score int, -- 难度评分（0-100）
  date date not null, -- 快照日期
  created_at timestamptz default now(),

  constraint baseline_unique
    unique(client_id, keyword, date)
);

-- Market comparison result (client vs industry)
create table if not exists market_comparison (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  keyword text not null,
  client_position int, -- 客户排名
  industry_avg_position float, -- 行业平均排名
  position_diff float, -- 差值（负数 = 领先）
  client_volume int,
  industry_avg_volume int,
  volume_percentile float, -- 搜索量百分位（0-100）
  client_ranking_strength text, -- "ahead" / "aligned" / "behind"
  opportunity_score float, -- 机会评分（0-100）
  date date not null,
  created_at timestamptz default now(),

  constraint comparison_unique
    unique(client_id, keyword, date)
);

-- Indexes for performance
create index idx_baseline_client on market_baseline(client_id);
create index idx_baseline_keyword on market_baseline(keyword);
create index idx_baseline_date on market_baseline(date);
create index idx_comparison_client on market_comparison(client_id);
create index idx_comparison_keyword on market_comparison(keyword);
create index idx_comparison_date on market_comparison(date);

-- RLS
alter table market_baseline enable row level security;
alter table market_comparison enable row level security;

-- RLS policies
create policy baseline_admin_write
  on market_baseline for insert
  with check (true);

create policy comparison_admin_write
  on market_comparison for insert
  with check (true);
