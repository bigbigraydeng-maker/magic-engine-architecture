# Render 部署指南

## 架构概览

```
GitHub Repository
    ↓ (push)
Render Dashboard
    ├─ Web Service (Next.js App)
    │   ├─ npm run build
    │   └─ npm start (API + UI)
    │
    └─ Background Worker (Task Processor)
        ├─ npm install
        └─ npm run process-tasks (每 5 分钟检查一次)
            ↓
        /api/cron/process-tasks (HTTP POST)
            ↓
        generateCaptions() → Supabase
```

## 分步骤部署

### 第 1 步：准备代码

```bash
# 确保所有文件都已提交
git status

# 关键文件检查
ls -la render.yaml           # ✓ 存在
ls -la scripts/process-tasks.js  # ✓ 存在
cat .env.example             # ✓ 所有变量列出
```

### 第 2 步：在 Render 创建项目

1. 访问 https://dashboard.render.com
2. 点击 "New +" → "Blueprint" 或手动创建

**选项 A：使用 Blueprint（推荐）**
```
1. 连接 GitHub 账户
2. 选择 crazycontent 仓库
3. Render 自动读取 render.yaml
4. 配置环境变量（见下文）
5. Deploy
```

**选项 B：手动创建**
```
1. New Web Service → 连接 GitHub
2. 选择仓库和分支
3. 设置：
   Build: npm install && npm run build
   Start: npm start
4. 添加所有环境变量
5. Deploy

6. 再创建一个 Background Worker
   Build: npm install
   Start: npm run process-tasks
   使用相同的环境变量
```

### 第 3 步：配置环境变量

在 Render Dashboard 中为 **每个服务** 设置：

```env
# Supabase (必需 - 与 HiBiz 共享)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenAI (必需)
OPENAI_API_KEY=sk-proj-xxx...

# 任务处理 (必需)
PROCESS_TASKS_SECRET=something-very-random-and-secure-here

# 功能开关
ENABLE_REAL_GENERATION=true
NODE_ENV=production
```

**关键**：`PROCESS_TASKS_SECRET` 必须是强随机密钥（建议使用 `openssl rand -hex 32` 生成）

### 第 4 步：验证部署

```bash
# 1. Web Service 检查
curl https://your-app.onrender.com/api/cron/process-tasks -X GET
# 应该返回: { "success": true, "message": "Task processor cron endpoint is running" }

# 2. 检查 Background Worker 日志
# 在 Render Dashboard 中：
# - 选择 Background Worker 服务
# - 点击 "Logs" 标签
# - 应该看到类似：
#   [Task Processor] Starting...
#   [2026-04-06T...] Task processing complete: { processed: 0, failed: 0, cost: 0 }
```

### 第 5 步：测试任务处理

```bash
# 1. 创建一个测试任务（使用 API）
curl -X POST https://your-app.onrender.com/api/crazy-content/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_test",
    "topic_id": "topic_test",
    "platforms": ["facebook"],
    "scheduled_at": "2026-04-01T00:00:00Z"  # 过去的时间
  }' \
  -H "Authorization: Bearer your-token"  # 需要有效 token

# 2. 等待 5 分钟（或等待 Background Worker 下一个周期）

# 3. 检查 Supabase 中的 generation_logs 表
# 应该看到新增的日志记录
```

## 本地开发时测试任务处理

```bash
# Terminal 1: 启动 Web 应用
npm run dev
# 应该在 http://localhost:3000

# Terminal 2: 启动后台任务处理
npm run process-tasks
# 应该看到日志：
#   [Task Processor] Starting with interval: 300s
#   [Task Processor] Endpoint: http://localhost:3000/api/cron/process-tasks

# 现在创建任务并观察处理
curl -X POST http://localhost:3000/api/crazy-content/tasks ...
# 等待 5 分钟或检查日志
```

## 故障排查

### 问题 1：Background Worker 不运行

**症状**：Render Dashboard 中 Background Worker 状态为 "Exited"

**解决**：
```bash
# 检查 scripts/process-tasks.js 是否存在且有效
cat scripts/process-tasks.js | head -20

# 检查 package.json 中是否有 process-tasks 脚本
cat package.json | grep -A 5 '"scripts"'

# 重新部署
# 在 Render Dashboard 中: 选择服务 → "Deploy" → "Clear build cache and deploy"
```

### 问题 2：任务未被处理

**症状**：Background Worker 运行，但任务状态仍为 "pending"

**检查步骤**：
```bash
# 1. 检查日志中的错误
# Render Dashboard → Background Worker → Logs

# 2. 验证 PROCESS_TASKS_SECRET 一致性
# Web Service 和 Background Worker 应该有相同的密钥

# 3. 检查 RENDER_EXTERNAL_URL
# 确保指向正确的 Web Service URL

# 4. 测试 API 直接调用
curl -X POST https://your-app.onrender.com/api/cron/process-tasks \
  -H "Authorization: Bearer your-process-tasks-secret"
# 应该返回成功响应
```

### 问题 3：OpenAI API 错误

**症状**：生成失败，日志中显示 "OpenAI API error"

**检查**：
```bash
# 1. 验证 API Key 有效
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 2. 检查账户余额和配额
# https://platform.openai.com/account/usage/overview

# 3. 检查 ENABLE_REAL_GENERATION 设置
# 如果为 false，使用 mock generation（不需要 API Key）
```

## 监控和日志

### 实时监控

```bash
# 使用 Render CLI（可选）
render logs [service-id]

# 或在 Render Dashboard 中：
# 1. 选择服务
# 2. 点击 "Logs" 标签
# 3. 选择时间范围
```

### 关键日志行

```
✓ 任务成功处理：
[2026-04-06T10:00:00Z] Task processing complete: { processed: 5, failed: 0, cost: 0.012 }

✗ 认证失败：
[CRON] Invalid authorization token

✗ 数据库错误：
Failed to fetch pending tasks: database connection error

✗ OpenAI 错误：
[CRON] Failed to generate captions for facebook: OpenAI API error: ...
```

## 成本管理

### Render 定价
- **Web Service (Standard)**: 约 $12/月
- **Background Worker**: 约 $12/月
- **总计**: 约 $24/月

### OpenAI 成本
- 约 $0.0004 / 任务（使用 gpt-4o-mini）
- 1000 任务 / 月 ≈ $0.40

### 设置成本告警

1. **Render 告警**：
   - 设置 > Notifications
   - 启用 "High resource usage" 告警

2. **OpenAI 告警**：
   - 访问 https://platform.openai.com/account/billing/limits
   - 设置 "Hard limit" 和 "Soft limit"

## 生产环境最佳实践

1. **定期检查日志**：每天查看是否有错误
2. **监控成本**：每周检查 OpenAI 账单
3. **备份数据**：定期备份 Supabase 数据
4. **更新依赖**：定期运行 `npm audit` 并更新
5. **性能监控**：检查 API 响应时间

## 回滚部署

```bash
# 如果最新部署有问题，在 Render Dashboard 中：
# 1. 选择服务
# 2. 点击 "Deployments" 标签
# 3. 找到前一个成功的部署
# 4. 点击 "Redeploy"
```

## 联系支持

- **Render Support**: https://docs.render.com/
- **Supabase Support**: https://supabase.com/docs/
- **OpenAI API Support**: https://help.openai.com/

---

**最后更新**：2026-04-06
**部署平台**：Render + Supabase
