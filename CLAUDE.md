# Magic Engine — Agent 工作指南

> 每次打开新会话：先看底部 **§ 当前焦点** → 按需读 [ROADMAP.md](./ROADMAP.md)。

**输出语言**：对话和说明用中文，代码 / 变量 / 注释保持英文。

---

## 项目定位

Magic Engine 是 Magic Lab 2026 旗舰产品，三大核心能力（不偏离）：

- **SEO 内容引擎** — 传统搜索可见度（已成熟）
- **GEO 优化层** — AI 推荐可见度（核心差异化）
- **社媒内容矩阵** — 全平台内容生产（已成熟）

原则：全自动→半自动→手动+UI 辅助；内部工具优先，不做付费墙；客户层不暴露第三方供应商名。

---

## 第三方服务封装名 ⭐

UI / 报告 / 客户交付物中**禁止出现真实供应商名**，只用封装名：

| 真实服务 | 封装名（UI 对外） |
|---------|----------------|
| OpenAI GPT-4o-mini | **Content Engine** |
| Anthropic Claude Sonnet | **Strategy Engine** |
| WaveSpeed / Atlas | **Visual Studio** |
| Seedance / Atlas | **Video Studio** |
| HeyGen | **Avatar Studio** |
| SEMrush | **Keyword Intelligence** |
| Jina.ai Reader | **Site Analyzer** |
| Airtable | **Content Workspace** |
| Publer | **Publishing Hub** |

规则：UI 文案用封装名；API 路由内部可用真实代号；错误日志内部可含真实名；环境变量保留真实命名（如 `ATLAS_API_KEY`）。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini + Anthropic Claude Sonnet |
| AI 图片/视频 | Atlas Cloud (WaveSpeed Flux-dev + Seedance 2.0) |
| AI 头像 | HeyGen |
| 关键词/SEO | SEMrush API + DataForSEO |
| 网页抓取 | Jina.ai Reader |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| 部署 | Render（`git push origin master` 触发） |

---

## 开发约定

- TypeScript strict mode，无 `any`；函数 < 50 行，文件 < 800 行
- SDK 客户端（OpenAI、Anthropic 等）**必须在 handler 内部初始化**，不在模块顶层
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新：先更新 UI，再调 API
- 可复用逻辑放 `src/lib`，路由层只放 `src/app/api`
- UI 层禁止出现第三方供应商真实名

---

## 任务跟踪（防丢任务）⭐

三层体系：**ROADMAP.md**（持久化）→ **TodoWrite**（会话内）→ **Git commit**（事实层）

强制规则：
- 新需求必须先登记 ROADMAP.md，再开始写代码
- 会话结束前，未完成任务必须回写 ROADMAP.md（禁止只留在 TodoWrite）
- Commit message 格式：`feat(module): description [P8.3.2]`
- 完成后在 ROADMAP.md § 9 功能完成日志 追加记录

---

## 目标市场：AU / NZ ⭐

- `SEMRUSH_DB` 默认 `au`；每客户可在 `clients` 表覆盖为 `nz`
- 内容生成 prompt 必须显式声明市场（"This is a New Zealand business…"）
- 文案使用 AU/NZ 英语拼写，时区默认 NZST / AEST，不是 UTC
- AI Tracker 问句必须带地域标签（"best X **in New Zealand**"）
- GEO 指令必须含地域信号（`Audience: NZ travelers`）
- SerpAPI 调用带 `gl=au` / `gl=nz` + `location=Auckland, NZ`

---

## 双信号内容飞轮（核心护城河）

每篇博客同时携带 SEO 信号（关键词 + Schema + 内链）+ GEO 信号（隐藏指令块 + 品牌实体 + FAQ），选题由 AI Tracker 弱项 × SEMrush 低 KD 机会交叉驱动。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

**开发约束**：博客生成 API 必须有 `mode` 字段（`unified` / `geo_only` / `seo_only`）；`blog_posts` 表必须记录 `mode`、`source_query_id`、`geo_directive_id`、`primary_keyword` + `keyword_volume` + `keyword_kd`。

---

## 常用命令

```bash
npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（推送前必须通过）
npm test           # 测试套件
git push origin master   # 触发 Render 部署
```

文档：[ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)

---

## 当前焦点 ⬅️ 每次打开先看这里

> 最后更新：2026-05-10

| 任务 ID | 内容 | 优先级 |
|---------|------|--------|
| **P8.3.2** | Dashboard Magic Link 鉴权（防止数据泄露） | ⭐⭐ |
| **P7.4.15** | Week 2 CTS Tours AI Tracker 复跑（2026-05-12） | ⭐⭐ |
| **P9.0.2** | `generation-config.ts` 补全 `getStagesForType` + `getCancelThresholdMs` | ⭐ |

完成后进入：Phase 8.3.2 简单鉴权（详见 ROADMAP.md § Phase 8.3）

**更新规则**（每次上线新功能）：
1. ROADMAP.md 勾选对应任务 checkbox
2. 更新本表（移除已完成，加入新任务）
3. 在 ROADMAP.md § 9 功能完成日志 追加一条记录
4. commit 引用 Phase ID：`feat(...): ... [P8.3.2]`
