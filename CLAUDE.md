# CrazyContent - Claude & Cursor 工作指南

## 📌 项目概况

**项目名**：CrazyContent - 自动化社媒内容生成和数据采集系统

**项目位置**：`/c/Users/Zhong/Documents/trae_projects/magic lab/crazycontent/`

**上线期限**：10 天（2026-04-06 ~ 2026-04-16）

**CEO 期望**：
- ✅ 每天固定时间自动生成 Facebook + 小红书文案 + 配图
- ✅ 自动采集社媒反馈数据（点赞、评论、分享）
- ✅ 基于高互动内容自动优化生成参数
- ✅ 每日热点报告和优化建议
- ✅ 用户每天只需复制/下载，去发布

**日更计划**：日后 CEO 希望每天都有新文案，系统需要高度自动化

---

## 📂 项目结构说明

### CrazyContent 是独立项目
```
/c/Users/Zhong/Documents/trae_projects/
├─ magic lab/hibiz/            ← 主产品（现有）
├─ magic lab/crazycontent/      ← CrazyContent（新项目）
│  ├─ src/
│  ├─ package.json
│  ├─ CLAUDE.md                 ← 本文件（自动加载）
│  ├─ supabase/
│  └─ ...
└─ ...
```

### 但完全可以复用 hibiz 的代码和基础设施
- 共享同一个 Supabase 实例（添加新表）
- 复用 hibiz 的 Next.js 配置和依赖
- 复用 hibiz 的现有库和 utilities
- 参考 hibiz 的架构和编码模式

---

## 🎯 Claude 的职责（代码审阅和统筹）

### 1. 代码审阅标准

**每当 Cursor 提交代码时**，审阅以下方面：

#### 🔒 安全性 (必审)
- [ ] 无硬编码的 API key、密码、token
- [ ] 所有 API routes 都有 RLS 验证
- [ ] 用户输入都有验证（防 SQL injection、XSS）
- [ ] 敏感信息（token）都用环境变量或数据库加密存储

#### ✨ 代码质量
- [ ] 函数 < 50 行
- [ ] 文件 < 800 行
- [ ] 无冗余代码，**优先复用 hibiz 代码**
- [ ] TypeScript 严格模式无 any
- [ ] 命名清晰（变量、函数、class）

#### 🔄 性能
- [ ] 数据库查询有索引
- [ ] 无 N+1 查询问题
- [ ] API 响应 < 1s
- [ ] 定时任务不会阻塞其他请求

#### 📊 测试
- [ ] 新增函数都有单元测试
- [ ] API routes 都有集成测试
- [ ] 核心业务逻辑测试覆盖 > 80%
- [ ] 运行 `npm run test` 全部通过

#### 🗄️ 数据库
- [ ] migrations 清晰、可回滚
- [ ] 所有表都有 RLS 规则
- [ ] 外键约束完整
- [ ] 索引策略合理

#### 📝 文档
- [ ] 新 API 都在 API 设计文档中标记为 ✅ 完成
- [ ] 复杂逻辑有代码注释
- [ ] migrations 有说明

### 2. 审阅问题处理

**CRITICAL** (必须修复，阻止合并)
```
- 安全漏洞（硬编码 secret、权限漏洞）
- RLS 规则遗漏（用户可访问他人数据）
- 数据损坏风险
```

**HIGH** (应该修复，可条件合并)
```
- 性能问题（查询慢、内存泄漏）
- 错误处理不完整
- 类型错误（any 类型过多）
```

**MEDIUM** (建议改进)
```
- 代码可读性
- 函数过长（40-50 行）
- 命名不清晰
```

**LOW** (可选改进)
```
- 注释不足
- 风格问题
```

### 3. 进度统筹

**每日 checkpoint**（建议晚间 18:00）:
```
✅ 今天完成了什么
- 任务 1 状态（完成/进行中/阻塞）
- 任务 2 状态
- ...

🚧 遇到的问题
- 问题描述
- 当前卡点
- 需要的支持

📊 Code Review 结果
- Critical issues: X 个
- High issues: Y 个
- 是否可以进入下个阶段

🎯 明天计划
- 任务 A
- 任务 B
```

---

## 👨‍💻 Cursor 的职责（代码实现）

### 工作流程

```
1. 获取任务说明（来自 ROADMAP）
   ↓
2. 在 /src 中创建文件 / 修改代码
   ↓
3. 本地测试 (npm run dev, npm run test)
   ↓
4. 提交代码给 Claude 审阅
   ↓
5. Claude 反馈 → 修复
   ↓
6. Approved ✅ → merge 到 main
```

### 编码规范

**语言**：TypeScript (strict mode)

**代码风格**：遵循现有 hibiz 风格
```typescript
// ✅ Good
async function generateDailyCopy(projectId: string): Promise<ContentTask> {
  const topics = await getActiveTopics(projectId);

  if (!topics.length) {
    throw new Error(`No topics configured for project ${projectId}`);
  }

  const tasks = await Promise.all(
    topics.map(topic => generateCopyForTopic(topic))
  );

  return { ...tasks };
}

// ❌ Bad
async function gen(pid: string): Promise<any> {
  const t = await getTopics(pid);
  const tasks = [];
  for (let i = 0; i < t.length; i++) {
    tasks.push(generateCopyForTopic(t[i]));
  }
  return { ...tasks };
}
```

**文件组织**（遵循 hibiz 结构）:
```
src/
├─ app/crazy-content/           # 用户界面
│  ├─ page.tsx                  # 首页
│  ├─ topics/                   # 主题管理
│  ├─ analytics/                # 分析报告
│  └─ sources/                  # 社媒账户
│
├─ app/api/crazy-content/       # REST API
│  ├─ generate/route.ts
│  ├─ tasks/route.ts
│  ├─ sources/route.ts
│  ├─ feedback/route.ts
│  └─ cron/                     # 定时任务
│
└─ lib/crazy-content/           # 业务逻辑（核心）
   ├─ generation/               # 内容生成
   │  ├─ crazy-copy-generator.ts
   │  ├─ image-selector.ts
   │  └─ types.ts
   │
   ├─ scraping/                 # 爬虫采集
   │  ├─ facebook-scraper.ts
   │  ├─ facebook-oauth.ts
   │  └─ xiaohongshu-upload.ts
   │
   ├─ feedback/                 # 反馈循环
   │  ├─ engagement-scorer.ts
   │  ├─ topic-extractor.ts
   │  ├─ report-generator.ts
   │  └─ param-optimizer.ts
   │
   └─ rate-limiting/            # 成本控制
      └─ cost-limiter.ts
```

---

## 🔄 复用 HiBiz 代码指南

### ⭐ 关键：CrazyContent 不是重新编写，而是在 HiBiz 基础上扩展

**项目关系**：
```
HiBiz (核心产品)
  ├─ 提供基础设施（Next.js, Supabase, OpenAI）
  ├─ 提供现成的库和工具
  └─ 提供编码模式和最佳实践
     ↓
CrazyContent (新产品)
  ├─ 复用 HiBiz 的技术栈
  ├─ 复用 HiBiz 的常用库
  ├─ 参考 HiBiz 的架构模式
  └─ 添加新的、CrazyContent 特定的功能
```

### 必须复用的 HiBiz 代码

#### 1. 文案生成基础
```typescript
// hibiz 位置：src/lib/generation/openai-copy.ts
// 使用方法：参考其结构，改为多平台版本

import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

// CrazyContent 应创建：src/lib/crazy-content/generation/crazy-copy-generator.ts
// 这个文件：
// - 导入 OpenAI client（复用 hibiz 的方式）
// - 改进以支持多平台（Facebook vs 小红书）
// - 保持相同的错误处理和 cost tracking 机制
```

#### 2. 图片处理工具
```typescript
// hibiz 位置：src/lib/extraction/image-url-filters.ts
// 包含：filterImages(), validateImage(), getImageDimensions()

// CrazyContent 应：
// - 复用 filterImages() 来验证 Unsplash 返回的图片
// - 复用 validateImage() 来检查上传的小红书截图
// - 在 src/lib/crazy-content/generation/image-selector.ts 中调用这些函数
```

#### 3. 数据库和 RLS 模式
```typescript
// hibiz 位置：supabase/migrations/
// CrazyContent 应：
// - 参考 hibiz 的 migration 结构（版本号、上下线）
// - 参考 hibiz 的 RLS 规则（基于 auth.uid() 和 project 所有权）
// - 创建新的 migration：supabase/migrations/20260406_init_crazycontent.sql
```

#### 4. TypeScript 类型定义
```typescript
// hibiz 位置：src/types/social-content.ts
// 包含：SocialCaptionsV1, RenderModelV1 等

// CrazyContent 应：
// - 直接导入并复用 SocialCaptionsV1（文案格式）
// - 扩展现有类型而非重新定义
import { SocialCaptionsV1 } from '@/types/social-content';

// 新增 CrazyContent 特定类型：src/types/crazy-content.ts
// - ContentTask, ContentTopic, CollectedPost 等
```

#### 5. Server Actions 和异步处理
```typescript
// hibiz 位置：src/app/app/projects/social-actions.ts
// 模式：使用 'use server' + 类型安全的错误处理

// CrazyContent 应：
// - 参考此模式编写自己的 server actions
// - 使用相同的错误处理机制
// - 在 src/app/api/crazy-content/ 中应用此模式
```

#### 6. API 路由模式
```typescript
// hibiz 位置：src/app/api/... 下的各个 route.ts
// 模式：
// - 所有 routes 都有权限检查
// - 所有 responses 都有一致的格式
// - 所有错误都有适当的 status codes

// CrazyContent 应：
// - 创建 src/app/api/crazy-content/ 目录
// - 遵循相同的 route 结构和命名
// - 在每个 route 中加入相同的权限检查
```

#### 7. 环境变量和配置
```bash
# hibiz 使用：.env.local 中定义
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...

# CrazyContent 应：
# - 使用相同的环境变量
# - 新增 CrazyContent 特定的（FACEBOOK_APP_ID, CRON_SECRET）
# - 参考 hibiz 的 .env.example 和配置加载方式
```

### 参考 HiBiz 的具体文件

```
HiBiz 代码位置                          | CrazyContent 如何使用
─────────────────────────────────────────────────────────
src/lib/generation/openai-copy.ts      | 参考 → crazy-copy-generator.ts
src/lib/extraction/image-url-filters.ts | 复用 → import { ... }
src/lib/extraction/jina-reader.ts      | 参考爬虫逻辑 → facebook-scraper.ts
src/types/social-content.ts            | 复用 + 扩展
src/types/render-model.ts              | 参考类型设计模式
src/app/api/                           | 参考 route 结构
src/app/app/projects/                  | 参考 UI 组件
supabase/migrations/                   | 参考 migration 结构
```

### 何时不要复用

❌ **不要复制整个文件** - 而是理解其逻辑后改写
❌ **不要改动 hibiz 原有代码** - 除非是 bug fix
❌ **不要创建 CrazyContent 独有的库** - 除非 hibiz 没有类似功能
✅ **应该参考 hibiz 的模式** - 然后应用到 CrazyContent
✅ **应该导入 hibiz 的公共类型** - 而非重新定义
✅ **应该学习 hibiz 的最佳实践** - 并应用到新代码

---

## 🔧 开发环境设置

### 前置条件

```bash
# 确保已安装
node -v     # >= 18.17
npm -v      # >= 9
git -v      # >= 2.40

# 环境变量 (.env.local)
# 复用 hibiz 的基础变量
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...

# CrazyContent 新增（仅本地开发）
PROCESS_TASKS_SECRET=dev-secret
ENABLE_REAL_GENERATION=false
RENDER_EXTERNAL_URL=http://localhost:3000

# 社媒集成（可选，后续 Phase 4 需要）
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

### 部署平台说明

**生产环境**：Render + Supabase（不使用 Vercel）

**架构特点**：
- **Web Service**：Node.js Next.js 应用（Render）
- **Background Worker**：后台任务处理（Render）
  - 持续运行 `npm run process-tasks`
  - 每 5 分钟检查并处理待处理任务
  - 通过 HTTP 调用主应用的 `/api/cron/process-tasks` 端点
- **数据库**：Supabase PostgreSQL（共享 HiBiz 实例）
- **配置**：`render.yaml` 在项目根目录

### 常用命令

```bash
# 启动开发服务器
npm run dev
# 访问 http://localhost:3000

# 运行后台任务处理器（模拟 Render 服务）
npm run process-tasks
# 用于本地测试定时任务处理

# 运行测试
npm run test              # 全部测试
npm run test -- lib/      # 仅 lib/ 目录

# 代码检查
npm run lint             # ESLint
npx tsc --noEmit        # TypeScript 检查

# 数据库迁移（在项目根目录运行）
npx supabase migration create <name>
npx supabase migration list

# 构建和部署
npm run build            # 生产构建

# Render 部署（使用 render.yaml）
# 部署流程：
# 1. 推送代码到 GitHub
# 2. 在 Render Dashboard 连接 repo
# 3. 选择 render.yaml 作为配置
# 4. 设置环境变量（见下文）
```

### 部署架构（Render + Supabase）

```
┌─────────────────────────────────────────────┐
│           GitHub Repository                 │
│  (crazycontent, render.yaml 在根目录)      │
└──────────────┬──────────────────────────────┘
               │ push
               ↓
┌──────────────────────────────────────────┐
│        Render Dashboard                  │
│  ┌────────────────────────────────────┐ │
│  │ Web Service (Next.js App)          │ │
│  │ - npm start                        │ │
│  │ - 处理 API 请求                   │ │
│  │ - 处理 UI 请求                    │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ Background Worker                  │ │
│  │ - npm run process-tasks            │ │
│  │ - 每 5 分钟处理一次任务           │ │
│  │ - 调用 /api/cron/process-tasks    │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ Environment Variables              │ │
│  │ - OPENAI_API_KEY                   │ │
│  │ - PROCESS_TASKS_SECRET             │ │
│  │ - SUPABASE_*                       │ │
│  └────────────────────────────────────┘ │
└──────────────┬───────────────────────────┘
               │ API calls
               ↓
┌──────────────────────────────────────────┐
│         Supabase (PostgreSQL)            │
│ - content_tasks                          │
│ - generation_logs                        │
│ - 其他业务表                            │
└──────────────────────────────────────────┘
```

### Render 环境变量配置

在 Render Dashboard 中设置：

```env
# Supabase 配置（复用）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenAI 配置
OPENAI_API_KEY=sk-proj-...

# 后台任务安全密钥
PROCESS_TASKS_SECRET=your-secure-random-secret-here

# 功能开关
ENABLE_REAL_GENERATION=true
NODE_ENV=production
```

### 本地测试后台任务

```bash
# 开发环境 .env.local
PROCESS_TASKS_SECRET=dev-secret
ENABLE_REAL_GENERATION=false
RENDER_EXTERNAL_URL=http://localhost:3000

# Terminal 1: 启动 Web 服务
npm run dev

# Terminal 2: 启动后台任务处理器
npm run process-tasks

# 观察日志输出任务处理结果
```

---

## 📋 Quality Gate Checklist

**每个 Day 结束前，必须检查**：

```
Day 1-2 完成前：
☐ migrations 已执行，表存在
☐ RLS 规则已启用，单元测试通过
☐ 5 个基础 CRUD API 可用
☐ 无 TypeScript 错误
☐ npm run test 通过
☐ 代码复用 hibiz 库（不重复造轮子）

Day 3-4 完成前：
☐ copy-generator 生成文案 < $0.01/条
☐ image-selector 返回图片 URL
☐ 主题 CRUD API 完整
☐ Dashboard 主题页面可用
☐ npm run test 覆盖 > 80%
☐ 参考了 hibiz 的文案生成和图片处理逻辑

Day 5-6 完成前：
☐ Facebook OAuth 完整流程
☐ 采集数据成功存入数据库
☐ 截图 OCR 准确度 > 80%
☐ 采集数据 UI 显示正确
☐ E2E 测试：连接 → 采集 → 显示 通过

Day 7-8 完成前：
☐ 互动评分计算正确
☐ 热点提取结果可读
☐ 日报包含 15+ 话题和 5+ 建议
☐ 参数优化逻辑不失控
☐ npm run test 覆盖 > 80%

Day 9-10 完成前：
☐ Dashboard 完整，所有页面可访问
☐ 定时任务在预定时间执行
☐ E2E：生成 → 发布 → 采集 → 报告 全通过
☐ npm run build 成功，无警告
☐ 部署到 Render，生产环境可访问
```

---

## 🆘 遇到问题时

### 问题分类和处理

**🔴 Critical Issues（立即告知 Claude）**
- 数据库连接失败
- RLS 规则出错（用户权限问题）
- 定时任务未执行
- API 请求 > 5s

**🟠 High Issues（同日内解决）**
- 生成成本超估算
- API 限流/被拒访
- OCR 准确度 < 70%

**🟡 Medium Issues（下日内解决）**
- UI 响应慢
- 代码重复
- 测试覆盖 < 70%

**🟢 Low Issues（可推迟）**
- 代码风格
- 注释不足
- 文档不完整

### 求助 Claude 的方式

```
【问题】
简短描述遇到的问题（1-2 句）

【现象】
具体表现，包括错误信息（如有）

【已尝试】
你已经尝试过的方案和结果

【卡点】
为什么无法继续

【需要的帮助】
希望 Claude 提供什么（code review、架构建议、临时 workaround 等）
```

---

## 📞 关键联系信息

**Claude（代码审阅、架构问题）**：
- 职责：审阅代码、统筹进度、解决技术阻塞
- 日常：每日 checkpoint，有问题立即沟通

**关键文档**：
```
本项目：
  - CLAUDE.md (本文件)
  - ~/Documents/Second-Brain/01-Magiclab/Projects/CrazyContent/03-ROADMAP-10天实现计划.md
  - ~/Documents/Second-Brain/01-Magiclab/Projects/CrazyContent/01-PROJECT-产品与技术全景.md

系统设计：
  - ~/.claude/plans/crazycontent-system-design.md

参考项目（HiBiz）：
  - /c/Users/Zhong/Documents/trae_projects/magic lab/hibiz/
```

---

## 🎓 学习资源

**HiBiz 参考代码**：
- `/hibiz/supabase/migrations/` - 数据库设计模式
- `/hibiz/src/lib/generation/` - 文案生成（复用）
- `/hibiz/src/lib/extraction/` - 图片处理和爬虫（参考）
- `/hibiz/src/types/` - TypeScript 类型定义（复用）
- `/hibiz/src/app/api/` - API 路由模式（参考）
- `/hibiz/src/app/app/` - React 组件和 UI 模式（参考）

**第三方文档**：
- OpenAI API: https://platform.openai.com/docs/api-reference/chat/create
- Supabase: https://supabase.com/docs
- Facebook Graph API: https://developers.facebook.com/docs/graph-api/
- Next.js: https://nextjs.org/docs

---

## 🚀 现在开始

1. 查看 ROADMAP：`~/Documents/Second-Brain/01-Magiclab/Projects/CrazyContent/03-ROADMAP-10天实现计划.md`
2. 创建分支：`git checkout -b feat/crazycontent-day1`
3. 开始 Day 1 任务
4. 定期提交代码给 Claude 审阅

**祝你开发顺利！** 🎯

---

Last Updated: 2026-04-06
Status: 📌 准备开发启动
