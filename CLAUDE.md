# Magic Engine — Agent 工作指南

> 每次开始工作前先读这个文件。

## 输出语言

**所有对话和说明必须用中文输出。代码文件内容保持英文。**

---

## 项目身份

**Magic Engine**（代码库名 `crazycontent`）是 Magic Lab 的 AI 内容运营平台。  
帮助社媒代运营团队：批量管理多客户内容日历、AI 生成图片/视频、自动发布到 Publer。

- **生产地址：** https://crazycontent-27u3.onrender.com
- **Git 仓库：** github.com/bigbigraydeng-maker/magiclab（`master` 分支，根目录 `crazycontent/`）
- **本地开发：** `npm run dev`（端口 3001）

---

## 架构原则（必须理解）

```
Airtable（策划层）          Supabase（执行层）
  内容日历                 ──Sync→  content_posts
  关键词库                 ──Sync→  keywords
  SEO 策略                ──Sync→  seo_strategy（规划中）
                          ←写回──  Image_URL / Publer_Post_ID

Supabase = 单一数据源（System of Record）
Airtable = 可选输入源 + 结果展示（非必须依赖）
Magic Engine UI = 主要操作界面（可完全绕过 Airtable 独立运行）
```

**同步方向原则：**
- Airtable → Supabase：按需（手动 Sync 按钮）+ 未来每日 Cron
- Supabase → Airtable：操作完立即写回（Image_URL、Publer_Post_ID）
- **禁止双向实时同步**（会产生冲突）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL) |
| AI 图片 | Atlas Cloud — WaveSpeed Flux-dev |
| AI 视频 | Atlas Cloud — Seedance 2.0 |
| 内容生成 | OpenAI GPT-4o-mini |
| 关键词 | SEMrush API |
| 协作导入 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| 部署 | Render |

---

## 关键文件地图

```
src/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx              # 侧边栏导航
│   │   ├── page.tsx                # 概览卡片
│   │   ├── clients/[id]/page.tsx   # 客户详情（含 Airtable 配置）
│   │   ├── visuals/page.tsx        # Content Workbench（主操作台）★
│   │   ├── keywords/page.tsx       # 关键词库
│   │   └── content/page.tsx        # 内容看板
│   └── api/
│       ├── clients/[id]/posts/route.ts   # GET 客户帖子列表
│       ├── posts/[id]/route.ts           # PATCH 更新帖子（含 Airtable 写回）★
│       ├── airtable/pull-content/route.ts # Sync 入口★
│       ├── visual/image/route.ts          # 触发图片生成
│       ├── visual/video/route.ts          # 触发视频生成
│       ├── visual/status/[assetId]/route.ts # 轮询生成状态
│       ├── visual/assets/route.ts          # 获取资产列表
│       ├── publer/schedule/route.ts        # 发布到 Publer
│       └── publer/draft/[assetId]/route.ts # 获取发布预填数据
└── lib/
    ├── supabase.ts           # Supabase 客户端（用 supabaseAdmin）
    ├── airtable/client.ts    # listRecords / updateRecord
    ├── visual/wavespeed.ts   # submitImageGeneration
    ├── publer/client.ts      # getAccounts / schedulePost
    └── semrush/client.ts     # SEMrush API
```

---

## Supabase 主要表结构

| 表 | 说明 |
|----|------|
| `clients` | 客户列表，含 `airtable_base_id`、`airtable_content_table_id` |
| `content_posts` | 帖子（从 Airtable sync 进来或直接创建） |
| `visual_assets` | 生成的图片/视频资产，含 `storage_url`、`generation_status` |
| `keywords` | 关键词库 |

`content_posts` 关键字段：
```
id, client_id, title, status, platforms, caption, hashtags,
visual_brief, scheduled_at, format, ratio,
airtable_record_id,   ← nullable，有则写回 Airtable
created_at
```

---

## Airtable 字段映射（新表 social calendar）

| Supabase 字段 | Airtable 字段 |
|---------------|---------------|
| title | Headline_EN |
| caption | Caption_EN |
| visual_brief | LoveArt_Prompt_EN |
| hashtags | Hashtags_IG |
| scheduled_at | Date + Time_NZST |
| format | Format |
| ratio | Ratio |
| platforms | Platform |
| — | Image_URL（生成后写回） |
| — | Publer_Post_ID（发布后写回） |

---

## 开发约定

- **所有输出用中文**，代码文件内容保持英文
- TypeScript strict mode，无 `any`
- 函数 < 50 行，文件 < 800 行
- 不在模块顶层初始化 SDK 客户端（如 Resend、OpenAI）——必须放在 handler 内部
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新（optimistic update）先更新 UI，再调 API
- 只在 `src/lib` 中放可复用逻辑，`src/app/api` 只放路由层

---

## 环境变量

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI 生成
ATLAS_API_KEY=          # WaveSpeed 图片 + Seedance 视频
OPENAI_API_KEY=

# 集成
AIRTABLE_API_KEY=
SEMRUSH_API_KEY=
PUBLER_API_KEY=
PUBLER_WORKSPACE_ID=
```

---

## 常用命令

```bash
cd "magic lab/crazycontent"

npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（必须通过才能推送）
npm test           # 测试套件

git add <files>
git commit -m "feat: ..."
git push origin master   # 自动触发 Render 部署
```

---

## 当前状态（2026-04-28）

✅ 已完成：多客户管理、Airtable sync、Content Workbench（表格编辑+写回）、AI 图片/视频生成、Publer 发布  
🔄 进行中：Airtable embed 页面、Keywords 同步、Gallery 视图  
📋 参见 `ROADMAP.md`
