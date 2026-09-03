#!/usr/bin/env bash
#
# 生产库**只读**查询 —— 给 Claude Code 会话用的安全通道。
#
# 为什么存在：`execute_sql` 那个 MCP 工具读写通吃，一句 DELETE 就能删掉生产数据，
# 所以它被放进 .claude/settings.local.json 的 deny 清单（跟 force push、reset --hard
# 站一起）。但「拿生产库验证，别看代码猜」是硬要求 —— 只读需求不该被一起挡死。
#
# 这个脚本走 PostgREST 的 GET 接口：**HTTP GET 物理上改不了任何数据**，
# 没有 INSERT/UPDATE/DELETE 的可能性，护栏的目的完整保留。
#
# 密钥只在本进程内读，绝不打印、绝不进 agent 上下文（这也是为什么不能让
# agent 直接 grep .env.local —— 那会把 service role key 塞进对话历史）。
#
# 用法：
#   bash scripts/db-read.sh <表名> [查询串]
#
# 例：
#   bash scripts/db-read.sh clients 'select=id,name&limit=5'
#   bash scripts/db-read.sh conversations 'select=id,subject&channel=eq.email&limit=3'
#   bash scripts/db-read.sh contacts 'select=count'            # 数行数
#   bash scripts/db-read.sh conversations 'select=*,contacts(display_name)&limit=2'  # 关联表
#
# 查询串语法见 PostgREST：eq. / neq. / gt. / gte. / lt. / lte. / in. / is. / order= / limit=

set -euo pipefail

TABLE="${1:-}"
QUERY="${2:-limit=10}"

if [ -z "$TABLE" ]; then
  echo "用法: bash scripts/db-read.sh <表名> [查询串]" >&2
  echo "例:   bash scripts/db-read.sh clients 'select=id,name&limit=5'" >&2
  exit 2
fi

# 只从仓库根的 .env.local 读，且只取需要的两个键。
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "找不到 $ENV_FILE —— 新 worktree 需要先从主仓复制一份 .env.local" >&2
  exit 1
fi

# 用 grep 单独取值而不是 source 整个文件：.env.local 里有带特殊字符的值，
# source 会把它们当命令执行。
get_env() {
  grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r'
}

SUPABASE_URL="$(get_env NEXT_PUBLIC_SUPABASE_URL || true)"
SERVICE_KEY="$(get_env SUPABASE_SERVICE_ROLE_KEY || true)"

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "在 .env.local 里没找到 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY" >&2
  exit 1
fi

# 🔴 只发 GET。这是这个脚本全部安全性的所在 —— 不接受也不构造任何写方法。
# 需要 count 时 PostgREST 要求带 Prefer 头。
curl -fsS -X GET \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Accept: application/json" \
  -H "Prefer: count=exact" \
  "${SUPABASE_URL}/rest/v1/${TABLE}?${QUERY}" \
  | python3 -c "import json,sys; d=sys.stdin.read(); print(json.dumps(json.loads(d), ensure_ascii=False, indent=2) if d.strip() else '[]')"
