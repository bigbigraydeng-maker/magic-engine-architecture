# CrazyContent — 产品说明

## 公司背景

**Magic Lab** 是一家 AI 产品公司，专注于为中小企业提供 AI 驱动的内容营销和业务自动化工具。  
CrazyContent 是 Magic Lab 旗下的首款 AI 产品。

---

## 产品定位

**CrazyContent** 是一个多客户 AI 内容运营平台，帮助数字营销团队：

- 自动生成社交媒体图文内容（Facebook、小红书等）
- 批量管理多个客户的内容日历
- 对接 Airtable 进行内容审批和发布协作
- AI 图片生成（Flux-dev via Atlas Cloud）
- AI 视频生成（Seedance 2.0 via Atlas Cloud）

目标用户：需要高频产出内容的社媒代运营公司或品牌内部营销团队。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 (App Router) + Tailwind CSS |
| 后端 | Next.js API Routes (Node.js) |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 内容 | OpenAI GPT-4o-mini |
| AI 图片 | Atlas Cloud — Flux-dev (WaveSpeed) |
| AI 视频 | Atlas Cloud — Seedance 2.0 |
| 协作 | Airtable (Content Calendar 同步) |
| 部署 | Render (Web Service) |

---

## 部署信息

- **生产地址：** https://crazycontent-27u3.onrender.com
- **Git 仓库：** github.com/bigbigraydeng-maker/magiclab（`master` 分支）
- **构建根目录：** `crazycontent/`
- **Supabase 项目：** 独立项目（非 hibiz）

> ⚠️ Render 服务监听 `master` 分支，所有生产部署必须推送到 `master`。

---

## 项目结构

```
crazycontent/
├── src/
│   ├── app/
│   │   ├── dashboard/          # 管理后台 UI
│   │   │   ├── overview/       # 总览
│   │   │   ├── clients/        # 客户管理
│   │   │   ├── content/        # 内容管理
│   │   │   ├── keywords/       # 关键词管理
│   │   │   └── visuals/        # 图片 / 视频生成
│   │   └── api/                # REST API
│   └── lib/
│       ├── visual/             # 图片 / 视频生成逻辑
│       ├── airtable/           # Airtable 同步
│       └── supabase.ts         # 数据库客户端
├── CLAUDE.md                   # 开发规范
└── PRODUCT_OVERVIEW.md         # 本文件
```

---

## 本地开发

```bash
# 进入目录
cd "magic lab/crazycontent"

# 安装依赖
npm install

# 启动开发服务器（端口 3001）
npm run dev

# 构建
npm run build
```

### 必要环境变量

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
ATLAS_API_KEY=
AIRTABLE_API_KEY=
```

---

## Magic Lab 产品矩阵（规划中）

| 产品 | 定位 | 状态 |
|------|------|------|
| **CrazyContent** | AI 内容运营平台 | ✅ 上线 |
| HiBiz | 商业信息采集工具 | 开发中 |
| 其他 | TBD | 规划中 |

---

*Magic Lab — Building AI tools for real business.*
