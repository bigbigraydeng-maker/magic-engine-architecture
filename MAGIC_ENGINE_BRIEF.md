# Magic Engine — Claude Code 启动 Brief

> 给 Claude Code 的完整交接文档，拿到即可开始开发。
> 日期：2026-04-25

---

## 你在做什么

**Magic Engine** 是 Magic Lab 旗下的 AI 内容增长引擎，面向 B2B 客户提供两个核心服务：

1. **官网 SEO 获客** — 通过 SEMrush 挖掘关键词，AI 生成 SEO 页面
2. **社媒内容获客** — 三条路线自动生成社媒内容，经人工审核后发布到 Facebook / TikTok / Instagram

**你的任务：** 在现有的 `crazycontent` 项目基础上扩展，把它改造成 Magic Engine。**不要新建项目，不要重写已有功能，只做新增和改造。**

---

## 现有项目：crazycontent

你当前所在的目录就是 `crazycontent`。先花 10 分钟读懂它：

```bash
# 读这几个文件了解现有基础
cat CLAUDE.md
cat src/lib/ai/generate.ts
cat src/lib/social/facebook-publisher.ts
cat supabase/migrations/20260407000000_init_crazycontent.sql
cat src/app/api/crazy-content/route.ts
```

**现有的可复用能力：**
- ✅ Next.js 14 + TypeScript + Supabase 已接通
- ✅ OpenAI 内容生成（`lib/ai/generate.ts`）
- ✅ Facebook + 小红书发布（`lib/social/`）
- ✅ Projects / Topics / Tasks 数据模型
- ✅ Cron 定时任务（`src/app/api/cron/`）
- ✅ Render 部署配置（`render.yaml`）

---

## Phase 1 任务清单（你现在要做的）

### 目标
建立 Magic Engine 的数据基础层：新增 4 张表，接通 SEMrush 的 4 个核心 API。

### Step 1：新增 Supabase 数据库表

在 `supabase/migrations/` 新建文件 `20260425000001_magic_engine_foundation.sql`，内容如下：

```sql
-- ============================================
-- Magic Engine Foundation Tables
-- 2026-04-25
-- ============================================

-- 1. clients（客户表）
CREATE TABLE IF NOT EXISTS public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  domain            text,
  semrush_db        text DEFAULT 'au',
  monthly_quota     integer DEFAULT 5000,
  plan_tier         text DEFAULT 'starter'
                    CHECK (plan_tier IN ('starter','growth','enterprise')),
  airtable_base_id  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.clients FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. master_briefs（品牌底座）
CREATE TABLE IF NOT EXISTS public.master_briefs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version           smallint NOT NULL DEFAULT 1,
  is_active         boolean DEFAULT true,
  brand_name        text NOT NULL,
  tagline           text,
  website           text,
  primary_audience  text,
  pain_points       text[],
  buying_trigger    text,
  products          jsonb,         -- [{name, description, price_range, season, usp}]
  tone              text,
  voice_examples    text[],
  avoid_words       text[],
  content_topics    text[],
  content_avoid     text[],
  platforms         text[],
  post_frequency    text,
  visual_style      text,
  color_palette     text[],
  image_preference  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.master_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. keywords（关键词表）
CREATE TABLE IF NOT EXISTS public.keywords (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  keyword               text NOT NULL,
  volume                integer,
  kd                    smallint,
  cpc                   numeric(6,2),
  intent                text CHECK (intent IN ('informational','commercial','transactional','navigational')),
  trend                 jsonb,
  source                text NOT NULL
                        CHECK (source IN ('semrush_batch','semrush_related','semrush_gap')),
  competitor_source     text,
  semrush_db            text DEFAULT 'au',
  opportunity_score     numeric(5,2),
  recommended_page_type text CHECK (recommended_page_type IN ('hub','guide','landing','faq')),
  status                text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','reviewed','approved','rejected','page_created','published')),
  status_updated_at     timestamptz,
  status_updated_by     text,
  airtable_record_id    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.keywords FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX idx_keywords_client_keyword ON public.keywords(client_id, keyword);
CREATE INDEX idx_keywords_client_status ON public.keywords(client_id, status);
CREATE INDEX idx_keywords_score ON public.keywords(client_id, opportunity_score DESC) WHERE status = 'approved';

-- 4. content_posts（内容日历）
CREATE TABLE IF NOT EXISTS public.content_posts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  route                 text NOT NULL CHECK (route IN ('route_a','route_b','route_c')),
  platforms             text[] NOT NULL,
  script                text,
  caption               text,
  hashtags              text[],
  visual_brief          text,
  revision_notes        text,
  source_keyword_id     uuid REFERENCES public.keywords(id),
  source_video_url      text,
  source_brief_id       uuid REFERENCES public.master_briefs(id),
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','scheduled','published','rejected')),
  scheduled_at          timestamptz,
  published_at          timestamptz,
  publer_post_id        text,
  airtable_record_id    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.content_posts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. semrush_usage_logs（API用量追踪）
CREATE TABLE IF NOT EXISTS public.semrush_usage_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES public.clients(id),
  endpoint          text NOT NULL,
  units_consumed    integer NOT NULL DEFAULT 0,
  keywords_count    integer DEFAULT 0,
  called_at         timestamptz NOT NULL DEFAULT now()
);

-- updated_at 自动触发器
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER keywords_updated_at
  BEFORE UPDATE ON public.keywords
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER content_posts_updated_at
  BEFORE UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER master_briefs_updated_at
  BEFORE UPDATE ON public.master_briefs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Opportunity Score 计算函数
CREATE OR REPLACE FUNCTION public.calculate_opportunity_score(
  p_volume  integer,
  p_kd      smallint,
  p_cpc     numeric,
  p_intent  text,
  p_is_gap  boolean DEFAULT false
)
RETURNS numeric AS $$
DECLARE
  volume_score  numeric;
  kd_score      numeric;
  cpc_score     numeric;
  intent_score  numeric;
  gap_bonus     numeric;
BEGIN
  volume_score := least(100, (log(greatest(p_volume, 1)) / log(10000)) * 100);
  kd_score     := greatest(0, 100 - COALESCE(p_kd, 50));
  cpc_score    := least(100, (COALESCE(p_cpc, 0) / 10.0) * 100);
  intent_score := CASE p_intent
    WHEN 'transactional' THEN 100
    WHEN 'commercial'    THEN 80
    WHEN 'navigational'  THEN 30
    WHEN 'informational' THEN 20
    ELSE 10
  END;
  gap_bonus := CASE WHEN p_is_gap THEN 100 ELSE 0 END;

  RETURN round(
    (volume_score * 0.30) +
    (intent_score * 0.30) +
    (cpc_score    * 0.20) +
    (kd_score     * 0.15) +
    (gap_bonus    * 0.05),
    2
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**执行方式：** 在 Supabase Dashboard → SQL Editor 粘贴执行，或通过 Supabase CLI：
```bash
npx supabase db push
```

---

### Step 2：新增环境变量

在 `.env.local` 追加以下变量（向 Zhong 获取实际值）：

```env
# 已有的 Supabase 变量保留不动

# Magic Engine 新增
SEMRUSH_API_KEY=            # SEMrush API Key
SEMRUSH_DB=au               # 数据库地区（au = 澳洲/NZ）
SUPADATA_API_KEY=           # Supadata 视频转录
MODELSLAB_API_KEY=          # 图片生成（$29/月无限）
ATLAS_CLOUD_API_KEY=        # Seedance 2.0 视频生成
HEYGEN_API_KEY=             # HeyGen 数字人
AIRTABLE_API_KEY=           # Airtable 审核
AIRTABLE_BASE_ID=           # Airtable Base ID
PUBLER_API_KEY=             # Publer 发布
INTERNAL_SERVICE_TOKEN=     # 内部 API 鉴权 token（自己随机生成）
```

---

### Step 3：新建 TypeScript 类型定义

新建文件 `src/types/magic-engine.ts`：

```typescript
// ============================================
// Magic Engine — Core Types
// ============================================

export type ClientPlan = 'starter' | 'growth' | 'enterprise'
export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'
export type KeywordSource = 'semrush_batch' | 'semrush_related' | 'semrush_gap'
export type KeywordStatus = 'new' | 'reviewed' | 'approved' | 'rejected' | 'page_created' | 'published'
export type PageType = 'hub' | 'guide' | 'landing' | 'faq'
export type ContentRoute = 'route_a' | 'route_b' | 'route_c'
export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type VisualProvider = 'modelslab' | 'seedance' | 'heygen'
export type VisualType = 'image' | 'video' | 'avatar_video'

export interface Client {
  id: string
  name: string
  domain?: string
  semrush_db: string
  monthly_quota: number
  plan_tier: ClientPlan
  airtable_base_id?: string
  created_at: string
}

export interface MasterBrief {
  id: string
  client_id: string
  version: number
  is_active: boolean
  brand_name: string
  tagline?: string
  website?: string
  primary_audience?: string
  pain_points?: string[]
  buying_trigger?: string
  products?: Product[]
  tone?: string
  voice_examples?: string[]
  avoid_words?: string[]
  content_topics?: string[]
  content_avoid?: string[]
  platforms?: string[]
  post_frequency?: string
  visual_style?: string
  color_palette?: string[]
  image_preference?: string
}

export interface Product {
  name: string
  description: string
  price_range?: string
  season?: string
  usp?: string
}

export interface Keyword {
  id: string
  client_id: string
  keyword: string
  volume?: number
  kd?: number
  cpc?: number
  intent?: KeywordIntent
  trend?: TrendPoint[]
  source: KeywordSource
  competitor_source?: string
  semrush_db: string
  opportunity_score?: number
  recommended_page_type?: PageType
  status: KeywordStatus
  airtable_record_id?: string
  created_at: string
  updated_at: string
}

export interface TrendPoint {
  month: string   // 'YYYY-MM'
  volume: number
}

export interface ContentPost {
  id: string
  client_id: string
  title: string
  route: ContentRoute
  platforms: string[]
  script?: string
  caption?: string
  hashtags?: string[]
  visual_brief?: string
  revision_notes?: string
  source_keyword_id?: string
  source_video_url?: string
  source_brief_id?: string
  status: ContentStatus
  scheduled_at?: string
  published_at?: string
  publer_post_id?: string
  airtable_record_id?: string
}

// API Request/Response types
export interface KeywordOverviewRequest {
  keywords: string[]      // max 100
  client_id: string
  db?: string
}

export interface KeywordOverviewResponse {
  success: boolean
  data: Keyword[]
  units_consumed: number
  saved_count: number
  errors?: string[]
}

export interface RelatedKeywordsRequest {
  seed_keyword: string
  client_id: string
  limit?: number          // default 50, max 100
  min_volume?: number     // default 100
  max_kd?: number         // default 60
  db?: string
}

export interface CompetitorKeywordsRequest {
  competitor_domains: string[]  // max 4
  client_id: string
  limit?: number
  min_volume?: number
  db?: string
}

export interface KeywordGapRequest {
  client_domain: string
  competitor_domains: string[]  // 1-4
  client_id: string
  limit?: number
  min_volume?: number
  max_kd?: number
  db?: string
}

export interface ApiError {
  success: false
  error: string
  code: 'SEMRUSH_API_ERROR' | 'QUOTA_EXCEEDED' | 'INVALID_INPUT' | 'SUPABASE_ERROR' | 'RATE_LIMITED'
}
```

---

### Step 4：新建 SEMrush Client

新建文件 `src/lib/semrush/client.ts`：

```typescript
// SEMrush MCP Client
// 封装 4 个核心工具，对内提供统一接口

const SEMRUSH_API_BASE = 'https://api.semrush.com'
const API_KEY = process.env.SEMRUSH_API_KEY!
const DEFAULT_DB = process.env.SEMRUSH_DB || 'au'

interface SemrushKeywordData {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: string
  trend: { month: string; volume: number }[]
}

// Tool 1: 批量关键词概览（最多100个）
export async function batchKeywordOverview(
  keywords: string[],
  db: string = DEFAULT_DB
): Promise<SemrushKeywordData[]> {
  // SEMrush Batch Keyword Overview endpoint
  const params = new URLSearchParams({
    type: 'phrase_these',
    key: API_KEY,
    phrase: keywords.join(';'),
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Tr',  // keyword, volume, kd, cpc, intent, trend
    display_limit: String(keywords.length),
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, {
    next: { revalidate: 0 }
  })

  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)

  const text = await res.text()
  return parseSemrushResponse(text)
}

// Tool 2: 相关关键词扩展
export async function getRelatedKeywords(
  seedKeyword: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_related',
    key: API_KEY,
    phrase: seedKeyword,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 3: 竞品域名有机关键词
export async function getDomainOrganicKeywords(
  domain: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'domain_organic',
    key: API_KEY,
    domain,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Po',  // +Po for position
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 4: 关键词差距分析
export async function getKeywordGap(
  clientDomain: string,
  competitorDomains: string[],
  db: string = DEFAULT_DB,
  limit: number = 100
): Promise<SemrushKeywordData[]> {
  // SEMrush Domain vs Domain (gap analysis)
  const domainParams = [clientDomain, ...competitorDomains]
    .map((d, i) => `domains[${i}][domain]=${d}&domains[${i}][type]=organic`)
    .join('&')

  const params = new URLSearchParams({
    type: 'phrase_kgap',
    key: API_KEY,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_filter: `+|Ph|Co|${clientDomain}|missing`, // 客户没有排名的词
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}&${domainParams}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// 解析 SEMrush CSV 响应
function parseSemrushResponse(text: string): SemrushKeywordData[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  return lines.slice(1).map(line => {
    const cols = line.split(';')
    return {
      keyword: cols[0]?.trim() || '',
      volume: parseInt(cols[1]) || 0,
      kd: parseInt(cols[2]) || 0,
      cpc: parseFloat(cols[3]) || 0,
      intent: normalizeIntent(cols[4]?.trim()),
      trend: [], // 后续解析 trend 列
    }
  }).filter(k => k.keyword.length > 0)
}

function normalizeIntent(raw?: string): string {
  const map: Record<string, string> = {
    '0': 'informational',
    '1': 'navigational',
    '2': 'commercial',
    '3': 'transactional',
    'informational': 'informational',
    'navigational': 'navigational',
    'commercial': 'commercial',
    'transactional': 'transactional',
  }
  return map[raw || ''] || 'informational'
}
```

---

### Step 5：新建 Opportunity Score 工具

新建文件 `src/lib/scoring/opportunity-score.ts`：

```typescript
import type { PageType, KeywordIntent } from '@/types/magic-engine'

export function calculateOpportunityScore(params: {
  volume: number
  kd: number
  cpc: number
  intent: KeywordIntent
  isGap?: boolean
}): number {
  const { volume, kd, cpc, intent, isGap = false } = params

  const volumeScore = Math.min(100, (Math.log10(Math.max(volume, 1)) / Math.log10(10000)) * 100)
  const kdScore     = Math.max(0, 100 - (kd || 50))
  const cpcScore    = Math.min(100, ((cpc || 0) / 10) * 100)
  const intentScore = { transactional: 100, commercial: 80, navigational: 30, informational: 20 }[intent] ?? 10
  const gapBonus    = isGap ? 100 : 0

  return Math.round(
    (volumeScore * 0.30 + intentScore * 0.30 + cpcScore * 0.20 + kdScore * 0.15 + gapBonus * 0.05) * 100
  ) / 100
}

export function recommendPageType(keyword: string, intent: KeywordIntent, volume: number): PageType {
  const kw = keyword.toLowerCase()

  if (['tour', 'package', 'trip', 'travel', 'booking'].some(w => kw.includes(w)) &&
      ['commercial', 'transactional'].includes(intent)) return 'landing'

  if (['best', 'guide', 'how', 'tips', 'things to do', 'what to'].some(w => kw.includes(w))) return 'guide'

  if (volume > 1000 && ['beijing', 'shanghai', 'china', 'xian', 'chengdu'].some(w => kw.includes(w))) return 'hub'

  if (kw.match(/^(what|when|why|is |can |do i|how much)/)) return 'faq'

  return 'guide'
}
```

---

### Step 6：新建 4 个 SEMrush API 路由

**文件：** `src/app/api/semrush/keyword-overview/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { batchKeywordOverview } from '@/lib/semrush/client'
import { calculateOpportunityScore, recommendPageType } from '@/lib/scoring/opportunity-score'
import type { KeywordOverviewRequest, KeywordIntent, PageType } from '@/types/magic-engine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body: KeywordOverviewRequest = await req.json()
    const { keywords, client_id, db } = body

    if (!keywords?.length || keywords.length > 100) {
      return NextResponse.json({ success: false, error: 'keywords must be 1–100', code: 'INVALID_INPUT' }, { status: 400 })
    }
    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required', code: 'INVALID_INPUT' }, { status: 400 })
    }

    // 调用 SEMrush
    const rawData = await batchKeywordOverview(keywords, db)

    // 计算评分并准备写入
    const records = rawData.map(item => ({
      client_id,
      keyword:               item.keyword,
      volume:                item.volume,
      kd:                    item.kd,
      cpc:                   item.cpc,
      intent:                item.intent as KeywordIntent,
      trend:                 item.trend,
      source:                'semrush_batch' as const,
      semrush_db:            db || 'au',
      opportunity_score:     calculateOpportunityScore({
        volume: item.volume, kd: item.kd, cpc: item.cpc,
        intent: item.intent as KeywordIntent
      }),
      recommended_page_type: recommendPageType(item.keyword, item.intent as KeywordIntent, item.volume),
      status:                'new' as const,
    }))

    // Upsert（client_id + keyword 唯一）
    const { data, error } = await supabase
      .from('keywords')
      .upsert(records, { onConflict: 'client_id,keyword', ignoreDuplicates: false })
      .select()

    if (error) throw error

    // 记录用量
    await supabase.from('semrush_usage_logs').insert({
      client_id,
      endpoint: 'keyword-overview',
      units_consumed: rawData.length * 10,
      keywords_count: rawData.length,
    })

    return NextResponse.json({
      success: true,
      data: data || [],
      units_consumed: rawData.length * 10,
      saved_count: data?.length || 0,
    })

  } catch (err: any) {
    console.error('[keyword-overview]', err)
    return NextResponse.json({ success: false, error: err.message, code: 'SEMRUSH_API_ERROR' }, { status: 500 })
  }
}
```

用同样的模式新建另外三个路由：
- `src/app/api/semrush/related-keywords/route.ts` → 调用 `getRelatedKeywords`，source = `'semrush_related'`
- `src/app/api/semrush/competitor-keywords/route.ts` → 调用 `getDomainOrganicKeywords`，source = `'semrush_batch'`，加 `competitor_source`
- `src/app/api/semrush/keyword-gap/route.ts` → 调用 `getKeywordGap`，source = `'semrush_gap'`，isGap = true 计分

---

### Step 7：验证 Phase 1

```bash
# 1. 启动开发服务器
npm run dev

# 2. 测试关键词概览 API
curl -X POST http://localhost:3000/api/semrush/keyword-overview \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["china tours new zealand", "beijing travel package"],
    "client_id": "test-client-001"
  }'

# 预期响应：
# { "success": true, "data": [...], "units_consumed": 20, "saved_count": 2 }

# 3. 检查 Supabase 数据
# 进 Supabase Dashboard → Table Editor → keywords 表
# 应该能看到两条记录，status = "new"，有 opportunity_score
```

---

## 完成 Phase 1 后

Phase 1 完成的标志：
- ✅ 5 张新表在 Supabase 中存在
- ✅ 4 个 SEMrush API 路由返回正确数据
- ✅ 关键词数据写入 Supabase，含 opportunity_score
- ✅ semrush_usage_logs 记录了调用

**Phase 2 任务**（下一份 brief 会写）：
- Supadata 视频转录
- Route B 爆款视频改写管道
- Claude API 内容生成

---

## 参考文档

所有详细 spec 在 `../docs/` 目录：

```
../docs/PRD-semrush-integration.md      完整产品 PRD
../docs/spec-supabase-schema.md         数据库设计（含注意事项）
../docs/spec-airtable-schema.md         Airtable 结构（Phase 6 用）
../docs/spec-semrush-api.md             SEMrush 4个 API 详细接口
../docs/magic-engine-architecture.md    完整架构 + 7个 Phase 计划
```

---

## 注意事项

1. **不要删除或重写现有的 crazycontent 功能**，Facebook/小红书发布器后面 Magic Engine 还要用
2. **SEMrush API Key 目前可能是测试值**，先用 mock 数据开发，上线前换真实 key
3. **所有 SEMrush 调用只在后端**，API Key 绝不出现在前端代码
4. **Supabase 操作用 service_role key**，不要用 anon key 做后台写入
5. **遇到 SEMrush rate limit（10 req/s）**，加指数退避重试
