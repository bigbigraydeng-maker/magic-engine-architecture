# 平台感知内容生成功能设计

> **文档用途：** 评估 Facebook/TikTok 区分的内容生成功能，检查与现有系统的冲突  
> **创建日期：** 2026-04-29  
> **功能状态：** 设计中，未实现

---

## 1. 功能概述

### 目标

当前 Magic Engine 生成的内容是**通用的**（一份文案用于所有平台）。本功能将实现**平台感知的内容生成**：

- 同一个 Master Brief（客户核心消息）
- 为 Facebook 和 TikTok 分别生成优化的版本
- 版本间有明显的风格差异（文案长度、语气、CTA）

### 适用场景

```
客户：电商品牌
Master Brief：「新产品上市，主打环保材料」

生成结果：
├─ Facebook 版本：
│   └─ 文案 300-400 字，生活化语气，鼓励评论分享
│      "我们骄傲地推出..."，3 个 emoji，CTA: "在评论中告诉我"
│
└─ TikTok 版本：
    └─ 文案 80-120 字，快节奏，视频脚本
       建议配合音乐 Keyword，15-30 秒脚本，CTA: "关注看更多"
```

---

## 2. 技术实现

### 2.1 新增文件

#### `src/lib/content/platform-prompts.ts`

```typescript
export const PLATFORM_PROMPTS = {
  facebook: {
    style: `You are a Facebook content expert. Create engaging social media content.
Requirements:
- Length: 150-400 words
- Use 2-3 relevant emojis
- Friendly, conversational tone
- Include call-to-action (like, share, comment)
- Start with a hook to stop scrolling
- End with a question to encourage comments`,
  },
  tiktok: {
    style: `You are a TikTok content expert. Create short, punchy video script content.
Requirements:
- Length: 50-150 words (script for 15-30 second video)
- Fast-paced, trendy tone
- Use hooks in first 3 seconds
- Suggest trending sounds/music keywords
- Include call-to-action (follow, like, share, comment)
- Format: Start with attention-grabber, quick value delivery, CTA`,
  },
}
```

#### `src/app/api/posts/[id]/generate-caption/route.ts` (新建)

```typescript
POST /api/posts/[id]/generate-caption

Request Body:
{
  platform: 'facebook' | 'tiktok'
}

Response:
{
  success: true,
  platform: 'facebook',
  caption: '...',
  generated_at: '2026-04-29T10:00:00Z'
}

Logic:
1. 获取 post 数据（title, visual_brief, platforms）
2. 根据 platform 选择对应的 system prompt
3. 调用 OpenAI GPT-4o-mini
4. 保存到 Supabase (content_posts.caption，或新字段 platform_versions)
5. 返回生成的文案
```

### 2.2 数据库变更

**选项 A：新增字段（推荐）**

```sql
ALTER TABLE content_posts 
ADD COLUMN platform_versions JSONB DEFAULT '{}'
  COMMENT '按平台存储优化版本: { "facebook": "...", "tiktok": "..." }';

-- 样例数据：
{
  "facebook": "我们骄傲地推出...",
  "tiktok": "新产品上市！环保材料..."
}
```

**选项 B：保持现状（简化）**

不改表，暂时只在 `caption` 字段中存储当前平台的版本。  
前端 UI 记录用户选择的平台，调用时携带。

### 2.3 前端改造

修改 `src/app/dashboard/visuals/page.tsx`：

**新增平台选择标签页：**

```tsx
const [selectedPlatform, setSelectedPlatform] = useState<'facebook' | 'tiktok'>('facebook')

// 在表格工具栏添加
<div className="flex gap-2 mb-4">
  <button
    onClick={() => setSelectedPlatform('facebook')}
    className={`px-4 py-2 rounded ${selectedPlatform === 'facebook' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
  >
    📘 Facebook
  </button>
  <button
    onClick={() => setSelectedPlatform('tiktok')}
    className={`px-4 py-2 rounded ${selectedPlatform === 'tiktok' ? 'bg-purple-500 text-white' : 'bg-gray-200'}`}
  >
    🎵 TikTok
  </button>
</div>

// 在表格行的"生成"按钮改造
<button
  onClick={() => generateCaption(post.id, selectedPlatform)}
  className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
>
  Generate {selectedPlatform === 'facebook' ? '📘 FB' : '🎵 TikTok'}
</button>
```

**生成函数：**

```tsx
const generateCaption = async (postId: string, platform: 'facebook' | 'tiktok') => {
  setLoading(true)
  try {
    const res = await fetch(`/api/posts/${postId}/generate-caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    })
    const { caption } = await res.json()
    // 更新表格中的 caption 显示
    setPosts(posts.map(p => p.id === postId ? { ...p, caption } : p))
  } finally {
    setLoading(false)
  }
}
```

---

## 3. 数据流

### 流程图

```
用户操作
    ↓
选择平台 (Facebook | TikTok)
    ↓
点击 "Generate Caption" 按钮
    ↓
POST /api/posts/[id]/generate-caption
    ├─ 获取 post.visual_brief
    ├─ 加载 PLATFORM_PROMPTS[platform]
    ├─ 调用 OpenAI
    └─ 保存到 Supabase
    ↓
前端更新 caption 显示
    ↓
用户可编辑/确认
    ↓
点击 "Generate Image/Video" 或 "Publish"
    ├─ 图片生成用 visual_brief
    ├─ 发布到 Publer 用 caption (当前平台版本)
```

### 与现有流程的关系

```
现有流程：
Post Created (title, visual_brief) → Generate Image/Video → Publish to Publer

新增流程：
Post Created (title, visual_brief) 
    ↓
✨ Generate Caption (platform-aware) 新增这一步
    ├─ Facebook Version
    └─ TikTok Version
    ↓
Generate Image/Video (使用现有逻辑，不变)
    ↓
Publish to Publer (发布时选择对应的 caption 版本)
```

---

## 4. 影响范围

### 修改的现有文件

| 文件 | 改动 | 影响程度 |
|------|------|---------|
| `src/app/dashboard/visuals/page.tsx` | 添加平台选择标签页 + 生成函数 | 中等 |
| `src/app/api/posts/[id]/route.ts` | 可能需要调整（如果存储多版本） | 低 |
| Supabase 表结构 | 可选：新增 `platform_versions` 字段 | 低 |

### 新增的文件

| 文件 | 说明 |
|------|------|
| `src/lib/content/platform-prompts.ts` | 平台规则定义 |
| `src/app/api/posts/[id]/generate-caption/route.ts` | 新 API 端点 |

### 不影响的模块

- ✅ 图片生成（`/api/visual/image`）— 逻辑不变
- ✅ 视频生成（`/api/visual/video`）— 逻辑不变
- ✅ Publer 发布（`/api/publer/schedule`）— 只需选择正确的 caption 版本
- ✅ Airtable 同步（`/api/airtable/pull-content`）— 不受影响
- ✅ SEMrush 关键词（`/api/semrush/*`）— 不受影响

---

## 5. 潜在冲突检查清单

### 与 Content Workbench 的冲突

**问题：** 当前表格编辑逻辑中，`caption` 字段是单一值。如果支持多平台版本，怎么存储和编辑？

**方案 A（推荐）：** 使用 `platform_versions` JSONB 字段，前端根据 `selectedPlatform` 显示/编辑对应版本
- ✅ 清晰、可扩展
- ⚠️ 需要改表 + 改 API `/api/posts/[id]`

**方案 B（简化）：** 暂时只用 `caption` 字段，前端切换平台时覆盖（不保留历史）
- ✅ 改动最小
- ❌ 用户在 Facebook 和 TikTok 之间切换会丢失数据

### 与 Airtable 同步的冲突

**问题：** Airtable 中的 `Caption_EN` 字段只有一个，如何回写多平台版本？

**方案：** 暂时只回写 `selectedPlatform` 对应的版本
- Airtable 保持单字段设计
- 完整的多版本数据存在 Supabase 中
- 若未来需要，可在 Airtable 中新增 `Caption_Facebook`、`Caption_TikTok` 字段

### 与 Publer 发布的冲突

**问题：** 发布时，应该用哪个平台版本的 caption？

**方案：** 发布前，用户确认目标平台，自动选择对应的 caption
```tsx
// Publer 发布流程
1. 用户点击 "Publish"
2. 弹窗选择目标平台 (Facebook | TikTok)
3. 根据选择，获取 platform_versions[platform] 的 caption
4. 发送到 Publer
```

### 与生成图片/视频的冲突

**问题：** 图片的尺寸、视频的长度应该按平台优化吗？

**方案：** 暂时不改，保持现状
- 图片生成：用户手动选择 `aspect_ratio`（1:1, 4:5, 16:9）
- 视频生成：用户手动选择 `format`（reel, video）
- 未来可扩展：根据 `selectedPlatform` 推荐最优尺寸

---

## 6. 实现步骤（详细）

### Phase 1：后端 API（2 小时）

- [ ] 创建 `src/lib/content/platform-prompts.ts`
- [ ] 创建 `src/app/api/posts/[id]/generate-caption/route.ts`
- [ ] 测试 API 端点（手动 curl 或 Postman）
- [ ] 验证 OpenAI 调用和响应

### Phase 2：数据库（30 分钟）

选择方案 A 或 B：

**方案 A：** 
- [ ] Supabase 新增 `platform_versions` JSONB 字段
- [ ] 修改 `/api/posts/[id]` 读取/写入逻辑
- [ ] 写 migration 脚本

**方案 B：**
- [ ] 保持现状，不改表

### Phase 3：前端 UI（1.5 小时）

- [ ] 修改 `src/app/dashboard/visuals/page.tsx`
- [ ] 添加平台选择标签页（Facebook | TikTok）
- [ ] 添加 "Generate Caption" 按钮
- [ ] 链接到后端 API
- [ ] 测试 UI 交互

### Phase 4：集成&测试（1.5 小时）

- [ ] 测试完整流程：选平台 → 生成 → 显示 → 编辑 → 保存
- [ ] 测试与 Publer 发布的配合
- [ ] 测试 Airtable 写回
- [ ] 测试图片/视频生成不受影响

---

## 7. 环境依赖

### 无新增依赖

- 已有 `@anthropic-ai/sdk` / `openai` — 用于 GPT 调用
- 已有 `@supabase/supabase-js` — 用于数据读写
- 前端：使用现有的 React + Tailwind

### 环境变量

- `OPENAI_API_KEY` — 已有

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| API 调用成本增加 | 中 | 低 | 使用 GPT-4o-mini（便宜模型） |
| Airtable 兼容性 | 低 | 中 | 暂时只回写当前平台版本 |
| 前端 UI 复杂度 | 低 | 低 | 保持设计简单（标签页切换） |
| 多版本存储混乱 | 中 | 中 | 使用 platform_versions JSONB 结构化存储 |

---

## 9. 后续扩展点

一旦 Facebook/TikTok 功能稳定，可扩展为：

- [ ] LinkedIn（专业文案）
- [ ] Instagram（Feed + Stories）
- [ ] YouTube（长视频描述）
- [ ] 图片尺寸自动适配（按平台）
- [ ] 视频长度自动适配（按平台）
- [ ] 批量多平台生成（一键为所有平台生成）

---

## 10. 检查项（交给其他 Agent）

请审查以下问题：

1. **API 设计**
   - [ ] `/api/posts/[id]/generate-caption` 端点设计是否合理？
   - [ ] 请求/响应格式是否符合现有 API 约定？

2. **数据库**
   - [ ] 方案 A（新增 `platform_versions`）vs 方案 B（保持现状），哪个更合适？
   - [ ] 如果选 A，现有数据如何迁移？

3. **前端**
   - [ ] 平台选择标签页的 UI 放置位置合理吗？
   - [ ] 是否会和现有的表格操作冲突？

4. **集成冲突**
   - [ ] 与 Airtable 写回的冲突？
   - [ ] 与 Publer 发布的冲突？
   - [ ] 与图片/视频生成的冲突？

5. **业务逻辑**
   - [ ] 用户在 Facebook/TikTok 版本间切换时，是否应该保留历史版本？
   - [ ] 发布到 Publer 时，如何确保用户选择正确的平台？

6. **测试覆盖**
   - [ ] 需要哪些单元测试？集成测试？
   - [ ] E2E 场景应该覆盖什么？

---

## 附录：代码示例

### 完整的 API 实现

```typescript
// src/app/api/posts/[id]/generate-caption/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { PLATFORM_PROMPTS } from '@/lib/content/platform-prompts'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { platform = 'facebook' } = await req.json()

    // 验证平台
    if (!['facebook', 'tiktok'].includes(platform)) {
      return NextResponse.json(
        { error: 'Unsupported platform. Supported: facebook, tiktok' },
        { status: 400 }
      )
    }

    // 获取帖子信息
    const { data: post, error: fetchError } = await supabaseAdmin
      .from('content_posts')
      .select('title, visual_brief, caption')
      .eq('id', params.id)
      .single()

    if (fetchError || !post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      )
    }

    // 准备 OpenAI prompt
    const userContent = `
Topic: ${post.title}
Context: ${post.visual_brief || 'Generate engaging content for this topic'}
Current caption: ${post.caption || 'None'}
`

    // 调用 OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: PLATFORM_PROMPTS[platform as 'facebook' | 'tiktok'].style,
          },
          {
            role: 'user',
            content: userContent.trim(),
          },
        ],
        temperature: 0.8,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json(
        { error: `OpenAI API error: ${error}` },
        { status: 500 }
      )
    }

    const data = await response.json()
    const caption = data.choices[0]?.message?.content || ''

    // 保存到 Supabase
    // 选项 A：使用 platform_versions
    // const { error: updateError } = await supabaseAdmin
    //   .from('content_posts')
    //   .update({
    //     platform_versions: {
    //       ...post.platform_versions,
    //       [platform]: caption,
    //     },
    //   })
    //   .eq('id', params.id)

    // 选项 B：简单覆盖
    const { error: updateError } = await supabaseAdmin
      .from('content_posts')
      .update({ caption })
      .eq('id', params.id)

    if (updateError) throw updateError

    return NextResponse.json({
      success: true,
      platform,
      caption,
      generated_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[generate-caption]', err)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
```

---

**文档完成。请安排其他 Agent 审查。**
