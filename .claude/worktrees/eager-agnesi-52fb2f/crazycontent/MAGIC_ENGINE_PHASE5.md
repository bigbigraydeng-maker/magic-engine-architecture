# Magic Engine Phase 5 — Admin Dashboard

## 背景

Phase 1-4 已完成 Magic Engine 的核心引擎：SEMrush 关键词抓取、Route A/B/C 内容生成、图片/视频生成、Airtable 双向同步、Publer 自动发布。

Phase 5 目标：为以上所有能力构建一个**内部操作后台**，让运营人员无需命令行即可完成全部操作。

**访问路径：** `/dashboard`（内部使用，暂不做登录验证，后续 Phase 可加）

**技术要求：**
- Next.js 14 App Router，与现有 codebase 同路径
- UI 使用 Tailwind CSS，风格简洁专业（深色侧边栏 + 白色主内容区）
- 数据全部从现有 Supabase 表读取，调用现有 API 路由
- 不新建 Supabase 表，复用 Phase 1-4 的所有表结构

---

## 路由结构

```
src/app/dashboard/
├── page.tsx                          # 首页：概览卡片
├── layout.tsx                        # 侧边栏导航
├── clients/
│   ├── page.tsx                      # 客户列表
│   └── [id]/page.tsx                 # 客户详情 + Master Brief 编辑
├── content/
│   ├── page.tsx                      # 内容看板
│   └── generate/page.tsx             # 内容生成操作台
├── keywords/
│   └── page.tsx                      # 关键词库 + SEO 操作台
└── visuals/
    └── page.tsx                      # 视觉生成操作台
```

---

## Step 1 — Dashboard Layout（侧边栏 + 导航）

**文件：** `src/app/dashboard/layout.tsx`

侧边栏导航项：
- 🏠 Overview（首页概览）
- 👥 Clients（客户管理）
- 📝 Content（内容看板）
- 🔑 Keywords（关键词库）
- 🎨 Visuals（视觉生成）

顶部 Header 显示：当前页面标题 + "Magic Engine" logo

```typescript
// layout.tsx 结构
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Header />
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
```

---

## Step 2 — Overview 首页

**文件：** `src/app/dashboard/page.tsx`

展示 4 个统计卡片（从 Supabase 实时读取）：

| 卡片 | 数据来源 | 查询 |
|---|---|---|
| 客户总数 | `clients` 表 | `count(*)` |
| 本月内容生成 | `content_posts` | `created_at >= 本月1日` |
| 待审核内容 | `content_posts` | `status = 'draft'` |
| 关键词库总量 | `keywords` | `count(*)` |

下方：最近 5 条 `content_posts` 列表（title、client、status、created_at）

```typescript
// 数据获取
const [clients, content, pending, keywords] = await Promise.all([
  supabaseAdmin.from('clients').select('count'),
  supabaseAdmin.from('content_posts').select('count').gte('created_at', startOfMonth),
  supabaseAdmin.from('content_posts').select('count').eq('status', 'draft'),
  supabaseAdmin.from('keywords').select('count'),
])
```

---

## Step 3 — 客户管理

**文件：** `src/app/dashboard/clients/page.tsx`

**列表页：**
- 展示所有客户：name、industry、airtable_base_id、created_at
- 每行有「查看」按钮 → 跳到详情页
- 右上角「+ 新增客户」按钮 → 内联表单（不跳页）

**新增客户表单字段：**
```typescript
{
  name: string           // 客户名称
  industry: string       // 行业
  website_url: string    // 官网
  airtable_base_id: string  // Airtable Base ID（appXXXXXXXXXXXXXX）
}
```

调用：`POST /api/clients`（新建，如不存在则创建此路由）

---

**文件：** `src/app/dashboard/clients/[id]/page.tsx`

**详情页内容：**

1. 客户基本信息（可编辑）
2. **Master Brief 编辑器** — 从 `master_briefs` 表读取，展示以下字段（textarea 可编辑）：
   - `brand_name`
   - `products`（JSON array → 逐行展示）
   - `tone_of_voice`
   - `target_audience`
   - `visual_style`
   - `key_messages`
   保存调用：`PUT /api/clients/[id]/brief`

3. 该客户最近 10 条内容（status badge）

---

## Step 4 — 内容看板

**文件：** `src/app/dashboard/content/page.tsx`

**功能：**

顶部筛选：客户下拉选择 + Status 筛选（All / Draft / Approved / Published）

内容卡片列表，每张卡片展示：
- Title
- Route 标签（Route A / B / C）
- Platform 标签（Facebook / TikTok）
- Status badge（颜色区分）
- Created At
- Caption 前 100 字预览
- 操作按钮：「查看详情」「手动推送 Airtable」

**手动推送 Airtable：**
```typescript
// 点击「推送 Airtable」→ 调用
POST /api/airtable/sync-content
body: { client_id, post_ids: [post.id] }
```

**查看详情** → 展开 Modal 显示完整 Script、Caption、Hashtags、Visual Brief

---

## Step 5 — 内容生成操作台

**文件：** `src/app/dashboard/content/generate/page.tsx`

### 5A — 路线选择

顶部 3 个 Tab：
- **Route A** — SEO 关键词 → 社媒内容
- **Route B** — 爆款视频改写
- **Route C** — Master Brief 驱动

### 5B — Route A 表单

```typescript
{
  client_id: string      // 客户下拉
  keyword: string        // 输入关键词（从 keywords 表选择或手动输入）
  platform: string[]     // checkbox: Facebook / TikTok / Instagram
}
```

提交 → `POST /api/content/route-a` → 显示生成中 spinner → 完成后展示 2 个版本结果

### 5C — Route B 表单

```typescript
{
  client_id: string      // 客户下拉
  video_url: string      // 视频 URL（YouTube / TikTok / Facebook）
  platform: string[]     // 发布平台
}
```

提交 → `POST /api/content/route-b` → spinner → 展示结果

### 5D — Route C 表单

```typescript
{
  client_id: string      // 客户下拉
  topic: string          // 内容主题
  platform: string[]     // 发布平台
}
```

提交 → `POST /api/content/route-c`（若不存在则创建：直接用 Master Brief + topic 生成）

### 5E — 生成结果展示

两个版本并排显示（V1 / V2），每个版本包含：
- Script 全文
- Caption
- Hashtags
- Visual Brief

操作按钮：「保存到内容库」「重新生成」「推送 Airtable」

---

## Step 6 — SEO 关键词操作台

**文件：** `src/app/dashboard/keywords/page.tsx`

### 6A — 关键词抓取面板（顶部）

```typescript
// 表单
{
  client_id: string     // 客户下拉
  domain: string        // 客户域名（自动从 clients.website_url 填入）
  seed_keywords: string // 种子关键词，换行分隔
  mode: 'related' | 'gap' | 'domain'  // radio 选择
}
```

提交 → `POST /api/semrush/analyze`（Phase 1 已有）→ loading → 完成后刷新下方列表

### 6B — 关键词库列表

表格列：Keyword | Volume | KD | CPC | Intent | Opportunity Score | Status | 操作

- 按 Opportunity Score 降序排列
- Status badge：new（蓝）/ approved（绿）/ rejected（红）/ published（灰）
- 操作列：「✅ Approve」「❌ Reject」按钮
  - 点击 → `PATCH /api/keywords/[id]/status`（若不存在则创建）
  - 乐观更新 UI（不等服务器响应）

- 顶部筛选：客户 + Status + Intent

---

## Step 7 — 视觉生成操作台

**文件：** `src/app/dashboard/visuals/page.tsx`

### 7A — 图片生成（Atlas Cloud Flux-dev）✅ 可用

**默认模式（方案 A）：**

```typescript
{
  client_id: string       // 客户下拉
  post_id: string         // 关联内容（从 content_posts 选择，自动带入 Visual Brief）
  aspect_ratio: string    // 下拉：'1:1' / '4:5' / '16:9'
  style: string           // 下拉：'photorealistic' / 'illustration' / 'minimal'
}
```

**展开编辑（方案 B 局部）：**
「✏️ 编辑提示词」按钮 → 展开 textarea，预填自动生成的 prompt，可自由修改

提交 → `POST /api/visual/image` → 返回 asset_id → 轮询 `/api/visual/status/:assetId`

**状态显示：**
```
[ generating... ████░░░░ ] → [ ✅ 图片已生成 ] + 预览缩略图
```

---

### 7B — 视频生成（Seedance 2.0）⏳ 待 API Key

UI 同图片，额外参数：

```typescript
{
  duration: number        // 下拉：5 / 10 / 15（秒）
  aspect_ratio: string    // '9:16'（竖屏）/ '16:9'（横屏）
}
```

**Key 未配置时显示：**
```
⚠️ Seedance API Key 未配置
请在 .env 中设置 ATLAS_CLOUD_API_KEY 并重启服务
```

（注：ATLAS_CLOUD_API_KEY 已填，检查 Seedance 端点是否可用）

---

### 7C — 数字人视频（HeyGen）⏳ 待 API Key

```typescript
{
  client_id: string
  post_id: string         // 自动带入 Script
  avatar_id: string       // 待配置后填入
  voice_id: string        // 待配置后填入
}
```

**Key 未配置时显示：**
```
⚠️ HeyGen API Key 未配置
请在 .env 中设置 HEYGEN_API_KEY
```

---

### 7D — 生成历史

页面下方：最近 20 条 `visual_assets` 记录

| 字段 | 显示 |
|---|---|
| type | 图片 / 视频 / 数字人 |
| generation_status | generating / ready / failed（badge 颜色） |
| 预览 | ready 时显示缩略图（storage_url）|
| cost_usd | 生成成本 |
| created_at | 时间 |

---

## Step 8 — 新增/补充 API 路由

以下 API 路由如不存在，需新建：

### `POST /api/clients`
创建新客户
```typescript
body: { name, industry, website_url, airtable_base_id }
→ supabaseAdmin.from('clients').insert(...)
→ return { id, name }
```

### `PUT /api/clients/[id]/brief`
更新 Master Brief
```typescript
body: { brand_name, products, tone_of_voice, target_audience, visual_style, key_messages }
→ supabase.from('master_briefs').upsert({ client_id: id, ...body })
```

### `PATCH /api/keywords/[id]/status`
更新关键词状态
```typescript
body: { status: 'approved' | 'rejected' }
→ supabase.from('keywords').update({ status }).eq('id', id)
```

### `POST /api/content/route-c`（若不存在）
Master Brief 驱动生成
```typescript
body: { client_id, topic, platforms }
1. getActiveBrief(client_id)
2. OpenAI: 基于 brief + topic 生成 V1, V2
3. supabase.from('content_posts').insert([v1, v2])
→ return { posts: [v1, v2] }
```

---

## Step 9 — 验证步骤

完成后逐项验证：

```
✅ /dashboard 可访问，侧边栏导航正常
✅ Overview 页：4 个统计卡片有数据
✅ Clients 页：能看到 CTS 客户，点进详情能看到 Master Brief
✅ 新增客户：填表单，保存成功
✅ Content 看板：能看到 2 条现有内容，status 正确
✅ Route B 生成：输入 YouTube URL，生成 2 个版本
✅ Keywords 页：能看到现有关键词，Approve 按钮有效
✅ SEMrush 抓取：输入 ctstours.co.nz，能拿到关键词列表
✅ 图片生成：选 CTS 客户，提交，状态轮询到 ready，显示缩略图
✅ Seedance / HeyGen：显示"待配置"提示，不报错
```

---

## 环境变量（无新增，复用现有）

```env
NEXT_PUBLIC_SUPABASE_URL=          # 已有
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # 已有
SUPABASE_SERVICE_ROLE_KEY=         # 已有
OPENAI_API_KEY=                    # 已有
SEMRUSH_API_KEY=                   # 已有
ATLAS_CLOUD_API_KEY=               # 已有
AIRTABLE_API_KEY=                  # Phase 4 新增
HEYGEN_API_KEY=                    # 待填（界面会显示未配置提示）
```

---

## 交付物

完成后告诉我：
1. `/dashboard` 的访问 URL（本地 + 生产）
2. 每个 Step 的 ✅ / ❌ 状态
3. 截图：Overview 页、Content 看板、视觉生成操作台
