# P7.1 诊断验证 - 后续步骤

## 当前状态

✅ **已完成**：
- 代码修复已提交到 Git（commit: `7b2159b`）
  - 添加 2 秒批处理延迟防止 Claude 速率限制
  - 改进 Parser 错误捕获和日志记录
- 数据库迁移文件已创建
  - `supabase/migrations/20260430000003_add_parse_error_message.sql`
  
⏳ **待完成**：
- 应用数据库迁移到 Supabase
- 清空旧诊断数据
- 重新运行诊断验证修复

## 为什么需要这些步骤

当前的诊断数据来自旧的运行（修复前）：
- **Claude 成功率**: 9/19 (47%) ← 10 个 429 速率限制错误
- **Parser 成功率**: 44% (11/25) ← 批处理没有延迟导致并发请求

代码修复后，需要：
1. **应用迁移** — 确保 `parse_error_message` 列存在以便存储错误
2. **清空旧数据** — 移除修复前的诊断结果，避免混淆
3. **重新运行** — 验证 Claude 速率限制和 Parser 成功率是否改善

## 手动操作步骤（Supabase UI）

### 步骤 1: 应用数据库迁移

1. 打开 Supabase 仪表板: https://app.supabase.com
2. 进入项目 `glbdnayojixmexgofbsd`
3. 左侧菜单 → "SQL Editor"
4. 新建查询，粘贴以下 SQL：

```sql
ALTER TABLE ai_visibility_runs
  ADD COLUMN IF NOT EXISTS parse_error_message text DEFAULT NULL;
```

5. 点击"RUN"执行
6. 确认执行成功（"Successfully executed 1 query"）

### 步骤 2: 清空旧诊断数据

1. SQL Editor 中新建查询：

```sql
-- 清空诊断用的旧运行记录（保留快照以备查证）
DELETE FROM ai_visibility_runs 
WHERE created_at < now() - interval '1 hour'
AND client_id IN (
  SELECT id FROM clients WHERE name LIKE '%CTS%'
);
```

> 可选：如需完全清空，改为：`DELETE FROM ai_visibility_runs;`

### 步骤 3: 验证迁移

1. SQL Editor 中执行：

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'ai_visibility_runs' 
  AND column_name = 'parse_error_message';
```

2. 应该返回 1 行，显示 `parse_error_message | text`

## API 方式（如果需要自动化）

### 方式 A: 通过 Supabase REST API

```bash
# 应用迁移
curl -X POST "https://glbdnayojixmexgofbsd.supabase.co/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "ALTER TABLE ai_visibility_runs ADD COLUMN IF NOT EXISTS parse_error_message text DEFAULT NULL;"
  }'
```

### 方式 B: 通过本地诊断 API（需要清空旧数据）

```bash
# 先清空表
DELETE FROM ai_visibility_runs;

# 然后运行诊断
curl -X POST "http://localhost:3002/api/ai-tracker/run" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "engines": ["openai", "anthropic"]
  }'
```

## 预期结果

完成上述步骤后，重新运行诊断应该显示：

| 指标 | 当前 | 预期 | 改进 |
|------|------|------|------|
| Claude 速率限制错误 | 10 失败 | 0 失败 | ✅ |
| Parser 成功率 | 44% | 85%+ | ✅ |
| Claude 成功率 | 47% | 90%+ | ✅ |

## 可选：自动清空和重新运行脚本

创建 `scripts/reset-and-diagnose.sh`:

```bash
#!/bin/bash

SUPABASE_URL="https://glbdnayojixmexgofbsd.supabase.co"
SUPABASE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
CLIENT_ID="YOUR_CLIENT_ID"

echo "📊 重置诊断并重新运行..."

# 1. 清空旧数据
echo "🗑️  清空旧数据..."
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -d '{"sql":"DELETE FROM ai_visibility_runs;"}' >/dev/null

# 2. 应用迁移
echo "📝 应用迁移..."
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -d '{"sql":"ALTER TABLE ai_visibility_runs ADD COLUMN IF NOT EXISTS parse_error_message text DEFAULT NULL;"}' >/dev/null

# 3. 重新运行诊断
echo "🔄 运行诊断..."
curl -s -X POST "http://localhost:3002/api/ai-tracker/run" \
  -H "Content-Type: application/json" \
  -d "{\"client_id\":\"$CLIENT_ID\",\"engines\":[\"openai\",\"anthropic\"]}"

echo "✅ 完成！"
```

## 下一步

1. **立即**: 
   - [ ] 通过 Supabase UI 应用迁移
   - [ ] 清空旧诊断数据
   
2. **验证**:
   - [ ] 重新运行诊断：`POST /api/ai-tracker/run`
   - [ ] 检查诊断结果：`GET /api/diagnostic/results`
   - [ ] 验证 Parser 成功率是否 ≥ 85%

3. **如成功**:
   - [ ] 提交最终验证报告
   - [ ] 更新 ROADMAP.md 标记 P7.1.9-10 完成
   - [ ] 启动 P7.1.11 Cron 验证

4. **如失败**:
   - [ ] 查看 `/api/diagnostic/parser-errors` 获取新的错误详情
   - [ ] 检查 `parse_error_message` 列中的错误原因
   - [ ] 调整批处理延迟（可能需要 3-5 秒）

---

**参考**:
- DIAGNOSTIC_FINDINGS.md — 详细的根本原因分析
- ARCHITECTURE.md §12 — AI Visibility Tracker 架构
- 最近提交: `fix(ai-tracker): improve parser error handling and add batch delays [P7.1.9]`
