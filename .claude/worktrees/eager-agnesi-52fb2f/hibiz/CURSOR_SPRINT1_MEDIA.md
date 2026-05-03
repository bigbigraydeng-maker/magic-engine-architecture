# HiBiz Sprint 1 — 媒体素材库（/media）

## 目标

为 HiBiz 添加 **媒体素材管理模块**，支持三种图片来源：
1. **Unsplash** — 免费高质量图库搜索
2. **用户上传** — 自有图片上传到 Supabase Storage
3. **AI 生成** — 占位（后续集成 Loveart/Replicate）

**核心原则**：地产中介行业，图片就是一切。网站靠图撑，海报靠图撑，社媒靠图撑。

---

## 技术栈

| 层 | 技术 |
|----|------|
| Framework | Next.js 14 App Router, TypeScript strict |
| UI | React 18 + Tailwind 3.4 |
| Backend | Supabase Auth + Postgres + RLS + Storage |
| 图片API | Unsplash API (free tier → production 5000 req/h) |
| AI图片 | 占位（后续 Loveart / Replicate） |

---

## 新增路由

```
src/app/app/projects/[id]/media/
  ├── page.tsx              ← 素材库主页（图片网格 + 搜索 + 上传）
  └── generate/
      └── page.tsx          ← AI 生成工作台（占位）
```

---

## 数据库

### 新表：`media_assets`

```sql
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),

  -- 来源
  source text not null check (source in ('upload', 'unsplash', 'ai_generated')),

  -- 图片信息
  url text not null,                    -- 可用的图片 URL
  thumbnail_url text,                   -- 缩略图
  storage_path text,                    -- Supabase Storage 路径（仅 upload 类型）
  width int,
  height int,
  file_size_bytes int,
  mime_type text,

  -- Unsplash 归属（source = 'unsplash' 时必填）
  unsplash_id text,                     -- Unsplash photo ID
  unsplash_photographer text,           -- 摄影师名字
  unsplash_photographer_url text,       -- 摄影师 Unsplash 主页
  unsplash_download_location text,      -- 用于触发 download 统计

  -- AI 生成元数据（source = 'ai_generated' 时）
  ai_prompt text,
  ai_provider text,                     -- 'loveart' | 'replicate' | ...

  -- 分类管理
  category text not null default 'general'
    check (category in ('general', 'hero', 'property', 'portrait', 'brand', 'poster', 'social')),
  tags text[] default '{}',
  alt_text text,                        -- 无障碍文本

  -- 使用追踪
  used_in text[] default '{}',          -- ['website', 'poster_xxx', 'social_xxx']

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.media_assets enable row level security;

create policy "Users see own project media"
  on public.media_assets for select
  using (auth.uid() = user_id);

create policy "Users insert own project media"
  on public.media_assets for insert
  with check (auth.uid() = user_id);

create policy "Users update own project media"
  on public.media_assets for update
  using (auth.uid() = user_id);

create policy "Users delete own project media"
  on public.media_assets for delete
  using (auth.uid() = user_id);

-- 索引
create index idx_media_assets_project on public.media_assets(project_id);
create index idx_media_assets_category on public.media_assets(project_id, category);
```

**迁移文件**：`supabase/migrations/20260409120000_media_assets.sql`

### Supabase Storage Bucket

需要创建 `media` bucket（如果不存在）：
```sql
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict do nothing;

create policy "Users upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Public read media"
  on storage.objects for select
  using (bucket_id = 'media');

create policy "Users delete own media"
  on storage.objects for delete
  using (
    bucket_id = 'media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
```

---

## 新增文件清单

### 类型
```
src/types/media-asset.ts           ← MediaAsset 类型 + category 枚举
```

### Unsplash 集成
```
src/lib/media/unsplash-client.ts   ← Unsplash API 客户端（搜索 + 下载触发）
```

### Server Actions
```
src/app/app/projects/media-actions.ts  ← 上传、保存、删除、Unsplash 导入
```

### 组件
```
src/components/media/MediaGrid.tsx         ← 图片网格（响应式瀑布流）
src/components/media/UnsplashSearch.tsx    ← Unsplash 搜索面板
src/components/media/ImageUploader.tsx     ← 拖拽上传组件
src/components/media/MediaPicker.tsx       ← 图片选择器（供其他模块调用）
src/components/media/CategoryFilter.tsx    ← 分类筛选标签
```

### 页面
```
src/app/app/projects/[id]/media/page.tsx            ← 素材库主页
src/app/app/projects/[id]/media/generate/page.tsx   ← AI 生成（占位）
```

---

## Part 1: 类型定义

### `src/types/media-asset.ts`

```typescript
export const MEDIA_SOURCES = ["upload", "unsplash", "ai_generated"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export const MEDIA_CATEGORIES = [
  "general",
  "hero",
  "property",
  "portrait",
  "brand",
  "poster",
  "social",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MediaCategory, string> = {
  general: "通用",
  hero: "Hero 横幅",
  property: "房源",
  portrait: "人像",
  brand: "品牌",
  poster: "海报",
  social: "社媒",
};

export interface MediaAsset {
  id: string;
  project_id: string;
  user_id: string;
  source: MediaSource;
  url: string;
  thumbnail_url: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  unsplash_id: string | null;
  unsplash_photographer: string | null;
  unsplash_photographer_url: string | null;
  unsplash_download_location: string | null;
  ai_prompt: string | null;
  ai_provider: string | null;
  category: MediaCategory;
  tags: string[];
  alt_text: string | null;
  used_in: string[];
  created_at: string;
  updated_at: string;
}

export function isMediaCategory(v: unknown): v is MediaCategory {
  return typeof v === "string" && MEDIA_CATEGORIES.includes(v as MediaCategory);
}
```

---

## Part 2: Unsplash 客户端

### `src/lib/media/unsplash-client.ts`

```typescript
/**
 * Unsplash API 客户端
 *
 * 归属要求（必须遵守）：
 * - 显示摄影师姓名 + 链接到其 Unsplash 主页
 * - 显示 "Unsplash" 字样 + 链接到 unsplash.com
 * - 所有链接加 utm 参数：?utm_source=hibiz&utm_medium=referral
 * - 用户选择图片时调用 download_location 触发下载统计
 *
 * 限制：
 * - Demo: 50 req/hour
 * - Production: 5000 req/hour
 */

const UNSPLASH_API = "https://api.unsplash.com";
const UTM = "utm_source=hibiz&utm_medium=referral";

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;   // 1080px wide — 适合网站
    small: string;     // 400px wide — 适合缩略图
    thumb: string;     // 200px wide
  };
  user: {
    name: string;
    username: string;
    links: { html: string };
  };
  links: {
    download_location: string; // 必须在选择时调用
  };
}

export interface UnsplashSearchResult {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}

function getAccessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    throw new Error("Missing UNSPLASH_ACCESS_KEY in environment");
  }
  return key;
}

export async function searchUnsplashPhotos(
  query: string,
  options: { page?: number; perPage?: number; orientation?: "landscape" | "portrait" | "squarish" } = {},
): Promise<UnsplashSearchResult> {
  const { page = 1, perPage = 20, orientation } = options;

  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(perPage),
  });
  if (orientation) {
    params.set("orientation", orientation);
  }

  const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${getAccessKey()}` },
    next: { revalidate: 3600 }, // 缓存 1 小时
  });

  if (!res.ok) {
    throw new Error(`Unsplash API error: ${res.status}`);
  }

  return res.json() as Promise<UnsplashSearchResult>;
}

/** 触发下载统计（Unsplash 要求在用户选择图片时调用） */
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  await fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${getAccessKey()}` },
  });
}

/** 给摄影师链接加 utm 参数 */
export function photographerUrl(username: string): string {
  return `https://unsplash.com/@${username}?${UTM}`;
}

/** Unsplash 归属链接 */
export function unsplashAttributionUrl(): string {
  return `https://unsplash.com?${UTM}`;
}
```

### `.env.local` 新增

```
UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
```

注册地址：https://unsplash.com/oauth/applications

---

## Part 3: Server Actions

### `src/app/app/projects/media-actions.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  searchUnsplashPhotos,
  triggerUnsplashDownload,
  photographerUrl,
  type UnsplashPhoto,
} from "@/lib/media/unsplash-client";
import { isMediaCategory, type MediaCategory } from "@/types/media-asset";

// ── Unsplash 搜索 ─────────────────────────────────

export interface UnsplashSearchParams {
  query: string;
  page?: number;
  perPage?: number;
  orientation?: "landscape" | "portrait" | "squarish";
}

export async function searchUnsplash(params: UnsplashSearchParams) {
  return searchUnsplashPhotos(params.query, {
    page: params.page,
    perPage: params.perPage,
    orientation: params.orientation,
  });
}

// ── 保存 Unsplash 图片到素材库 ─────────────────────

export async function saveUnsplashToLibrary(
  projectId: string,
  photo: UnsplashPhoto,
  category: MediaCategory = "general",
): Promise<{ id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  // 触发 Unsplash 下载统计（API 要求）
  await triggerUnsplashDownload(photo.links.download_location);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      user_id: user.id,
      source: "unsplash",
      url: photo.urls.regular,
      thumbnail_url: photo.urls.small,
      width: photo.width,
      height: photo.height,
      unsplash_id: photo.id,
      unsplash_photographer: photo.user.name,
      unsplash_photographer_url: photographerUrl(photo.user.username),
      unsplash_download_location: photo.links.download_location,
      category,
      alt_text: photo.alt_description ?? photo.description,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save: ${error?.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
  return { id: data.id };
}

// ── 上传图片 ──────────────────────────────────────

export async function uploadImageToLibrary(
  projectId: string,
  formData: FormData,
): Promise<{ id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    throw new Error("No file provided.");
  }

  const categoryRaw = formData.get("category") as string | null;
  const category: MediaCategory = categoryRaw && isMediaCategory(categoryRaw) ? categoryRaw : "general";

  // 验证文件类型
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Only JPEG, PNG, WebP allowed.");
  }

  // 限制文件大小 10MB
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB).");
  }

  // 上传到 Supabase Storage
  const ext = file.name.split(".").pop() ?? "jpg";
  const storagePath = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("media")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // 获取公开 URL
  const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      user_id: user.id,
      source: "upload",
      url: urlData.publicUrl,
      thumbnail_url: urlData.publicUrl,
      storage_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
      category,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Save failed: ${error?.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
  return { id: data.id };
}

// ── 删除图片 ──────────────────────────────────────

export async function deleteMediaAsset(projectId: string, assetId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  // 获取 storage_path（如果是上传的，需要同时删除 storage 文件）
  const { data: asset } = await supabase
    .from("media_assets")
    .select("storage_path")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .single();

  if (asset?.storage_path) {
    await supabase.storage.from("media").remove([asset.storage_path]);
  }

  const { error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
}

// ── 更新分类 ──────────────────────────────────────

export async function updateMediaCategory(
  projectId: string,
  assetId: string,
  category: MediaCategory,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  const { error } = await supabase
    .from("media_assets")
    .update({ category, updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Update failed: ${error.message}`);
  }

  revalidatePath(`/app/projects/${projectId}/media`);
}

// ── 获取素材库 ────────────────────────────────────

export async function getMediaAssets(
  projectId: string,
  category?: MediaCategory,
): Promise<{ assets: Array<Record<string, unknown>> }> {
  const supabase = createClient();

  let query = supabase
    .from("media_assets")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Fetch failed: ${error.message}`);
  }

  return { assets: data ?? [] };
}
```

---

## Part 4: 组件

### `src/components/media/UnsplashSearch.tsx`

```typescript
"use client";

import { useState, useTransition } from "react";
import { searchUnsplash, saveUnsplashToLibrary } from "@/app/app/projects/media-actions";
import type { UnsplashPhoto } from "@/lib/media/unsplash-client";
import type { MediaCategory } from "@/types/media-asset";

interface UnsplashSearchProps {
  projectId: string;
  onSaved?: () => void;
}

export function UnsplashSearch({ projectId, onSaved }: UnsplashSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!query.trim()) return;
    startTransition(async () => {
      const res = await searchUnsplash({ query: query.trim(), page: 1, perPage: 20 });
      setResults(res.results);
      setTotal(res.total);
      setPage(1);
    });
  };

  const handleLoadMore = () => {
    startTransition(async () => {
      const nextPage = page + 1;
      const res = await searchUnsplash({ query: query.trim(), page: nextPage, perPage: 20 });
      setResults((prev) => [...prev, ...res.results]);
      setPage(nextPage);
    });
  };

  const handleSave = (photo: UnsplashPhoto, category: MediaCategory = "general") => {
    setSaving(photo.id);
    startTransition(async () => {
      try {
        await saveUnsplashToLibrary(projectId, photo, category);
        onSaved?.();
      } finally {
        setSaving(null);
      }
    });
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索图片... (例如: Auckland skyline, modern house)"
          className="flex-1 rounded-lg border border-stone-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSearch}
          disabled={pending}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {pending ? "搜索中..." : "搜索 Unsplash"}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <p className="mt-4 text-xs text-stone-500">
            共 {total.toLocaleString()} 张图片 · 图片来源{" "}
            <a href="https://unsplash.com?utm_source=hibiz&utm_medium=referral" target="_blank" rel="noopener noreferrer" className="underline">
              Unsplash
            </a>
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((photo) => (
              <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-stone-200">
                <img
                  src={photo.urls.small}
                  alt={photo.alt_description ?? ""}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                {/* 悬浮操作 */}
                <div className="absolute inset-0 flex flex-col justify-between bg-black/0 p-2 transition-all group-hover:bg-black/40">
                  <div className="text-right opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => handleSave(photo)}
                      disabled={saving === photo.id}
                      className="rounded bg-white/90 px-3 py-1 text-xs font-medium text-stone-900 hover:bg-white"
                    >
                      {saving === photo.id ? "保存中..." : "+ 添加到素材库"}
                    </button>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100">
                    <p className="text-xs text-white">
                      Photo by{" "}
                      <a
                        href={`https://unsplash.com/@${photo.user.username}?utm_source=hibiz&utm_medium=referral`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {photo.user.name}
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {results.length < total && (
            <div className="mt-6 text-center">
              <button
                onClick={handleLoadMore}
                disabled={pending}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                加载更多
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

### `src/components/media/ImageUploader.tsx`

```typescript
"use client";

import { useRef, useState, useTransition } from "react";
import { uploadImageToLibrary } from "@/app/app/projects/media-actions";
import type { MediaCategory } from "@/types/media-asset";

interface ImageUploaderProps {
  projectId: string;
  defaultCategory?: MediaCategory;
  onUploaded?: () => void;
}

export function ImageUploader({ projectId, defaultCategory = "general", onUploaded }: ImageUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFiles = (files: FileList) => {
    const file = files[0];
    if (!file) return;

    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", defaultCategory);
        await uploadImageToLibrary(projectId, fd);
        onUploaded?.();
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    });
  };

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragActive ? "border-indigo-500 bg-indigo-50" : "border-stone-300 bg-stone-50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {pending ? (
        <p className="text-sm text-indigo-700">上传中...</p>
      ) : (
        <>
          <p className="text-sm text-stone-700">拖拽图片到此处，或</p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            选择文件
          </button>
          <p className="mt-2 text-xs text-stone-500">支持 JPEG, PNG, WebP · 最大 10MB</p>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

### `src/components/media/MediaGrid.tsx`

```typescript
"use client";

import { useState } from "react";
import type { MediaAsset, MediaCategory } from "@/types/media-asset";
import { CATEGORY_LABELS, MEDIA_CATEGORIES } from "@/types/media-asset";

interface MediaGridProps {
  assets: MediaAsset[];
  onDelete?: (id: string) => void;
  onCategoryChange?: (id: string, category: MediaCategory) => void;
  selectable?: boolean;
  onSelect?: (asset: MediaAsset) => void;
}

export function MediaGrid({ assets, onDelete, onCategoryChange, selectable, onSelect }: MediaGridProps) {
  const [filter, setFilter] = useState<MediaCategory | "all">("all");

  const filtered = filter === "all" ? assets : assets.filter((a) => a.category === filter);

  return (
    <div>
      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filter === "all" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          全部 ({assets.length})
        </button>
        {MEDIA_CATEGORIES.map((cat) => {
          const count = assets.filter((a) => a.category === cat).length;
          if (count === 0) return null;
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === cat ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              {CATEGORY_LABELS[cat]} ({count})
            </button>
          );
        })}
      </div>

      {/* 图片网格 */}
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-stone-500 py-12">暂无图片</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className={`group relative overflow-hidden rounded-lg border border-stone-200 bg-white ${
                selectable ? "cursor-pointer hover:ring-2 hover:ring-indigo-500" : ""
              }`}
              onClick={() => selectable && onSelect?.(asset)}
            >
              <img
                src={asset.thumbnail_url ?? asset.url}
                alt={asset.alt_text ?? ""}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />

              {/* 底部信息 */}
              <div className="p-2">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
                    {asset.source === "unsplash" ? "Unsplash" : asset.source === "upload" ? "上传" : "AI"}
                  </span>
                  {onDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(asset.id); }}
                      className="text-xs text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      删除
                    </button>
                  )}
                </div>

                {/* Unsplash 归属 */}
                {asset.source === "unsplash" && asset.unsplash_photographer && (
                  <p className="mt-1 text-[10px] text-stone-400">
                    by{" "}
                    <a href={asset.unsplash_photographer_url ?? "#"} target="_blank" rel="noopener noreferrer" className="underline">
                      {asset.unsplash_photographer}
                    </a>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### `src/components/media/MediaPicker.tsx`

可复用的图片选择器，供 poster / social / build 模块调用：

```typescript
"use client";

import { useState } from "react";
import type { MediaAsset } from "@/types/media-asset";
import { MediaGrid } from "./MediaGrid";
import { UnsplashSearch } from "./UnsplashSearch";
import { ImageUploader } from "./ImageUploader";

interface MediaPickerProps {
  projectId: string;
  assets: MediaAsset[];
  onSelect: (asset: MediaAsset) => void;
  onClose: () => void;
}

type Tab = "library" | "unsplash" | "upload";

export function MediaPicker({ projectId, assets, onSelect, onClose }: MediaPickerProps) {
  const [tab, setTab] = useState<Tab>("library");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-stone-900">选择图片</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900">
            X
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-6 border-b border-stone-200">
          {([
            { id: "library" as Tab, label: "素材库" },
            { id: "unsplash" as Tab, label: "Unsplash 搜索" },
            { id: "upload" as Tab, label: "上传新图" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "library" && (
          <MediaGrid assets={assets} selectable onSelect={onSelect} />
        )}
        {tab === "unsplash" && (
          <UnsplashSearch projectId={projectId} />
        )}
        {tab === "upload" && (
          <ImageUploader projectId={projectId} />
        )}
      </div>
    </div>
  );
}
```

---

## Part 5: 页面

### `src/app/app/projects/[id]/media/page.tsx`

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MediaLibraryClient } from "./media-library-client";

export const dynamic = "force-dynamic";

interface MediaPageProps {
  params: { id: string };
}

export default async function MediaPage({ params }: MediaPageProps) {
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const { data: assets } = await supabase
    .from("media_assets")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <Link href={`/app/projects/${params.id}`} className="text-sm text-emerald-800 hover:underline">
        ← {project.name}
      </Link>

      <div className="mt-6">
        <h1 className="text-2xl font-bold text-stone-900">素材库</h1>
        <p className="mt-1 text-sm text-stone-600">
          管理网站、海报、社媒使用的所有图片
        </p>
      </div>

      <MediaLibraryClient projectId={params.id} initialAssets={assets ?? []} />
    </div>
  );
}
```

### `src/app/app/projects/[id]/media/media-library-client.tsx`

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaGrid } from "@/components/media/MediaGrid";
import { UnsplashSearch } from "@/components/media/UnsplashSearch";
import { ImageUploader } from "@/components/media/ImageUploader";
import { deleteMediaAsset } from "@/app/app/projects/media-actions";
import type { MediaAsset } from "@/types/media-asset";

type ActiveTab = "library" | "unsplash" | "upload";

interface MediaLibraryClientProps {
  projectId: string;
  initialAssets: MediaAsset[];
}

export function MediaLibraryClient({ projectId, initialAssets }: MediaLibraryClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ActiveTab>("library");

  const handleRefresh = () => router.refresh();

  const handleDelete = async (assetId: string) => {
    if (!confirm("确定删除这张图片？")) return;
    await deleteMediaAsset(projectId, assetId);
    handleRefresh();
  };

  return (
    <div className="mt-8">
      {/* Tab 导航 */}
      <div className="flex gap-3 border-b border-stone-200 mb-6">
        {([
          { id: "library" as ActiveTab, label: "我的素材", count: initialAssets.length },
          { id: "unsplash" as ActiveTab, label: "Unsplash 搜索" },
          { id: "upload" as ActiveTab, label: "上传图片" },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-stone-600 hover:text-stone-900"
            }`}
          >
            {t.label}
            {"count" in t && t.count != null && (
              <span className="ml-1 text-xs text-stone-400">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === "library" && (
        <MediaGrid assets={initialAssets} onDelete={handleDelete} />
      )}
      {tab === "unsplash" && (
        <UnsplashSearch projectId={projectId} onSaved={handleRefresh} />
      )}
      {tab === "upload" && (
        <ImageUploader projectId={projectId} onUploaded={handleRefresh} />
      )}

      {/* 统计 */}
      <div className="mt-8 rounded-lg bg-stone-50 p-4 text-xs text-stone-600">
        <p>
          共 {initialAssets.length} 张图片 ·
          上传 {initialAssets.filter((a) => a.source === "upload").length} ·
          Unsplash {initialAssets.filter((a) => a.source === "unsplash").length} ·
          AI 生成 {initialAssets.filter((a) => a.source === "ai_generated").length}
        </p>
      </div>
    </div>
  );
}
```

### `src/app/app/projects/[id]/media/generate/page.tsx`

```typescript
import Link from "next/link";

interface GeneratePageProps {
  params: { id: string };
}

export default function MediaGeneratePage({ params }: GeneratePageProps) {
  return (
    <div>
      <Link href={`/app/projects/${params.id}/media`} className="text-sm text-emerald-800 hover:underline">
        ← 素材库
      </Link>

      <div className="mt-6">
        <h1 className="text-2xl font-bold text-stone-900">AI 图片生成</h1>
        <p className="mt-1 text-sm text-stone-600">使用 AI 生成高质量图片</p>
      </div>

      <div className="mt-8 rounded-xl border-2 border-dashed border-stone-300 p-12 text-center">
        <p className="text-lg font-medium text-stone-700">即将推出</p>
        <p className="mt-2 text-sm text-stone-500">
          AI 图片生成功能正在开发中。目前你可以使用 Unsplash 搜索或上传自有图片。
        </p>
        <Link
          href={`/app/projects/${params.id}/media`}
          className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
        >
          前往素材库
        </Link>
      </div>
    </div>
  );
}
```

---

## Part 6: 侧栏导航更新

在 `src/components/project-workflow-sidebar.tsx` 中增加素材库链接：

```typescript
// 在 SECONDARY_LINKS 中添加（或在 WORKFLOW_STEPS 之后新增分组）：
{ label: "素材库", path: "/media" },
```

---

## 环境变量

`.env.local` 需新增：

```
UNSPLASH_ACCESS_KEY=your_key_here
```

注册获取：https://unsplash.com/oauth/applications
- 创建应用 → 获取 Access Key
- Demo 模式：50 请求/小时
- 申请 Production：5000 请求/小时

---

## 实现清单

### 数据库
- [ ] 创建迁移 `20260409120000_media_assets.sql`（含 RLS + Storage bucket）
- [ ] 执行迁移

### 类型
- [ ] `src/types/media-asset.ts`

### 后端
- [ ] `src/lib/media/unsplash-client.ts` — Unsplash API 客户端
- [ ] `src/app/app/projects/media-actions.ts` — Server Actions

### 组件
- [ ] `src/components/media/UnsplashSearch.tsx` — Unsplash 搜索面板
- [ ] `src/components/media/ImageUploader.tsx` — 拖拽上传
- [ ] `src/components/media/MediaGrid.tsx` — 图片网格 + 分类筛选
- [ ] `src/components/media/MediaPicker.tsx` — 可复用的选择器

### 页面
- [ ] `src/app/app/projects/[id]/media/page.tsx` — 素材库主页
- [ ] `src/app/app/projects/[id]/media/media-library-client.tsx` — 客户端交互
- [ ] `src/app/app/projects/[id]/media/generate/page.tsx` — AI 生成（占位）

### 侧栏
- [ ] 更新 `project-workflow-sidebar.tsx` 添加素材库链接

### 验证
- [ ] `npm run build` 通过
- [ ] `npm run test` 16/16 通过
- [ ] 浏览器测试：Unsplash 搜索 + 上传 + 删除 + 分类

---

## 验收标准

- ✅ Unsplash 搜索能搜到图片并保存到素材库
- ✅ Unsplash 归属正确显示（摄影师 + Unsplash 链接 + utm 参数）
- ✅ 图片上传到 Supabase Storage 并显示在素材库
- ✅ 分类筛选正常（全部 / Hero / 房源 / 海报 等）
- ✅ 删除图片同时清理 Storage 文件
- ✅ AI 生成页面显示"即将推出"占位
- ✅ 侧栏有"素材库"入口
- ✅ `npm run build` 通过
- ✅ 无硬编码 API key

---

## 禁止事项

❌ 不要在客户端暴露 UNSPLASH_ACCESS_KEY（只在 server action 中使用）
❌ 不要跳过 Unsplash 归属要求
❌ 不要允许上传超过 10MB 的文件
❌ 不要修改现有的测试文件
❌ 不要改变现有路由结构（只新增 /media）
