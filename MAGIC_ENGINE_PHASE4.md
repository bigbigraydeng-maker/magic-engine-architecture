# Magic Engine — Phase 4 Brief
## Airtable 双向同步 + Publer 发布

> Phase 1 ✅ SEMrush → Supabase
> Phase 2 ✅ 视频转录 + Route B 内容改写
> Phase 3 ✅ 图片生成 → Supabase Storage
> Phase 4 目标：打通人工审核层，approved 自动触发发布

---

## 整体数据流

```
方向 A（推送）：Magic Engine → Airtable
  新 keywords / content_posts 写入 Supabase
      ↓ 定时 cron（每小时）或手动触发
  Magic Engine 调用 Airtable API 创建记录
  回填 airtable_record_id 到 Supabase

方向 B（回写）：Airtable → Magic Engine
  人工在 Airtable 改 Status 为 Approved / Rejected
      ↓ Zapier 检测到变化（Trigger：Record Updated）
  Zapier → POST /api/webhooks/airtable-approved
  Magic Engine 更新 Supabase status
      ↓ 如果 approved
  自动触发：视觉生成（如尚未生成）→ Publer 发布
```

**客户看到的：** 只有 Airtable 界面，改一个字段，剩下全自动。

---

## Step 1：Airtable Client

新建文件 `src/lib/airtable/client.ts`：

```typescript
// Airtable REST API Client
// 文档：https://airtable.com/developers/web/api/introduction

const AIRTABLE_BASE = 'https://api.airtable.com/v0'
const API_KEY = process.env.AIRTABLE_API_KEY!

interface AirtableRecord {
  id: string
  fields: Record<string, any>
  createdTime: string
}

interface AirtableCreateResult {
  id: string
  fields: Record<string, any>
}

// 在指定 Base 的 Table 中创建记录
export async function createRecord(
  baseId: string,
  tableId: string,
  fields: Record<string, any>
): Promise<AirtableCreateResult> {
  const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable create error ${res.status}: ${err}`)
  }

  return res.json()
}

// 批量创建（最多10条/次）
export async function createRecords(
  baseId: string,
  tableId: string,
  records: Record<string, any>[]
): Promise<AirtableCreateResult[]> {
  const results: AirtableCreateResult[] = []

  // Airtable 每次最多10条
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10)
    const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })) }),
    })

    if (!res.ok) throw new Error(`Airtable batch create error: ${res.status}`)
    const data = await res.json()
    results.push(...data.records)
  }

  return results
}

// 更新记录
export async function updateRecord(
  baseId: string,
  tableId: string,
  recordId: string,
  fields: Record<string, any>
): Promise<AirtableRecord> {
  const res = await fetch(`${AIRTABLE_BASE}/${baseId}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) throw new Error(`Airtable update error: ${res.status}`)
  return res.json()
}

// 查询记录
export async function listRecords(
  baseId: string,
  tableId: string,
  options?: {
    filterByFormula?: string
    maxRecords?: number
    fields?: string[]
  }
): Promise<AirtableRecord[]> {
  const params = new URLSearchParams()
  if (options?.filterByFormula) params.set('filterByFormula', options.filterByFormula)
  if (options?.maxRecords) params.set('maxRecords', String(options.maxRecords))
  if (options?.fields) options.fields.forEach(f => params.append('fields[]', f))

  const res = await fetch(
    `${AIRTABLE_BASE}/${baseId}/${tableId}?${params}`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  )

  if (!res.ok) throw new Error(`Airtable list error: ${res.status}`)
  const data = await res.json()
  return data.records || []
}
```

---

## Step 2：Airtable 字段映射配置

新建文件 `src/lib/airtable/field-maps.ts`：

```typescript
// Airtable 字段名映射
// Airtable 表字段名 → Supabase 字段名 的对应关系
// 注意：Airtable 字段名区分大小写，以实际 Airtable 表为准

// ── Keywords 表 ──────────────────────────────────
export const KEYWORD_TO_AIRTABLE = (kw: any) => ({
  'Keyword':                kw.keyword,
  'Status':                 'New',
  'Opportunity Score':      kw.opportunity_score,
  'Volume':                 kw.volume,
  'KD':                     kw.kd,
  'CPC (USD)':              kw.cpc,
  'Intent':                 capitalize(kw.intent),
  'Source':                 formatSource(kw.source),
  'Competitor Source':      kw.competitor_source || '',
  'Recommended Page Type':  capitalize(kw.recommended_page_type || ''),
  'Supabase ID':            kw.id,
  'Created At':             kw.created_at?.split('T')[0],
})

// ── Content Posts 表 ──────────────────────────────
export const POST_TO_AIRTABLE = (post: any) => ({
  'Title':          post.title,
  'Status':         'Draft',
  'Route':          formatRoute(post.route),
  'Platforms':      post.platforms?.join(', '),
  'Script':         post.script || '',
  'Caption':        post.caption || '',
  'Hashtags':       post.hashtags?.join(' ') || '',
  'Visual Brief':   post.visual_brief || '',
  'Source URL':     post.source_video_url || '',
  'Supabase ID':    post.id,
  'Created At':     post.created_at?.split('T')[0],
})

// 辅助函数
function capitalize(s?: string) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatSource(s: string) {
  const map: Record<string, string> = {
    'semrush_batch':   'SEMrush Batch',
    'semrush_related': 'SEMrush Related',
    'semrush_gap':     'SEMrush Gap',
  }
  return map[s] || s
}

function formatRoute(s: string) {
  const map: Record<string, string> = {
    'route_a': 'Route A - SEO Keywords',
    'route_b': 'Route B - Viral Rewrite',
    'route_c': 'Route C - Master Brief',
  }
  return map[s] || s
}
```

---

## Step 3：Supabase → Airtable 同步 API

新建文件 `src/app/api/airtable/sync-keywords/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRecords } from '@/lib/airtable/client'
import { KEYWORD_TO_AIRTABLE } from '@/lib/airtable/field-maps'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 把 Supabase 中新的 keywords 推送到 Airtable
export async function POST(req: NextRequest) {
  try {
    const { client_id } = await req.json()

    // 查找有 client 的 airtable_base_id
    const { data: client } = await supabase
      .from('clients')
      .select('airtable_base_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json({ success: false, error: 'No Airtable base configured for this client' }, { status: 400 })
    }

    // 找未同步到 Airtable 的新关键词
    const { data: keywords } = await supabase
      .from('keywords')
      .select('*')
      .eq('client_id', client_id)
      .eq('status', 'new')
      .is('airtable_record_id', null)
      .limit(50)   // 每次最多50条

    if (!keywords?.length) {
      return NextResponse.json({ success: true, synced: 0, message: 'No new keywords to sync' })
    }

    // 按 opportunity_score 排序（最高优先级先推）
    const sorted = keywords.sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0))

    // 推送到 Airtable Keywords 表
    const KEYWORDS_TABLE = 'Keywords'
    const airtableRecords = await createRecords(
      client.airtable_base_id,
      KEYWORDS_TABLE,
      sorted.map(KEYWORD_TO_AIRTABLE)
    )

    // 回填 airtable_record_id
    await Promise.all(
      airtableRecords.map((ar, idx) =>
        supabase
          .from('keywords')
          .update({ airtable_record_id: ar.id })
          .eq('id', sorted[idx].id)
      )
    )

    return NextResponse.json({
      success: true,
      synced: airtableRecords.length,
    })

  } catch (err: any) {
    console.error('[airtable/sync-keywords]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

新建文件 `src/app/api/airtable/sync-content/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRecords } from '@/lib/airtable/client'
import { POST_TO_AIRTABLE } from '@/lib/airtable/field-maps'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { client_id } = await req.json()

    const { data: client } = await supabase
      .from('clients')
      .select('airtable_base_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json({ success: false, error: 'No Airtable base for client' }, { status: 400 })
    }

    // 找未同步的 draft content posts
    const { data: posts } = await supabase
      .from('content_posts')
      .select('*')
      .eq('client_id', client_id)
      .eq('status', 'draft')
      .is('airtable_record_id', null)
      .limit(20)

    if (!posts?.length) {
      return NextResponse.json({ success: true, synced: 0, message: 'No new posts to sync' })
    }

    const CONTENT_TABLE = 'Content Calendar'
    const airtableRecords = await createRecords(
      client.airtable_base_id,
      CONTENT_TABLE,
      posts.map(POST_TO_AIRTABLE)
    )

    // 回填 airtable_record_id
    await Promise.all(
      airtableRecords.map((ar, idx) =>
        supabase
          .from('content_posts')
          .update({ airtable_record_id: ar.id })
          .eq('id', posts[idx].id)
      )
    )

    return NextResponse.json({ success: true, synced: airtableRecords.length })

  } catch (err: any) {
    console.error('[airtable/sync-content]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

## Step 4：Airtable → Supabase Webhook（最关键）

这个端点由 Zapier 调用：当 Airtable 里 Status 改为 Approved / Rejected 时触发。

新建文件 `src/app/api/webhooks/airtable-approved/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Zapier 发来的 payload 格式（在 Zapier 里配置）：
// {
//   "table": "keywords" | "content",
//   "supabase_id": "uuid",
//   "new_status": "approved" | "rejected",
//   "revision_notes": "可选的修改备注",
//   "zapier_secret": "防止未授权调用"
// }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { table, supabase_id, new_status, revision_notes, zapier_secret } = body

    // 鉴权
    if (zapier_secret !== process.env.ZAPIER_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!supabase_id || !new_status) {
      return NextResponse.json({ error: 'supabase_id and new_status required' }, { status: 400 })
    }

    const validStatuses = ['approved', 'rejected', 'reviewed']
    if (!validStatuses.includes(new_status)) {
      return NextResponse.json({ error: `Invalid status: ${new_status}` }, { status: 400 })
    }

    // ── Keywords 表 ──────────────────────────
    if (table === 'keywords') {
      await supabase
        .from('keywords')
        .update({
          status: new_status,
          status_updated_at: new Date().toISOString(),
          status_updated_by: 'airtable',
        })
        .eq('id', supabase_id)

      return NextResponse.json({ success: true, table: 'keywords', status: new_status })
    }

    // ── Content Posts 表 ─────────────────────
    if (table === 'content') {
      const updateData: any = {
        status: new_status,
        status_updated_at: new Date().toISOString(),
      }
      if (revision_notes) {
        updateData.revision_notes = revision_notes
      }

      await supabase
        .from('content_posts')
        .update(updateData)
        .eq('id', supabase_id)

      // ── approved → 自动触发后续流程 ──────────
      if (new_status === 'approved') {
        // 后台触发，不等待完成（避免 Zapier webhook 超时）
        triggerApprovedWorkflow(supabase_id).catch(err =>
          console.error('[webhook] Approved workflow error:', err)
        )
      }

      return NextResponse.json({ success: true, table: 'content', status: new_status })
    }

    return NextResponse.json({ error: 'Unknown table' }, { status: 400 })

  } catch (err: any) {
    console.error('[webhook/airtable-approved]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// approved 后的自动化流程
async function triggerApprovedWorkflow(postId: string) {
  const { data: post } = await supabase
    .from('content_posts')
    .select('*, clients(airtable_base_id)')
    .eq('id', postId)
    .single()

  if (!post) return

  // 1. 检查是否已有视觉素材
  const { data: existingAssets } = await supabase
    .from('visual_assets')
    .select('id, generation_status')
    .eq('post_id', postId)

  const hasReadyAsset = existingAssets?.some(a => a.generation_status === 'ready')

  // 2. 如果没有素材，自动触发图片生成
  if (!hasReadyAsset && post.visual_brief) {
    console.log(`[workflow] Auto-generating image for post ${postId}`)

    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/visual/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId,
        client_id: post.client_id,
        variant: 1,
      }),
    })
  }

  // 3. 推送到 Publer（如果已有素材直接推，否则等图片生成后再推）
  if (hasReadyAsset) {
    await pushToPubler(post, existingAssets!.find(a => a.generation_status === 'ready')!)
  }
  // 没有素材的情况：Cron 任务（poll-visual-jobs）完成图片生成后会再次检查
}

async function pushToPubler(post: any, asset: any) {
  // 获取 storage_url
  const { data: fullAsset } = await supabase
    .from('visual_assets')
    .select('storage_url')
    .eq('id', asset.id)
    .single()

  if (!fullAsset?.storage_url) return

  // 调用 Publer API
  await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/publer/create-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_id: post.id,
      client_id: post.client_id,
    }),
  })
}
```

---

## Step 5：Publer 发布 Client + API

新建文件 `src/lib/publer/client.ts`：

```typescript
// Publer API Client
// 文档：https://publer.com/api/docs

const PUBLER_BASE = 'https://api.publer.com/v1'
const API_KEY = process.env.PUBLER_API_KEY!

export interface PublerPostResult {
  post_id: string
  status: string
  scheduled_at?: string
  platforms: string[]
}

export async function createPublerPost(params: {
  caption: string
  media_urls: string[]       // 图片或视频 URL（公开可访问）
  platforms: string[]        // ['facebook', 'tiktok', 'instagram']
  schedule_at?: string       // ISO 8601，不传则立即发布
  hashtags?: string[]
}): Promise<PublerPostResult> {
  const { caption, media_urls, platforms, schedule_at, hashtags } = params

  const fullCaption = hashtags?.length
    ? `${caption}\n\n${hashtags.join(' ')}`
    : caption

  const res = await fetch(`${PUBLER_BASE}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: fullCaption,
      media: media_urls.map(url => ({ url })),
      platforms,
      scheduled_at: schedule_at,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Publer create error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return {
    post_id: data.id || data.post_id,
    status: data.status,
    scheduled_at: data.scheduled_at,
    platforms: data.platforms || platforms,
  }
}
```

新建文件 `src/app/api/publer/create-post/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createPublerPost } from '@/lib/publer/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, schedule_at } = await req.json()

    // 获取 content post
    const { data: post } = await supabase
      .from('content_posts')
      .select('*')
      .eq('id', post_id)
      .single()

    if (!post) return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    if (post.status !== 'approved') return NextResponse.json({ success: false, error: 'Post not approved' }, { status: 400 })

    // 获取已选定的视觉素材（is_selected = true 优先，否则取最新的 ready）
    const { data: assets } = await supabase
      .from('visual_assets')
      .select('storage_url, asset_type')
      .eq('post_id', post_id)
      .eq('generation_status', 'ready')
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)

    const mediaUrl = assets?.[0]?.storage_url

    // 推送到 Publer
    const result = await createPublerPost({
      caption: post.caption || post.script || '',
      media_urls: mediaUrl ? [mediaUrl] : [],
      platforms: post.platforms || ['facebook'],
      schedule_at,
      hashtags: post.hashtags,
    })

    // 更新 Supabase 状态
    await supabase
      .from('content_posts')
      .update({
        status: 'scheduled',
        publer_post_id: result.post_id,
        scheduled_at: schedule_at || new Date().toISOString(),
      })
      .eq('id', post_id)

    return NextResponse.json({ success: true, publer_post: result })

  } catch (err: any) {
    console.error('[publer/create-post]', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
```

---

## Step 6：Publer 发布完成 Webhook（回写 published 状态）

新建文件 `src/app/api/webhooks/publer-published/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateRecord } from '@/lib/airtable/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Publer 发布成功后调用此 webhook
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { publer_post_id, published_at, post_url } = body

    // 找对应的 content_post
    const { data: post } = await supabase
      .from('content_posts')
      .select('*, clients(airtable_base_id)')
      .eq('publer_post_id', publer_post_id)
      .single()

    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // 更新 Supabase 状态
    await supabase
      .from('content_posts')
      .update({
        status: 'published',
        published_at: published_at || new Date().toISOString(),
      })
      .eq('id', post.id)

    // 同步回 Airtable
    if (post.airtable_record_id && post.clients?.airtable_base_id) {
      await updateRecord(
        post.clients.airtable_base_id,
        'Content Calendar',
        post.airtable_record_id,
        {
          'Status': 'Published',
          'Published At': published_at?.split('T')[0] || new Date().toISOString().split('T')[0],
          'Published URL': post_url || '',
        }
      )
    }

    return NextResponse.json({ success: true })

  } catch (err: any) {
    console.error('[webhook/publer-published]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
```

---

## Step 7：定时同步 Cron

在 `src/app/api/cron/` 新增 `sync-airtable/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 每小时自动把新数据推到各客户的 Airtable
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  // 找所有有 Airtable 配置的客户
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .not('airtable_base_id', 'is', null)

  const results = []

  for (const client of clients || []) {
    try {
      const [kwRes, postRes] = await Promise.all([
        fetch(`${appUrl}/api/airtable/sync-keywords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id }),
        }),
        fetch(`${appUrl}/api/airtable/sync-content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id }),
        }),
      ])

      const [kw, post] = await Promise.all([kwRes.json(), postRes.json()])
      results.push({ client: client.name, keywords_synced: kw.synced, posts_synced: post.synced })
    } catch (err: any) {
      results.push({ client: client.name, error: err.message })
    }
  }

  return NextResponse.json({ success: true, results })
}
```

在 `render.yaml` 追加：

```yaml
- type: cron
  name: sync-airtable
  schedule: "0 * * * *"    # 每小时整点
  startCommand: curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.onrender.com/api/cron/sync-airtable
```

---

## Step 8：Zapier 配置说明（给 Zhong 操作，不是代码）

### Zap 1：Airtable Keywords → Magic Engine（状态回写）

```
Trigger：Airtable — Updated Record
  Base：[客户 Base]
  Table：Keywords
  Condition：Status 字段变化 AND Status ∈ (Approved, Rejected)

Action：Webhooks by Zapier — POST
  URL：https://your-app.onrender.com/api/webhooks/airtable-approved
  Payload：
    {
      "table": "keywords",
      "supabase_id": {{Supabase ID}},     ← Airtable 字段
      "new_status": {{Status}}.toLowerCase(),
      "zapier_secret": "your-secret"
    }
```

### Zap 2：Airtable Content Calendar → Magic Engine

```
Trigger：Airtable — Updated Record
  Table：Content Calendar
  Condition：Status 变为 Approved 或 Rejected

Action：Webhooks by Zapier — POST
  URL：https://your-app.onrender.com/api/webhooks/airtable-approved
  Payload：
    {
      "table": "content",
      "supabase_id": {{Supabase ID}},
      "new_status": {{Status}}.toLowerCase(),
      "revision_notes": {{Revision Notes}},
      "zapier_secret": "your-secret"
    }
```

---

## Step 9：新增环境变量

```env
AIRTABLE_API_KEY=           # Airtable Personal Access Token
ZAPIER_WEBHOOK_SECRET=      # 自己生成的随机字符串，Zapier 和这里保持一致
PUBLER_API_KEY=             # Publer API Key
NEXT_PUBLIC_APP_URL=        # 生产环境 URL（如 https://magic-engine.onrender.com）
```

在 clients 表更新 CTS 的 airtable_base_id：

```sql
UPDATE public.clients
SET airtable_base_id = 'appXXXXXXXXXXXXXX'  -- 你的 Airtable Base ID
WHERE id = 'cts-client-001';
```

---

## Step 10：验证 Phase 4

```bash
# 1. 手动触发 keyword 同步（先确保 Airtable Keywords 表已建好）
curl -X POST http://localhost:3000/api/airtable/sync-keywords \
  -H "Content-Type: application/json" \
  -d '{"client_id": "cts-client-001"}'
# 预期：Airtable Keywords 表出现新记录，Supabase keywords.airtable_record_id 有值

# 2. 手动触发 content 同步
curl -X POST http://localhost:3000/api/airtable/sync-content \
  -H "Content-Type: application/json" \
  -d '{"client_id": "cts-client-001"}'
# 预期：Airtable Content Calendar 表出现 draft 记录

# 3. 模拟 Zapier webhook（Airtable approved）
curl -X POST http://localhost:3000/api/webhooks/airtable-approved \
  -H "Content-Type: application/json" \
  -d '{
    "table": "content",
    "supabase_id": "你的 content_post UUID",
    "new_status": "approved",
    "zapier_secret": "your-secret"
  }'
# 预期：content_posts.status 变为 approved，自动触发图片生成

# 4. 验证自动触发图片生成
# 检查 visual_assets 表是否自动多了一条记录

# 5. 测试 Publer 发布
curl -X POST http://localhost:3000/api/publer/create-post \
  -H "Content-Type: application/json" \
  -d '{"post_id": "你的 UUID", "client_id": "cts-client-001"}'
# 预期：返回 publer_post_id，content_posts.status = scheduled
```

---

## Phase 4 完成标志

- ✅ `/api/airtable/sync-keywords` 推送成功，Airtable 有记录
- ✅ `/api/airtable/sync-content` 推送成功
- ✅ `/api/webhooks/airtable-approved` 接收 Zapier 调用，回写 Supabase
- ✅ approved 自动触发图片生成（无需人工再操作）
- ✅ `/api/publer/create-post` 推送到 Publer，返回 post_id
- ✅ Cron 每小时自动同步所有客户数据

---

## Phase 5 预告（最后一个 Phase）

Phase 5：**管理后台 Dashboard**
- 客户列表 + 数据概览
- 每月 API 用量统计（SEMrush units、视觉生成成本）
- 内容产出报告（发布数、平台分布）
- 一键触发各工具的简单 UI

完成 Phase 5 后，Magic Engine MVP 完整交付 ✅
