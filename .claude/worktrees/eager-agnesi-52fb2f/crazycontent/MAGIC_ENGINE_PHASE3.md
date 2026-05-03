# Magic Engine — Phase 3 Brief
## 视觉生成 + HeyGen 数字人

> Phase 1 ✅ SEMrush → Supabase
> Phase 2 ✅ 视频转录 + Route B 内容改写
> Phase 3 目标：根据 visual_brief 自动生成图片/视频/数字人，存入 Supabase Storage

---

## 架构概览

```
content_posts.visual_brief（文字提示词）
    ↓
POST /api/visual/image   → ModelsLab → 秒级返回 → 存 Storage
POST /api/visual/video   → Seedance 2.0 → 返回 job_id（异步）
POST /api/visual/avatar  → HeyGen → 返回 video_id（异步）
    ↓
GET /api/visual/status/[jobId]   轮询状态
    ↓
生成完成 → 上传 Supabase Storage → 写入 visual_assets 表
    ↓
前端/Airtable 可见成品素材
```

**关键设计：** 图片同步，视频/数字人异步。视频生成需要轮询，用 `visual_assets.generation_status` 追踪。

---

## Step 1：新增 visual_assets 表

在 Supabase SQL Editor 执行：

```sql
-- Phase 3: Visual Assets Table
CREATE TABLE IF NOT EXISTS public.visual_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES public.clients(id),

  -- 素材信息
  asset_type          text NOT NULL CHECK (asset_type IN ('image','video','avatar_video')),
  provider            text NOT NULL CHECK (provider IN ('modelslab','seedance','heygen')),
  prompt_used         text,
  variant             smallint DEFAULT 1 CHECK (variant IN (1,2)),

  -- 生成状态（异步任务关键字段）
  generation_status   text NOT NULL DEFAULT 'pending'
                      CHECK (generation_status IN ('pending','generating','ready','failed')),
  provider_job_id     text,       -- Seedance/HeyGen 返回的异步 job ID
  error_message       text,
  retry_count         smallint DEFAULT 0,

  -- 文件信息（生成完成后填写）
  storage_url         text,       -- Supabase Storage 公开 URL
  provider_url        text,       -- 第三方原始 URL（备份）
  file_size_kb        integer,
  duration_seconds    numeric(5,1),
  resolution          text,

  -- 人工审核
  is_selected         boolean DEFAULT false,   -- 人工选定的版本

  -- 成本追踪
  cost_usd            numeric(6,4),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visual_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.visual_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_visual_assets_post ON public.visual_assets(post_id);
CREATE INDEX idx_visual_assets_pending ON public.visual_assets(generation_status)
  WHERE generation_status IN ('pending','generating');

CREATE TRIGGER visual_assets_updated_at
  BEFORE UPDATE ON public.visual_assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 在 Supabase Storage 建立 bucket（在 Dashboard 手动创建，或用以下 SQL）
-- Bucket 名称：visual-assets，设为 public
INSERT INTO storage.buckets (id, name, public)
VALUES ('visual-assets', 'visual-assets', true)
ON CONFLICT (id) DO NOTHING;
```

---

## Step 2：ModelsLab 图片生成 Client

新建文件 `src/lib/visual/modelslab.ts`：

```typescript
// ModelsLab Image Generation Client
// $29/月无限量，支持 Flux 等 10,000+ 模型

const MODELSLAB_BASE = 'https://modelslab.com/api/v6'
const API_KEY = process.env.MODELSLAB_API_KEY!

export interface ImageGenerationResult {
  image_url: string
  provider_id: string
  cost_usd: number
}

export async function generateImage(params: {
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  model?: string
}): Promise<ImageGenerationResult> {
  const {
    prompt,
    negative_prompt = 'blurry, low quality, watermark, text overlay',
    width = 1024,
    height = 1024,
    model = 'flux',
  } = params

  const res = await fetch(`${MODELSLAB_BASE}/realtime/text2img`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key: API_KEY,
      prompt,
      negative_prompt,
      width: String(width),
      height: String(height),
      samples: '1',
      safety_checker: false,
      enhance_prompt: true,
    }),
  })

  if (!res.ok) throw new Error(`ModelsLab error: ${res.status}`)

  const data = await res.json()

  if (data.status === 'error') {
    throw new Error(`ModelsLab generation failed: ${data.message}`)
  }

  const imageUrl = data.output?.[0] || data.proxy_links?.[0]
  if (!imageUrl) throw new Error('No image URL in ModelsLab response')

  return {
    image_url: imageUrl,
    provider_id: data.id || String(Date.now()),
    cost_usd: 0.002, // 固定估算，$29/月摊销
  }
}

// 为社媒生成多尺寸版本
export async function generateSocialImages(visualBrief: string): Promise<{
  square: ImageGenerationResult    // 1:1 for Instagram
  portrait: ImageGenerationResult  // 9:16 for TikTok/Stories
  landscape: ImageGenerationResult // 16:9 for Facebook
}> {
  const enhancedPrompt = `${visualBrief}, professional photography, vibrant colors, social media optimized`

  const [square, portrait, landscape] = await Promise.all([
    generateImage({ prompt: enhancedPrompt, width: 1024, height: 1024 }),
    generateImage({ prompt: enhancedPrompt, width: 576, height: 1024 }),
    generateImage({ prompt: enhancedPrompt, width: 1024, height: 576 }),
  ])

  return { square, portrait, landscape }
}
```

---

## Step 3：Seedance 2.0 视频生成 Client（异步）

新建文件 `src/lib/visual/seedance.ts`：

```typescript
// Seedance 2.0 Video Generation Client
// Via Atlas Cloud API — $0.022/秒，Fast mode
// 异步生成，需轮询状态

const ATLAS_BASE = 'https://api.atlascloud.ai/v1'
const API_KEY = process.env.ATLAS_CLOUD_API_KEY!

export interface VideoJobResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

// 提交视频生成任务（立即返回 job_id）
export async function submitVideoGeneration(params: {
  prompt: string
  duration?: number         // 秒，默认6
  resolution?: '720p' | '1080p'
  aspect_ratio?: '9:16' | '16:9' | '1:1'
}): Promise<{ job_id: string }> {
  const {
    prompt,
    duration = 6,
    resolution = '720p',
    aspect_ratio = '9:16',  // TikTok 竖屏默认
  } = params

  const res = await fetch(`${ATLAS_BASE}/video/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'seedance-2.0-fast',
      prompt,
      duration,
      resolution,
      aspect_ratio,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Seedance submit error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { job_id: data.job_id || data.id }
}

// 查询生成状态
export async function checkVideoStatus(jobId: string): Promise<VideoJobResult> {
  const res = await fetch(`${ATLAS_BASE}/video/status/${jobId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  })

  if (!res.ok) throw new Error(`Seedance status error: ${res.status}`)

  const data = await res.json()

  return {
    job_id: jobId,
    status: mapStatus(data.status),
    video_url: data.output_url || data.video_url,
    duration_seconds: data.duration,
    cost_usd: data.duration ? data.duration * 0.022 : undefined,
    error: data.error,
  }
}

function mapStatus(raw: string): VideoJobResult['status'] {
  const map: Record<string, VideoJobResult['status']> = {
    'queued': 'pending',
    'processing': 'processing',
    'running': 'processing',
    'succeeded': 'completed',
    'completed': 'completed',
    'failed': 'failed',
    'error': 'failed',
  }
  return map[raw] || 'pending'
}
```

---

## Step 4：HeyGen 数字人 Client（异步）

新建文件 `src/lib/visual/heygen.ts`：

```typescript
// HeyGen Avatar Video Client
// 数字人讲解视频生成

const HEYGEN_BASE = 'https://api.heygen.com/v2'
const API_KEY = process.env.HEYGEN_API_KEY!

export interface AvatarJobResult {
  video_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  duration_seconds?: number
  error?: string
}

// 获取可用 Avatar 列表（首次使用时调用，缓存结果）
export async function listAvatars(): Promise<{ id: string; name: string; preview_url: string }[]> {
  const res = await fetch(`${HEYGEN_BASE}/avatars`, {
    headers: { 'X-Api-Key': API_KEY },
  })
  const data = await res.json()
  return data.data?.avatars || []
}

// 提交数字人视频生成
export async function submitAvatarVideo(params: {
  script: string
  avatar_id?: string      // 不传则用默认 Avatar
  voice_id?: string       // 声音 ID
  background?: string     // 背景颜色或图片 URL
  resolution?: '360p' | '720p' | '1080p'
}): Promise<{ video_id: string }> {
  const {
    script,
    avatar_id = process.env.HEYGEN_DEFAULT_AVATAR_ID || '',
    voice_id = process.env.HEYGEN_DEFAULT_VOICE_ID || '',
    background = '#f0f0f0',
    resolution = '720p',
  } = params

  const res = await fetch(`${HEYGEN_BASE}/video/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: script,
          voice_id,
          speed: 1.0,
        },
        background: {
          type: background.startsWith('#') ? 'color' : 'image',
          value: background,
        },
      }],
      dimension: resolution === '1080p'
        ? { width: 1920, height: 1080 }
        : { width: 1280, height: 720 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`HeyGen submit error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { video_id: data.data?.video_id }
}

// 查询状态
export async function checkAvatarStatus(videoId: string): Promise<AvatarJobResult> {
  const res = await fetch(`${HEYGEN_BASE}/video_status.get?video_id=${videoId}`, {
    headers: { 'X-Api-Key': API_KEY },
  })

  if (!res.ok) throw new Error(`HeyGen status error: ${res.status}`)

  const data = await res.json()
  const video = data.data

  return {
    video_id: videoId,
    status: mapHeyGenStatus(video?.status),
    video_url: video?.video_url,
    duration_seconds: video?.duration,
    error: video?.error,
  }
}

function mapHeyGenStatus(raw?: string): AvatarJobResult['status'] {
  const map: Record<string, AvatarJobResult['status']> = {
    'pending': 'pending',
    'processing': 'processing',
    'completed': 'completed',
    'failed': 'failed',
  }
  return map[raw || ''] || 'pending'
}
```

---

## Step 5：Supabase Storage 上传工具

新建文件 `src/lib/visual/storage.ts`：

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'visual-assets'

// 从 URL 下载文件并上传到 Supabase Storage
export async function uploadFromUrl(params: {
  sourceUrl: string
  clientId: string
  postId: string
  assetType: 'image' | 'video' | 'avatar_video'
  variant: 1 | 2
}): Promise<{ storage_url: string; file_size_kb: number }> {
  const { sourceUrl, clientId, postId, assetType, variant } = params

  // 下载文件
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Failed to fetch asset from ${sourceUrl}`)

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const fileSizeKb = Math.round(bytes.length / 1024)

  // 确定扩展名
  const ext = assetType === 'image' ? 'jpg' : 'mp4'
  const timestamp = Date.now()
  const path = `${clientId}/${postId}/${assetType}-v${variant}-${timestamp}.${ext}`

  // 上传
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: assetType === 'image' ? 'image/jpeg' : 'video/mp4',
      upsert: true,
    })

  if (error) throw error

  // 获取公开 URL
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path)

  return {
    storage_url: urlData.publicUrl,
    file_size_kb: fileSizeKb,
  }
}
```

---

## Step 6：三个视觉生成 API 路由

### POST /api/visual/image（同步，秒级返回）

新建 `src/app/api/visual/image/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/visual/modelslab'
import { uploadFromUrl } from '@/lib/visual/storage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, variant = 1 } = await req.json()

    // 获取 visual_brief
    const { data: post } = await supabase
      .from('content_posts')
      .select('visual_brief, revision_notes')
      .eq('id', post_id)
      .single()

    if (!post?.visual_brief) {
      return NextResponse.json({ success: false, error: 'No visual_brief on this post' }, { status: 400 })
    }

    const prompt = post.revision_notes
      ? `${post.visual_brief}. Additional requirements: ${post.revision_notes}`
      : post.visual_brief

    // 生成图片
    const result = await generateImage({ prompt })

    // 上传到 Supabase Storage
    const { storage_url, file_size_kb } = await uploadFromUrl({
      sourceUrl: result.image_url,
      clientId: client_id,
      postId: post_id,
      assetType: 'image',
      variant,
    })

    // 写入 visual_assets
    const { data: asset } = await supabase
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'image',
        provider: 'modelslab',
        prompt_used: prompt,
        variant,
        generation_status: 'ready',
        storage_url,
        provider_url: result.image_url,
        file_size_kb,
        resolution: '1024x1024',
        cost_usd: result.cost_usd,
      })
      .select()
      .single()

    // 清空 revision_notes（已处理）
    if (post.revision_notes) {
      await supabase
        .from('content_posts')
        .update({ revision_notes: null })
        .eq('id', post_id)
    }

    return NextResponse.json({ success: true, asset })

  } catch (err: any) {
    console.error('[visual/image]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

### POST /api/visual/video（异步，返回 job_id）

新建 `src/app/api/visual/video/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { submitVideoGeneration } from '@/lib/visual/seedance'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, variant = 1, aspect_ratio = '9:16' } = await req.json()

    const { data: post } = await supabase
      .from('content_posts')
      .select('visual_brief, revision_notes')
      .eq('id', post_id)
      .single()

    if (!post?.visual_brief) {
      return NextResponse.json({ success: false, error: 'No visual_brief' }, { status: 400 })
    }

    const prompt = post.revision_notes
      ? `${post.visual_brief}. ${post.revision_notes}`
      : post.visual_brief

    // 提交异步任务
    const { job_id } = await submitVideoGeneration({ prompt, aspect_ratio })

    // 写入 visual_assets（status = generating）
    const { data: asset } = await supabase
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'video',
        provider: 'seedance',
        prompt_used: prompt,
        variant,
        generation_status: 'generating',
        provider_job_id: job_id,
      })
      .select()
      .single()

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      job_id,
      message: 'Video generation started. Poll /api/visual/status/:assetId for updates.',
    })

  } catch (err: any) {
    console.error('[visual/video]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

### POST /api/visual/avatar（HeyGen 数字人，异步）

新建 `src/app/api/visual/avatar/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { submitAvatarVideo } from '@/lib/visual/heygen'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, avatar_id, voice_id } = await req.json()

    const { data: post } = await supabase
      .from('content_posts')
      .select('script')
      .eq('id', post_id)
      .single()

    if (!post?.script) {
      return NextResponse.json({ success: false, error: 'No script on this post' }, { status: 400 })
    }

    const { video_id } = await submitAvatarVideo({
      script: post.script,
      avatar_id,
      voice_id,
    })

    const { data: asset } = await supabase
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'avatar_video',
        provider: 'heygen',
        prompt_used: post.script,
        generation_status: 'generating',
        provider_job_id: video_id,
      })
      .select()
      .single()

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      video_id,
      message: 'Avatar video generation started. Poll /api/visual/status/:assetId.',
    })

  } catch (err: any) {
    console.error('[visual/avatar]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

## Step 7：状态轮询 API（关键）

新建 `src/app/api/visual/status/[assetId]/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const { data: asset } = await supabase
      .from('visual_assets')
      .select('*')
      .eq('id', params.assetId)
      .single()

    if (!asset) {
      return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    }

    // 已完成或失败，直接返回
    if (['ready', 'failed'].includes(asset.generation_status)) {
      return NextResponse.json({ success: true, asset })
    }

    // 查询第三方状态
    let providerResult: { status: string; video_url?: string; duration_seconds?: number; cost_usd?: number; error?: string }

    if (asset.provider === 'seedance') {
      providerResult = await checkVideoStatus(asset.provider_job_id)
    } else if (asset.provider === 'heygen') {
      providerResult = await checkAvatarStatus(asset.provider_job_id)
    } else {
      return NextResponse.json({ success: true, asset })
    }

    // 如果完成，上传到 Storage 并更新记录
    if (providerResult.status === 'completed' && providerResult.video_url) {
      const { storage_url, file_size_kb } = await uploadFromUrl({
        sourceUrl: providerResult.video_url,
        clientId: asset.client_id,
        postId: asset.post_id,
        assetType: asset.asset_type,
        variant: asset.variant,
      })

      const { data: updated } = await supabase
        .from('visual_assets')
        .update({
          generation_status: 'ready',
          storage_url,
          provider_url: providerResult.video_url,
          file_size_kb,
          duration_seconds: providerResult.duration_seconds,
          cost_usd: providerResult.cost_usd,
        })
        .eq('id', params.assetId)
        .select()
        .single()

      return NextResponse.json({ success: true, asset: updated, just_completed: true })
    }

    // 如果失败
    if (providerResult.status === 'failed') {
      await supabase
        .from('visual_assets')
        .update({ generation_status: 'failed', error_message: providerResult.error })
        .eq('id', params.assetId)
    }

    return NextResponse.json({
      success: true,
      asset: { ...asset, generation_status: providerResult.status },
      still_processing: providerResult.status === 'processing',
    })

  } catch (err: any) {
    console.error('[visual/status]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

## Step 8：Cron 任务——批量处理待完成的视频

在现有的 cron 结构上新增，文件 `src/app/api/cron/poll-visual-jobs/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 每2分钟由 Render Cron 调用
export async function GET(req: NextRequest) {
  // 鉴权
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 找所有 generating 状态的任务
  const { data: pendingAssets } = await supabase
    .from('visual_assets')
    .select('*')
    .eq('generation_status', 'generating')
    .lt('retry_count', 10)   // 最多轮询10次（约20分钟）

  if (!pendingAssets?.length) {
    return NextResponse.json({ processed: 0 })
  }

  let completed = 0, failed = 0, stillPending = 0

  for (const asset of pendingAssets) {
    try {
      let result: any

      if (asset.provider === 'seedance') {
        result = await checkVideoStatus(asset.provider_job_id)
      } else if (asset.provider === 'heygen') {
        result = await checkAvatarStatus(asset.provider_job_id)
      } else continue

      if (result.status === 'completed' && result.video_url) {
        const { storage_url, file_size_kb } = await uploadFromUrl({
          sourceUrl: result.video_url,
          clientId: asset.client_id,
          postId: asset.post_id,
          assetType: asset.asset_type,
          variant: asset.variant,
        })

        await supabase.from('visual_assets').update({
          generation_status: 'ready',
          storage_url,
          provider_url: result.video_url,
          file_size_kb,
          duration_seconds: result.duration_seconds,
          cost_usd: result.cost_usd,
        }).eq('id', asset.id)

        completed++

      } else if (result.status === 'failed') {
        await supabase.from('visual_assets').update({
          generation_status: 'failed',
          error_message: result.error,
        }).eq('id', asset.id)
        failed++

      } else {
        // 还在处理中，增加重试计数
        await supabase.from('visual_assets')
          .update({ retry_count: asset.retry_count + 1 })
          .eq('id', asset.id)
        stillPending++
      }

    } catch (err: any) {
      console.error(`[poll-visual-jobs] Error for asset ${asset.id}:`, err)
    }
  }

  return NextResponse.json({ processed: pendingAssets.length, completed, failed, stillPending })
}
```

在 `render.yaml` 新增 cron（在现有 crons 列表下追加）：

```yaml
# 在 render.yaml 的 services 或 crons 部分添加
- type: cron
  name: poll-visual-jobs
  schedule: "*/2 * * * *"   # 每2分钟
  buildCommand: ""
  startCommand: curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.onrender.com/api/cron/poll-visual-jobs
```

---

## Step 9：新增环境变量

在 `.env.local` 追加：

```env
ATLAS_CLOUD_API_KEY=       # Seedance 2.0，从 atlascloud.ai 获取
HEYGEN_API_KEY=            # HeyGen，从 heygen.com 获取
HEYGEN_DEFAULT_AVATAR_ID=  # 默认 Avatar ID（从 /api/visual/avatar-list 获取）
HEYGEN_DEFAULT_VOICE_ID=   # 默认声音 ID
CRON_SECRET=               # 随机字符串，保护 cron 端点
```

---

## Step 10：验证 Phase 3

```bash
# 1. 确认 visual_assets 表已创建
# Supabase Dashboard → Table Editor → visual_assets

# 2. 测试图片生成（同步，几秒返回）
curl -X POST http://localhost:3000/api/visual/image \
  -H "Content-Type: application/json" \
  -d '{
    "post_id": "你的 content_post UUID",
    "client_id": "cts-client-001",
    "variant": 1
  }'
# 预期：返回 asset 对象，storage_url 有值，generation_status = "ready"

# 3. 测试视频生成（异步，返回 job_id）
curl -X POST http://localhost:3000/api/visual/video \
  -H "Content-Type: application/json" \
  -d '{
    "post_id": "你的 content_post UUID",
    "client_id": "cts-client-001"
  }'
# 预期：返回 asset_id 和 job_id

# 4. 轮询状态（隔30秒查一次）
curl http://localhost:3000/api/visual/status/{asset_id}
# 等待 generation_status 变为 "ready"，storage_url 出现

# 5. 验证 Supabase Storage
# Dashboard → Storage → visual-assets bucket
# 应该能看到上传的图片/视频文件

# 6. 测试 HeyGen（需要真实 API Key）
curl -X POST http://localhost:3000/api/visual/avatar \
  -H "Content-Type: application/json" \
  -d '{
    "post_id": "你的 content_post UUID",
    "client_id": "cts-client-001"
  }'
```

---

## Phase 3 完成标志

- ✅ `visual_assets` 表已创建
- ✅ Supabase Storage bucket `visual-assets` 已创建且为 public
- ✅ `/api/visual/image` 同步生成图片，storage_url 有值
- ✅ `/api/visual/video` 提交 Seedance 任务，返回 job_id
- ✅ `/api/visual/status/:id` 轮询到 ready，storage_url 出现
- ✅ Cron 任务能自动处理 generating 状态的任务
- ✅ HeyGen avatar 视频生成跑通（或 API Key 待配置时可 skip）

---

## Phase 4 预告

Phase 4：**Airtable 双向同步**
- keywords（status=new）→ Airtable Keywords 表
- content_posts（status=draft）→ Airtable Content Calendar 表
- Airtable approved → webhook → Supabase status 更新
- approved 自动触发视觉生成 + Publer 推送
