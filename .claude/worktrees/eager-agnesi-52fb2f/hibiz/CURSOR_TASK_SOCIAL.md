# Cursor Task: v0.3 — Social Media Content Marketing + Data Dashboard

> Owner: Cursor | Reviewer: Claude
> Priority: v0.3.1 (copy) > v0.3.3 (dashboard) > v0.3.2 (publishing APIs)
> Read CLAUDE.md and PROJECT.md before starting.

---

## Context

HiBiz helps NZ real estate agents build microsites. v0.2.2 (skeleton system) is done.
v0.3 adds **social media content tools** and a **data dashboard** so agents can:

1. Generate bilingual social media posts from their listing/profile data
2. Export poster images + captions as a "share pack"
3. Track microsite visits and form conversion rates

### Existing Code to Build On

| What | File |
|------|------|
| AI copy generation pattern | `src/lib/generation/openai-copy.ts` (`generateCopyWithOpenAI`) |
| Poster layout (HTML) | `src/app/app/projects/[id]/poster/` + `PosterDesignedLayout.tsx` |
| Merchant profile data | `src/types/merchant-profile.ts` (`MerchantProfileV1`) |
| Render model types | `src/types/render-model.ts` (`RenderModelV1`) |
| Skeleton assembly | `src/lib/generation/assemble-skeleton.ts` |
| Supabase client | `src/lib/supabase/server.ts` (server) / `client.ts` (browser) |
| Server Actions pattern | `src/app/app/projects/skeleton-edit-actions.ts` |
| Image upload validation | `src/lib/upload/validate-image.ts` |

---

## Phase 0: Types & Data Models

### 0.1 Social Content Types

Create `src/types/social-content.ts`:

```typescript
export type SocialContentType =
  | "just_listed"      // New property listing
  | "just_sold"        // Sale closed
  | "open_home"        // Open home announcement
  | "market_update"    // Weekly/monthly market stats
  | "buying_tips";     // Educational content

export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "xiaohongshu" | "wechat";

export type PosterAspectRatio = "1:1" | "4:5" | "9:16";

export interface SocialPostV1 {
  schema_version: 1;
  id: string;
  project_id: string;
  content_type: SocialContentType;
  /** AI-generated captions keyed by language */
  captions: {
    en: string;
    zh: string;
  };
  /** Platform-specific truncated versions */
  platform_captions?: Partial<Record<SocialPlatform, string>>;
  /** Generated poster image URL (Supabase Storage) */
  poster_url: string | null;
  poster_aspect: PosterAspectRatio;
  /** Source data snapshot (listing id, profile fields used) */
  source: {
    listing_id?: string;
    profile_snapshot?: Record<string, unknown>;
  };
  created_at: string;
  status: "draft" | "exported" | "published";
}
```

### 0.2 Analytics Types

Create `src/types/analytics.ts`:

```typescript
export interface SiteVisitRow {
  id: string;
  microsite_id: string;
  path: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AnalyticsSummary {
  total_visits: number;
  total_submissions: number;
  conversion_rate: number;        // submissions / visits * 100
  visits_by_day: { date: string; count: number }[];
  submissions_by_day: { date: string; count: number }[];
  top_referrers: { referrer: string; count: number }[];
  top_utm_sources: { source: string; count: number }[];
}
```

### 0.3 Database Migration

Create migration `supabase/migrations/YYYYMMDDHHMMSS_social_content_analytics.sql`:

```sql
-- Social content posts
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('just_listed','just_sold','open_home','market_update','buying_tips')),
  captions JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform_captions JSONB,
  poster_url TEXT,
  poster_aspect TEXT NOT NULL DEFAULT '1:1' CHECK (poster_aspect IN ('1:1','4:5','9:16')),
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','exported','published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: owner only
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_posts_owner" ON social_posts
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Site visits tracking
CREATE TABLE IF NOT EXISTS site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  microsite_id UUID NOT NULL REFERENCES microsites(id) ON DELETE CASCADE,
  path TEXT NOT NULL DEFAULT '/',
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: public insert (anonymous visitors), owner read
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_visits_anon_insert" ON site_visits
  FOR INSERT WITH CHECK (true);
CREATE POLICY "site_visits_owner_read" ON site_visits
  FOR SELECT USING (
    microsite_id IN (
      SELECT m.id FROM microsites m
      JOIN projects p ON p.id = m.project_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Index for dashboard queries
CREATE INDEX idx_site_visits_microsite_created ON site_visits(microsite_id, created_at DESC);
CREATE INDEX idx_social_posts_project ON social_posts(project_id, created_at DESC);
```

---

## Phase 1: Social Copy AI Generation (v0.3.1 core)

### 1.1 AI Social Copy Generator

Create `src/lib/generation/openai-social-copy.ts`:

**Requirements:**
- Input: `SocialContentType` + `MerchantProfileV1` + optional listing data
- Output: `{ en: string; zh: string }` captions
- Use `gpt-4o-mini` with `response_format: { type: "json_object" }`
- Each content type has a different system prompt:
  - `just_listed`: Highlight property features, price hint, location
  - `just_sold`: Celebration tone, neighborhood mention, "more listings" CTA
  - `open_home`: Date/time/address, urgency, registration CTA
  - `market_update`: Data-driven, professional tone, agent as expert
  - `buying_tips`: Educational, helpful, soft brand mention
- Platform character limits:
  - Facebook: 500 chars
  - Instagram: 2200 chars (but first 125 visible)
  - LinkedIn: 3000 chars
  - Xiaohongshu: 1000 chars
- Chinese copy should use Simplified Chinese, natural tone (not Google Translate quality)
- Include relevant hashtags (3-5 per platform)

**Pattern to follow:** See `openai-copy.ts` for the existing generation pattern (system prompt + user prompt + JSON schema + `coerceString` fallback).

### 1.2 Content Type Selector UI

Create `src/app/app/projects/[id]/social/page.tsx` (Server Component):

- Page title: "Social Media Content"
- Grid of 5 content type cards (icon + title + short description)
- Click → navigates to generation page with `?type=just_listed` etc.
- Show listing selector if content type needs a listing (just_listed, just_sold, open_home)
- "Generate" button triggers Server Action

### 1.3 Server Actions

Create `src/app/app/projects/social-actions.ts`:

```typescript
"use server";
// generateSocialPost(formData) — calls AI, saves to social_posts table
// deleteSocialPost(formData) — soft delete
// exportSocialPost(formData) — marks as exported
```

**Authorization pattern:** Same as skeleton-edit-actions.ts — verify `projects.user_id === auth.uid()` before any mutation.

---

## Phase 2: Template Poster Generation

### 2.1 Social Poster Templates

Create `src/lib/poster/social-poster-templates.ts`:

Define 5 poster templates (one per content type), each with:
- HTML/JSX layout (React component, NOT canvas)
- Slots: title, subtitle, image, agent name, phone, logo, QR
- Support 3 aspect ratios: 1:1 (1080x1080), 4:5 (1080x1350), 9:16 (1080x1920)
- Color theming from skeleton palette (use `profile.theme_overrides.palette_id`)

### 2.2 Social Poster Preview Component

Create `src/components/social/SocialPosterPreview.tsx` (Client Component):

- Renders poster at selected aspect ratio
- Live preview updates as user edits captions
- Aspect ratio toggle (3 buttons: square, portrait, story)

### 2.3 HTML-to-Image Export

Create `src/lib/poster/poster-export.ts`:

**Two approaches (try in order):**

1. **Preferred: `html-to-image` library** (client-side)
   - `npm install html-to-image`
   - Capture the poster DOM element → PNG blob
   - Upload to Supabase Storage `social-posters` bucket

2. **Fallback: `@vercel/og` / Satori** (server-side)
   - If client-side capture quality is poor
   - Use Satori to render React → SVG → PNG on the server

**Output:** PNG uploaded to `social-posters/{userId}/{projectId}/{postId}.png`

### 2.4 Supabase Storage Bucket

Migration or manual setup:
- Bucket name: `social-posters`
- Public read (posters are meant to be shared)
- RLS: authenticated users can upload to their own path

---

## Phase 3: Share Pack & Native Share

### 3.1 Share Pack Export

Create `src/components/social/SharePackExport.tsx` (Client Component):

- "Download Pack" button: saves poster image to device
- Caption display with "Copy" button (copies to clipboard)
- Platform-specific caption tabs (Facebook, Instagram, LinkedIn, Xiaohongshu)
- Each tab shows truncated caption + hashtags appropriate for that platform

### 3.2 Native Share API

In the same component:
```typescript
async function handleShare() {
  const blob = await posterToBlob(posterRef);
  const file = new File([blob], "poster.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: "Property Post",
      text: caption,
      files: [file],
    });
  } else {
    // Fallback: download image + copy caption
  }
}
```

### 3.3 Post History Page

Create `src/app/app/projects/[id]/social/history/page.tsx`:

- List of all generated social posts for this project
- Each card: thumbnail, content type badge, date, status
- Click to re-export or edit
- Delete button (soft delete)

---

## Phase 4: Data Dashboard (v0.3.3)

### 4.1 Visit Tracking Middleware

Create `src/middleware.ts` (or extend existing):

**Only track visits to public site pages** (`/site/[slug]`):
```typescript
// In middleware, if path starts with /site/:
// Extract slug → look up microsite_id
// Insert into site_visits via Supabase (use service_role on server only)
// Pass through UTM params from query string
```

**Important:** Do NOT use service_role key in browser. The middleware runs on the server.

### 4.2 Analytics Data Fetcher

Create `src/lib/analytics/fetch-analytics.ts`:

```typescript
export async function fetchAnalyticsSummary(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  days: number = 30,
): Promise<AnalyticsSummary>
```

- Query `site_visits` grouped by day
- Query `submissions` count grouped by day
- Calculate conversion rate
- Group by referrer and UTM source
- Return structured `AnalyticsSummary`

### 4.3 Dashboard UI

Create `src/app/app/projects/[id]/dashboard/page.tsx` (Server Component):

Layout:
```
┌────────────────────────────────────┐
│ [Visits: 1,234] [Leads: 56] [CR: 4.5%] │  ← KPI cards
├──────────────────┬─────────────────┤
│  Visits/day      │  Top referrers  │  ← Charts
│  (line chart)    │  (bar list)     │
├──────────────────┼─────────────────┤
│  Submissions/day │  UTM sources    │
│  (line chart)    │  (bar list)     │
├──────────────────┴─────────────────┤
│  Recent submissions (table, last 10) │
└────────────────────────────────────┘
```

**Chart library:** Use `recharts` (already common in Next.js projects) or simple CSS bar charts if we want zero JS bundle impact.

```
npm install recharts
```

### 4.4 Dashboard Navigation

Add dashboard link to project detail page sidebar/tabs:
- Existing tabs: Preview | Leads | Poster
- Add: **Social** | **Dashboard**

---

## Phase 5 (Stretch): Social Media API Publishing

> This phase is OPTIONAL for v0.3. Only implement if Phases 1-4 are solid.

### 5.1 Meta Graph API (Facebook + Instagram)

Create `src/lib/social/meta-publish.ts`:

- OAuth 2.0 flow for Facebook Pages
- `POST /{page-id}/photos` for Facebook
- `POST /{ig-user-id}/media` + `POST /{ig-user-id}/media_publish` for Instagram
- Store access tokens in `social_connections` table (encrypted)

### 5.2 LinkedIn API

Create `src/lib/social/linkedin-publish.ts`:

- OAuth 2.0 flow
- `POST /ugcPosts` for content sharing
- Image upload via `POST /assets?action=registerUpload`

### 5.3 Xiaohongshu / WeChat

No official API. Generate a "content pack":
- PNG poster image (download)
- Pre-formatted caption (copy to clipboard)
- Hashtag suggestions
- "Open Xiaohongshu" deep link (if available)

---

## File Plan Summary

### New Files

| File | Purpose |
|------|---------|
| `src/types/social-content.ts` | Social post types |
| `src/types/analytics.ts` | Analytics types |
| `src/lib/generation/openai-social-copy.ts` | AI social caption generator |
| `src/lib/poster/social-poster-templates.ts` | 5 poster HTML templates |
| `src/lib/poster/poster-export.ts` | HTML-to-image export |
| `src/lib/analytics/fetch-analytics.ts` | Dashboard data queries |
| `src/app/app/projects/social-actions.ts` | Social Server Actions |
| `src/app/app/projects/[id]/social/page.tsx` | Content type selector |
| `src/app/app/projects/[id]/social/history/page.tsx` | Post history |
| `src/app/app/projects/[id]/dashboard/page.tsx` | Analytics dashboard |
| `src/components/social/SocialPosterPreview.tsx` | Poster preview component |
| `src/components/social/SharePackExport.tsx` | Share/export component |
| `supabase/migrations/YYYYMMDD_social_analytics.sql` | DB migration |

### Modified Files

| File | Change |
|------|--------|
| `src/app/app/projects/[id]/layout.tsx` or navigation | Add Social + Dashboard tabs |
| `src/middleware.ts` | Add visit tracking for `/site/[slug]` |
| `package.json` | Add `html-to-image`, `recharts` |

---

## Verification Checklist

After implementing each phase, verify:

### Phase 1 (Social Copy)
- [ ] `generateSocialCopy("just_listed", profile, listing)` returns valid `{ en, zh }`
- [ ] All 5 content types produce meaningful copy
- [ ] Chinese copy reads naturally (not machine-translated)
- [ ] Social page loads at `/app/projects/[id]/social`
- [ ] Server Action checks `user_id` ownership before write

### Phase 2 (Poster)
- [ ] Poster renders at all 3 aspect ratios
- [ ] Agent name, phone, logo, QR appear on poster
- [ ] "Download" saves a PNG to device
- [ ] PNG upload to Supabase Storage works

### Phase 3 (Share Pack)
- [ ] "Copy Caption" copies correct platform-specific text
- [ ] `navigator.share` works on mobile Safari / Chrome
- [ ] Fallback (download + copy) works on desktop
- [ ] Post history page lists all generated posts

### Phase 4 (Dashboard)
- [ ] Visit tracking middleware fires on `/site/[slug]` pages
- [ ] UTM params are extracted and stored
- [ ] Dashboard shows KPI cards with real numbers
- [ ] Charts render visits/submissions by day
- [ ] Recent submissions list is correct

### Security
- [ ] No `service_role` key exposed to browser
- [ ] All Server Actions verify `user_id` ownership
- [ ] Image uploads use `validateImageUpload()` (MIME + magic bytes)
- [ ] Rate limiting on AI generation endpoints
- [ ] Social API tokens stored encrypted, never in client bundle

---

## Dependencies to Install

```bash
npm install html-to-image recharts
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Chart library | recharts | Lightweight, React-native, good mobile support |
| Image export | html-to-image (client) | No server infra needed, works offline |
| Visit tracking | Middleware + DB | Lightweight, no third-party analytics cost |
| Social API (Phase 5) | Stretch goal | API approvals take time; export-first is pragmatic |
| Content types | 5 fixed types | Covers 90% of agent posting needs |
| Caption languages | Always both en + zh | NZ Chinese agents serve bilingual audience |

---

## Implementation Order

```
Phase 0 (types + migration)  → 1 day
Phase 1 (AI copy + UI)       → 2 days
Phase 2 (poster templates)   → 2 days
Phase 3 (share pack)         → 1 day
Phase 4 (dashboard)          → 2 days
Phase 5 (API publish)        → deferred
```

Start with Phase 0 + 1, then 4, then 2 + 3. Dashboard (Phase 4) can be developed in parallel with poster work.
