# CrazyContent 项目

自动化社媒内容生成和数据采集系统

## 📋 快速导航

### 📖 核心文档

| 文档 | 位置 | 用途 |
|------|------|------|
| **CLAUDE.md** | 本项目根 | ⭐ Cursor 开发指南（自动加载） |
| **ROADMAP** | Obsidian | 10 天详细任务分解 |
| **PROJECT** | Obsidian | 产品定义和技术架构 |
| **System Design** | `~/.claude/plans/` | Claude 的完整设计文档 |

### 🔗 Obsidian 项目库

所有详细文档都在：
```
~/Documents/Second-Brain/01-Magiclab/Projects/CrazyContent/
├─ 00-MOC-CrazyContent.md                 (项目导航)
├─ 01-PROJECT-产品与技术全景.md           (产品定义)
├─ 02-CLAUDE-项目特定指令.md              (完整指南)
├─ 03-ROADMAP-10天实现计划.md            ⭐ 最重要
└─ 04-CHANGELOG-版本日志.md              (进度记录)
```

**推荐：在 Obsidian 中打开这个文件夹** 来查看完整的项目知识库

---

## 🎯 项目概览

### 目标
10 天内完成 MVP，支持：
- 每日自动生成 Facebook + 小红书文案和配图
- 自动采集社媒数据（点赞、评论、分享）
- 智能反馈循环（高互动内容自动优化）
- 每日热点报告和优化建议

### 时间表
```
Day 1-2   📊 数据库 + API
Day 3-4   🤖 内容生成
Day 5-6   🔄 社媒采集
Day 7-8   📈 反馈循环
Day 9-10  🎯 Dashboard + 上线
```

### 技术栈
- **前端**：React 18 + Tailwind CSS
- **后端**：Next.js 14 App Router
- **数据库**：Supabase PostgreSQL
- **AI**：OpenAI gpt-4o-mini
- **爬虫**：Facebook Graph API + 小红书截图
- **定时**：Vercel Cron
- **部署**：Render

---

## 🚀 快速开始

### 1. 查看开发指南
```bash
# 打开本项目的 CLAUDE.md（自动加载）
cat CLAUDE.md
```

### 2. 查看详细任务
```bash
# 打开 Obsidian，导航到：
# ~/Documents/Second-Brain/01-Magiclab/Projects/CrazyContent/03-ROADMAP-10天实现计划.md
```

### 3. 启动开发
```bash
# 创建分支
git checkout -b feat/crazycontent-day1

# 启动开发服务器
npm run dev

# 运行测试
npm run test
```

---

## 📂 项目结构

### 代码组织

```
crazycontent/
├─ src/
│  ├─ app/crazy-content/        # Dashboard UI
│  ├─ app/api/crazy-content/    # REST API
│  └─ lib/crazy-content/        # 业务逻辑
├─ supabase/
│  └─ migrations/               # 数据库 schema
├─ CLAUDE.md                    # 开发指南
├─ README.md                    # 本文件
├─ package.json
└─ ...
```

### 数据库

**新增 8 个表**（Supabase hibiz 项目）：
- `content_tasks` - 内容生成任务
- `content_topics` - 主题库
- `social_sources` - 社媒账户
- `collected_posts` - 采集的内容
- `feedback_data` - 互动反馈
- `trending_reports` - 热点报告
- `generation_logs` - 生成日志
- `generation_params` - 优化参数

---

## 💡 关键信息

### 复用 HiBiz 代码

CrazyContent **不是重新编写**，而是在 HiBiz 基础上扩展：

```
HiBiz (现有产品)
  ├─ 提供技术栈 (Next.js, Supabase, OpenAI)
  ├─ 提供常用库 (openai-copy, image filters)
  └─ 提供编码模式
     ↓
CrazyContent (新产品)
  ├─ 复用 HiBiz 的基础设施
  ├─ 参考 HiBiz 的架构
  └─ 添加新功能
```

**详见 CLAUDE.md 中的《复用 HiBiz 代码指南》**

### 环境变量

```bash
# 复用 HiBiz 的基础变量
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...

# CrazyContent 新增
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
CRON_SECRET=...
```

---

## 📞 工作流程

### 日常开发流程

```
1. 读 ROADMAP，获取今日任务
2. 编写代码，本地测试
3. npm run test (coverage > 80%)
4. npm run lint (no warnings)
5. 提交代码，告知 Claude
6. 等待 Claude 代码审阅
7. 根据反馈修改
8. Approved ✅ → merge main
```

### 每日提交内容

```
✅ 完成的任务列表
🔄 进行中的任务 (% complete)
🚨 遇到的问题
📊 代码覆盖率、性能指标
🎯 明天的计划
```

### 质量门控

**每个 Day 结束前必须通过**：
- npm run test (coverage > 80%)
- npm run lint (no warnings)
- npx tsc --noEmit (no errors)
- npm run build (success)
- 所有 RLS 规则测试通过

---

## 🎓 学习资源

### HiBiz 参考代码

```
../hibiz/
├─ src/lib/generation/openai-copy.ts      → 参考文案生成
├─ src/lib/extraction/image-url-filters.ts → 复用图片工具
├─ src/lib/extraction/jina-reader.ts      → 参考爬虫
├─ src/types/social-content.ts            → 复用类型
├─ src/app/api/                           → 参考 API 模式
└─ supabase/migrations/                   → 参考数据库
```

### 外部文档

- OpenAI API: https://platform.openai.com/docs
- Supabase: https://supabase.com/docs
- Facebook Graph API: https://developers.facebook.com/docs/graph-api/
- Next.js: https://nextjs.org/docs

---

## 🆘 遇到问题？

### 检查清单

1. **代码问题** → 查看 CLAUDE.md 的"遇到问题时"部分
2. **架构问题** → 查看 `~/.claude/plans/crazycontent-system-design.md`
3. **任务不清楚** → 查看 `~/Documents/Second-Brain/.../03-ROADMAP-10天实现计划.md`
4. **如何复用 HiBiz** → 查看 CLAUDE.md 的"复用 HiBiz 代码指南"部分

### 求助 Claude

格式：
```
【问题】简短描述

【现象】具体错误和堆栈跟踪

【已尝试】你尝试过的解决方案

【卡点】为什么无法继续

【需要】希望 Claude 提供什么帮助
```

---

## 📊 项目进度

### 当前阶段
```
Stage 1 (Day 1-2)   ⏳ 数据库 + API
Stage 2 (Day 3-4)   ⏳ 内容生成
Stage 3 (Day 5-6)   ⏳ 社媒采集
Stage 4 (Day 7-8)   ⏳ 反馈循环
Stage 5 (Day 9-10)  ⏳ Dashboard + 上线
```

**详见 CHANGELOG.md 了解完整进度**

---

## 🔗 重要链接

| 链接 | 说明 |
|------|------|
| CLAUDE.md | ⭐ 开发指南（本项目根） |
| ~/Documents/.../03-ROADMAP | 10 天任务分解 |
| ~/.claude/plans/... | 系统设计方案 |
| ../hibiz/ | HiBiz 参考代码 |

---

## 📝 文件约定

- **代码更新** → 在 Obsidian CHANGELOG 中记录
- **架构变更** → 更新 CLAUDE.md 或创建设计文档
- **新 API** → 在 PROJECT 中的 API 设计章节标记完成
- **每日进度** → 在 CHANGELOG 的"Daily Checkpoint"中记录

---

## 🎯 成功标志

**Day 10 完成时**：
- ✅ 所有 5 个 stage 通过 quality gate
- ✅ 定时任务在生产环境运行
- ✅ Dashboard 可访问
- ✅ CEO 可以开始使用
- ✅ 测试覆盖 > 80%
- ✅ 部署到 Render

---

**Ready to start?** 👉 打开 CLAUDE.md 了解详细的工作流程

---

Last Updated: 2026-04-06
Status: 📌 准备就绪，等待开发启动
