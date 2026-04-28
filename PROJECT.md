# Magic Engine — 项目说明

---

## 是什么

**Magic Engine** 是 Magic Lab 的 AI 内容运营平台，面向社媒代运营团队和品牌营销部门。

核心能力：
- 多客户内容日历管理（对接 Airtable）
- AI 生成社媒图片和短视频（WaveSpeed + Seedance）
- 一键调度发布到 Instagram / Facebook / TikTok 等（通过 Publer）
- 关键词和 SEO 策略管理（SEMrush 集成）

---

## 目标用户

| 角色 | 使用方式 |
|------|---------|
| 内容策划 | 在 Airtable 填写内容日历，状态改为 Ready |
| 运营执行 | 在 Magic Engine Workbench 审核、生成图片/视频、发布 |
| 客户 | 未来：独立 Portal 查看自己的内容状态（规划中） |

---

## 数据架构

```
Airtable（策划输入）
├── 社媒内容日历    ──Sync→  content_posts（Supabase）
├── 关键词库        ──Sync→  keywords（Supabase）
└── SEO 策略        ──Sync→  seo_strategy（规划中）

Supabase（执行数据库）                   ← 单一数据源
├── clients                              客户配置
├── content_posts                        帖子（含生成状态）
├── visual_assets                        生成的图片/视频
└── keywords                             关键词库

Supabase → Airtable（写回）
├── Image_URL                            生成完成后写回
└── Publer_Post_ID                       发布后写回

Publer（发布层）
└── 接收 visual_assets 中 ready 的图片/视频，按时间发布
```

---

## 技术栈

| 层级 | 技术 | 备注 |
|------|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS | |
| 后端 | Next.js API Routes（Node.js） | |
| 数据库 | Supabase（PostgreSQL + Storage） | 独立项目 `glbdnayojixmexgofbsd` |
| AI 图片 | Atlas Cloud — WaveSpeed Flux-dev | `submitImageGeneration()` |
| AI 视频 | Atlas Cloud — Seedance 2.0 | `submitVideoGeneration()` |
| 内容生成 | OpenAI GPT-4o-mini | Route A/B/C |
| 关键词 | SEMrush API | |
| 协作 | Airtable REST API | per-client base + table ID |
| 发布 | Publer API v1 | Bearer-API auth |
| 部署 | Render（Web Service）| 监听 master 分支 |

---

## 部署信息

```
生产地址：  https://crazycontent-27u3.onrender.com
Git 仓库：  github.com/bigbigraydeng-maker/magiclab
分支：      master
构建目录：  crazycontent/
构建命令：  npm run build
启动命令：  npm start
```

推送到 master → Render 自动部署（约 3-5 分钟）。

---

## 本地开发

```bash
cd "magic lab/crazycontent"
cp .env.example .env.local    # 填写必要环境变量
npm install
npm run dev                   # http://localhost:3001
```

必要环境变量：
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ATLAS_API_KEY=
OPENAI_API_KEY=
AIRTABLE_API_KEY=
SEMRUSH_API_KEY=
PUBLER_API_KEY=
PUBLER_WORKSPACE_ID=
```

---

## 相关文件

| 文件 | 内容 |
|------|------|
| `CLAUDE.md` | Agent 工作指南（架构、文件地图、约定） |
| `ROADMAP.md` | 已完成功能 + 未来规划 |
| `PROJECT.md` | 本文件（项目说明） |
