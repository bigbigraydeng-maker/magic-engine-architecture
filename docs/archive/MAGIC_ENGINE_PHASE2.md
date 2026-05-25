# Magic Engine — Phase 2 Brief
## 视频转录 + Route B 爆款视频改写管道

> Phase 1 已完成 ✅ SEMrush → Supabase 全链路跑通
> Phase 2 目标：输入一个视频 URL，输出一份完整的社媒内容包

---

## Phase 2 要做什么

Route B 的完整流程：

```
用户粘贴视频 URL（TikTok / YouTube / Facebook / Instagram）
    ↓
POST /api/transcript          Supadata API 提取转录文本 + 元数据
    ↓
POST /api/content/route-b     7维度分析 + 结合 Master Brief 改写
    ↓
写入 Supabase content_posts   status = 'draft'，生成2个变体
    ↓
返回完整 Content Package
```

---

## Step 1：接入 Supadata API

**文档：** https://docs.supadata.ai/get-transcript

新建文件 `src/lib/supadata/client.ts`：

```typescript
// Supadata Client — 多平台视频转录
// 支持：YouTube / TikTok / Instagram / Facebook / X

const SUPADATA_BASE = 'https://api.supadata.ai/v1'
const API_KEY = process.env.SUPADATA_API_KEY!

export interface VideoTranscript {
  transcript: string            // 完整转录文本
  segments?: TranscriptSegment[]
  metadata: VideoMetadata
}

export interface TranscriptSegment {
  start: number                 // 开始时间（秒）
  end: number
  text: string
}

export interface VideoMetadata {
  title?: string
  description?: string
  duration?: number             // 秒
  view_count?: number
  platform: string              // youtube / tiktok / facebook / instagram
  url: string
}

export async function getVideoTranscript(videoUrl: string): Promise<VideoTranscript> {
  const res = await fetch(`${SUPADATA_BASE}/youtube/transcript`, {
    method: 'GET',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
  })

  // Supadata 统一 endpoint，自动识别平台
  const transcriptRes = await fetch(
    `${SUPADATA_BASE}/video/transcript?url=${encodeURIComponent(videoUrl)}`,
    {
      headers: { 'x-api-key': API_KEY },
      next: { revalidate: 0 },
    }
  )

  if (!transcriptRes.ok) {
    const err = await transcriptRes.text()
    throw new Error(`Supadata error ${transcriptRes.status}: ${err}`)
  }

  const data = await transcriptRes.json()

  // 解析平台
  const platform = detectPlatform(videoUrl)

  return {
    transcript: data.content || data.transcript || '',
    segments: data.chunks?.map((c: any) => ({
      start: c.offset / 1000,
      end: (c.offset + c.duration) / 1000,
      text: c.text,
    })),
    metadata: {
      title: data.title,
      description: data.description,
      duration: data.duration,
      view_count: data.view_count,
      platform,
      url: videoUrl,
    },
  }
}

function detectPlatform(url: string): string {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('tiktok.com')) return 'tiktok'
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook'
  if (url.includes('instagram.com')) return 'instagram'
  return 'unknown'
}
```

---

## Step 2：新建转录 API 路由

新建文件 `src/app/api/transcript/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getVideoTranscript } from '@/lib/supadata/client'

export async function POST(req: NextRequest) {
  try {
    const { video_url } = await req.json()

    if (!video_url) {
      return NextResponse.json(
        { success: false, error: 'video_url required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const result = await getVideoTranscript(video_url)

    return NextResponse.json({
      success: true,
      transcript: result.transcript,
      segments: result.segments,
      metadata: result.metadata,
    })

  } catch (err: any) {
    console.error('[transcript]', err)
    return NextResponse.json(
      { success: false, error: err.message, code: 'SUPADATA_ERROR' },
      { status: 500 }
    )
  }
}
```

---

## Step 3：视频7维度分析器

这是 Route B 的核心逻辑——从转录文本中提炼爆款结构。

新建文件 `src/lib/content/video-analyzer.ts`：

```typescript
// 爆款视频7维度分析器
// 输入：转录文本 + 元数据
// 输出：结构化的视频解析卡

export interface VideoAnalysis {
  hook: string              // 开头3秒的句式/钩子
  format: VideoFormat       // 内容形式
  emotion: EmotionType      // 情绪触点
  structure: ContentStructure  // 内容结构
  pacing: PacingType        // 节奏
  cta: string               // 结尾引导
  core_message: string      // 核心信息（一句话）
  key_points: string[]      // 主要内容要点（3-5条）
  duration_seconds?: number
}

export type VideoFormat =
  | 'talking_head'      // 对镜说话
  | 'text_overlay'      // 文字叠加
  | 'b_roll'            // B-roll 配音
  | 'before_after'      // 前后对比
  | 'ugc'               // 用户视角

export type EmotionType =
  | 'curiosity'         // 好奇
  | 'fomo'              // 错过恐惧
  | 'inspiration'       // 励志
  | 'humor'             // 幽默
  | 'shock'             // 震惊
  | 'aspiration'        // 向往

export type ContentStructure =
  | 'list'              // 列举式（X件事...）
  | 'story'             // 故事式（我试了X...）
  | 'problem_solution'  // 问题-解决
  | 'before_after'      // 前后对比
  | 'myth_busting'      // 辟谣
  | 'tutorial'          // 教程
  | 'review'            // 评测

export type PacingType = 'fast' | 'medium' | 'slow'

import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function analyzeViralVideo(
  transcript: string,
  metadata: { title?: string; duration?: number; platform: string }
): Promise<VideoAnalysis> {

  const prompt = `你是一位顶级社媒内容策略师，专门分析爆款视频的内容结构。

分析以下视频的转录文本，提炼出7个维度的关键信息。

视频信息：
- 平台：${metadata.platform}
- 标题：${metadata.title || '未知'}
- 时长：${metadata.duration ? `${metadata.duration}秒` : '未知'}

转录文本：
${transcript.slice(0, 3000)}  // 限制长度

请以 JSON 格式返回分析结果：
{
  "hook": "开头3秒的核心句式或视觉钩子（一句话）",
  "format": "talking_head | text_overlay | b_roll | before_after | ugc",
  "emotion": "curiosity | fomo | inspiration | humor | shock | aspiration",
  "structure": "list | story | problem_solution | before_after | myth_busting | tutorial | review",
  "pacing": "fast | medium | slow",
  "cta": "结尾的行动引导（一句话）",
  "core_message": "这个视频的核心信息/卖点（一句话）",
  "key_points": ["要点1", "要点2", "要点3"]
}

只返回 JSON，不要其他文字。`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const result = JSON.parse(response.choices[0].message.content || '{}')
  return result as VideoAnalysis
}
```

---

## Step 4：Master Brief 注入器

新建文件 `src/lib/content/brief-injector.ts`：

```typescript
// 将 Master Brief 注入内容生成 prompt
// 确保所有生成内容符合客户品牌DNA

import { createClient } from '@supabase/supabase-js'
import type { MasterBrief } from '@/types/magic-engine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function getActiveBrief(clientId: string): Promise<MasterBrief | null> {
  const { data } = await supabase
    .from('master_briefs')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  return data
}

export function formatBriefForPrompt(brief: MasterBrief): string {
  return `
客户品牌信息（必须严格遵守）：
- 品牌名称：${brief.brand_name}
- 一句话定位：${brief.tagline || '未设置'}
- 目标客群：${brief.primary_audience || '未设置'}
- 客群痛点：${brief.pain_points?.join('、') || '未设置'}
- 购买触发点：${brief.buying_trigger || '未设置'}
- 品牌语气：${brief.tone || '专业友好'}
- 语气示例：${brief.voice_examples?.join(' / ') || '未设置'}
- 禁止使用的词：${brief.avoid_words?.join('、') || '无'}
- 主力产品：${brief.products?.map(p => `${p.name}（${p.usp}）`).join('；') || '未设置'}
- 发布平台：${brief.platforms?.join('、') || 'Facebook, TikTok'}
`.trim()
}
```

---

## Step 5：Route B 内容改写引擎

新建文件 `src/lib/content/route-b-rewriter.ts`：

```typescript
import OpenAI from 'openai'
import type { VideoAnalysis } from './video-analyzer'
import type { MasterBrief } from '@/types/magic-engine'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface ContentPackage {
  variant: 1 | 2
  title: string
  script: string            // 视频脚本（逐句台词）
  caption: string           // 发布文案
  hashtags: string[]        // 10-15个标签
  visual_brief: string      // 给图片/视频生成的提示词
  platform_notes: string    // 平台适配说明
}

export async function rewriteForBrand(params: {
  analysis: VideoAnalysis
  brief: MasterBrief
  targetPlatforms: string[]
  variant: 1 | 2
}): Promise<ContentPackage> {
  const { analysis, brief, targetPlatforms, variant } = params

  const variantInstruction = variant === 1
    ? '这是变体1：保持原视频的主要结构和切入角度'
    : '这是变体2：换一个切入角度，比如从不同的情绪触点或不同的目标客群出发'

  const prompt = `你是一位专业的社媒内容创作者。

【任务】
根据一条爆款视频的结构，为客户创作一条全新的内容。
保留爆款的"壳"（结构、情绪、节奏），替换所有内容为客户的品牌和产品。

${variantInstruction}

【爆款视频结构分析】
- 钩子（Hook）：${analysis.hook}
- 内容形式：${analysis.format}
- 情绪触点：${analysis.emotion}
- 内容结构：${analysis.structure}
- 节奏：${analysis.pacing}
- 结尾引导：${analysis.cta}
- 核心信息：${analysis.core_message}
- 主要要点：${analysis.key_points.join('；')}

【客户品牌信息】
品牌：${brief.brand_name}
定位：${brief.tagline || ''}
目标客群：${brief.primary_audience || ''}
客群痛点：${brief.pain_points?.join('、') || ''}
品牌语气：${brief.tone || '专业友好'}
禁用词：${brief.avoid_words?.join('、') || '无'}
主力产品：${brief.products?.slice(0,3).map(p => `${p.name} - ${p.usp}`).join('；') || ''}

【发布平台】${targetPlatforms.join('、')}

请以 JSON 格式输出，只返回 JSON：
{
  "title": "这条内容的内部标题（简短描述）",
  "script": "完整视频脚本，按句分行，适合朗读或字幕显示，${analysis.pacing === 'fast' ? '控制在15-30秒' : analysis.pacing === 'medium' ? '控制在30-60秒' : '控制在60秒内'}",
  "caption": "发布时的配文，包含开头钩子、正文、结尾引导，适合${targetPlatforms[0]}风格",
  "hashtags": ["标签1", "标签2", "...共10-15个，中英文混合"],
  "visual_brief": "给AI图片/视频生成工具的提示词，描述画面风格、场景、色调，英文",
  "platform_notes": "针对各平台的发布建议（字数、格式、最佳发布时间等）"
}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  })

  const result = JSON.parse(response.choices[0].message.content || '{}')
  return { ...result, variant }
}
```

---

## Step 6：Route B API 路由

新建文件 `src/app/api/content/route-b/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getVideoTranscript } from '@/lib/supadata/client'
import { analyzeViralVideo } from '@/lib/content/video-analyzer'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { rewriteForBrand } from '@/lib/content/route-b-rewriter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { video_url, client_id, platforms } = await req.json()

    if (!video_url || !client_id) {
      return NextResponse.json(
        { success: false, error: 'video_url and client_id required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const targetPlatforms = platforms || ['facebook', 'tiktok']

    // 1. 获取 Master Brief
    const brief = await getActiveBrief(client_id)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client. Create one first.', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    // 2. 转录视频
    console.log('[route-b] Transcribing video:', video_url)
    const { transcript, metadata } = await getVideoTranscript(video_url)

    if (!transcript || transcript.length < 50) {
      return NextResponse.json(
        { success: false, error: 'Could not extract transcript from video', code: 'SUPADATA_ERROR' },
        { status: 422 }
      )
    }

    // 3. 7维度分析
    console.log('[route-b] Analyzing viral structure...')
    const analysis = await analyzeViralVideo(transcript, metadata)

    // 4. 生成2个变体
    console.log('[route-b] Generating content variants...')
    const [variant1, variant2] = await Promise.all([
      rewriteForBrand({ analysis, brief, targetPlatforms, variant: 1 }),
      rewriteForBrand({ analysis, brief, targetPlatforms, variant: 2 }),
    ])

    // 5. 写入 Supabase content_posts（2条记录）
    const postBase = {
      client_id,
      route: 'route_b' as const,
      platforms: targetPlatforms,
      source_video_url: video_url,
      source_brief_id: brief.id,
      status: 'draft' as const,
    }

    const { data: savedPosts, error } = await supabase
      .from('content_posts')
      .insert([
        {
          ...postBase,
          title:        `${variant1.title} [V1]`,
          script:       variant1.script,
          caption:      variant1.caption,
          hashtags:     variant1.hashtags,
          visual_brief: variant1.visual_brief,
        },
        {
          ...postBase,
          title:        `${variant2.title} [V2]`,
          script:       variant2.script,
          caption:      variant2.caption,
          hashtags:     variant2.hashtags,
          visual_brief: variant2.visual_brief,
        },
      ])
      .select()

    if (error) throw error

    return NextResponse.json({
      success: true,
      source_video: {
        url: video_url,
        platform: metadata.platform,
        title: metadata.title,
      },
      analysis,                 // 爆款结构分析（给前端展示）
      variants: [variant1, variant2],
      saved_posts: savedPosts,  // Supabase 记录
    })

  } catch (err: any) {
    console.error('[route-b]', err)
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    )
  }
}
```

---

## Step 7：新增一个测试用的 Master Brief

在 Supabase Dashboard → SQL Editor 执行，插入 CTS 的测试数据：

```sql
-- 先插入测试 client
INSERT INTO public.clients (id, name, domain, semrush_db, plan_tier)
VALUES (
  'cts-client-001',
  'CTS Tours NZ',
  'ctstours.co.nz',
  'au',
  'growth'
) ON CONFLICT (id) DO NOTHING;

-- 插入 CTS Master Brief
INSERT INTO public.master_briefs (
  client_id, brand_name, tagline, website,
  primary_audience, pain_points, buying_trigger,
  products, tone, voice_examples, avoid_words,
  content_topics, platforms, post_frequency,
  visual_style, image_preference
) VALUES (
  'cts-client-001',
  'CTS Tours NZ',
  'Your China experts in New Zealand',
  'https://ctstours.co.nz',
  '45-65岁新西兰夫妇，计划人生中第一次去中国旅游，预算充裕，注重安全和舒适',
  ARRAY['担心语言不通', '不知道如何申请签证', '不确定哪些景点值得去', '担心食物和卫生'],
  '看到真实的旅客评价和专业的行程安排',
  '[
    {"name": "A Tale of Two Cities", "description": "北京+西安12天", "price_range": "NZD 6,500起/人", "season": "全年", "usp": "长城+兵马俑一次看齐"},
    {"name": "Shanghai Surroundings", "description": "上海周边8天", "price_range": "NZD 4,800起/人", "season": "春秋最佳", "usp": "现代与古典的完美融合"}
  ]'::jsonb,
  '专业、温暖、值得信赖',
  ARRAY['我们的导游会全程照顾您', '30年中国旅游经验，让您放心出行'],
  ARRAY['cheap', 'budget', '便宜', '廉价'],
  ARRAY['中国旅游攻略', '签证指南', '景点推荐', '旅行安全', '美食推荐'],
  ARRAY['facebook', 'instagram'],
  '每周3条',
  'warm, professional, aspirational',
  '真实旅行照片优先，AI生成作为补充'
);
```

---

## Step 8：验证 Phase 2

```bash
# 1. 测试视频转录
curl -X POST http://localhost:3000/api/transcript \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# 预期：返回 transcript 文本 + metadata

# 2. 测试完整 Route B 管道
curl -X POST http://localhost:3000/api/content/route-b \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://www.youtube.com/watch?v=YOUR_TRAVEL_VIDEO",
    "client_id": "cts-client-001",
    "platforms": ["facebook", "tiktok"]
  }'

# 预期响应：
# {
#   "success": true,
#   "source_video": { "url": "...", "platform": "youtube", "title": "..." },
#   "analysis": { "hook": "...", "emotion": "...", ... },
#   "variants": [{ "script": "...", "caption": "...", "hashtags": [...] }, {...}],
#   "saved_posts": [{ "id": "uuid", "status": "draft", ... }, {...}]
# }

# 3. 确认 Supabase 写入
# Dashboard → content_posts 表应该有2条 status='draft' 的记录
```

---

## Phase 2 完成标志

- ✅ `POST /api/transcript` 能从 YouTube URL 拿到转录文本
- ✅ `POST /api/content/route-b` 完整跑通，返回2个内容变体
- ✅ content_posts 表写入2条 draft 记录，含 script / caption / hashtags / visual_brief
- ✅ analysis 字段包含7个维度的结构分析

---

## Phase 3 预告

Phase 3 将做：
- **视觉生成**：根据 visual_brief 调用 ModelsLab（图片）和 Seedance 2.0（视频）
- **HeyGen 数字人**：根据 script 生成 Avatar 视频
- **素材存入 Supabase Storage**，状态回写 content_posts

Phase 3 Brief 在 Phase 2 完成后提供。

---

## 注意事项

1. Supadata API Key 向 Zhong 获取，测试时可先用 YouTube 视频（转录最稳定）
2. OpenAI 已在现有 `crazycontent` 中接通，直接复用 `process.env.OPENAI_API_KEY`
3. `gpt-4o-mini` 是最经济的选择，内容生成质量足够
4. Route B 生成耗时约 15-30 秒（转录 + 分析 + 2次改写），前端需要 loading 状态
5. 2个变体用 `Promise.all` 并发生成，节省时间
