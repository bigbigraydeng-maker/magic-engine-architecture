#!/usr/bin/env bash
# Product Map 同步层变异验证 —— 逐道确认「拆掉这道闸就会有测试变红」。
# 用法:bash scripts/product-map-sync-mutation-check.sh(merge 前手跑;退出码 0 = 全响)
# 判据套件:product-map-sync + webhook product-map 分支测试,基线必须 0 红。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SUITE_A="src/lib/product-map-sync"
SUITE_B="src/app/api/cms/github/webhook/__tests__/product-map-branch.test.ts"
MARKER="src/lib/product-map-sync/marker.ts"
FSTORE="src/lib/product-map-sync/fake-store.ts"
PROVIDER="src/lib/product-map-sync/github-rest-provider.ts"
RUNNER="src/lib/product-map-sync/runner.ts"
ROUTE="src/app/api/cms/github/webhook/route.ts"
MIGRATION="supabase/migrations/20260815000001_product_map_sync_v1.sql"

fail_count=0
total_count=0

# 🔴 会真的改生产代码再改回来;中断由 trap 还原,若仍见 *.orig 先手动 mv 回去。
CURRENT_MUTATED=""
restore_on_exit() {
  if [ -n "$CURRENT_MUTATED" ] && [ -f "$CURRENT_MUTATED.orig" ]; then
    mv "$CURRENT_MUTATED.orig" "$CURRENT_MUTATED"
    echo "⚠️  被打断 —— 已把 $CURRENT_MUTATED 还原,工作区是干净的"
  fi
}
trap restore_on_exit EXIT INT TERM

red_count() {
  npx vitest run "$SUITE_A" "$SUITE_B" --reporter=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.numFailedTests??0)}catch{console.log("PARSE_ERROR")}})'
}

check() {
  local label="$1" file="$2" from="$3" to="$4"
  total_count=$((total_count+1))
  cp "$file" "$file.orig"
  CURRENT_MUTATED="$file"
  node -e '
    const fs=require("fs");
    const [f,from,to]=process.argv.slice(1);
    const src=fs.readFileSync(f,"utf8");
    if(!src.includes(from)){console.error("MUTATION_TARGET_NOT_FOUND");process.exit(3)}
    fs.writeFileSync(f,src.replace(from,to));
  ' "$file" "$from" "$to"
  if [ $? -eq 3 ]; then
    echo "❌ [$label] 变异目标没找到 —— 源码改了但脚本没跟着改,判据已失效"
    mv "$file.orig" "$file"
    CURRENT_MUTATED=""
    fail_count=$((fail_count+1))
    return
  fi
  local n
  n=$(red_count)
  mv "$file.orig" "$file"
  CURRENT_MUTATED=""
  if [ "$n" = "PARSE_ERROR" ]; then
    echo "❌ [$label] 跑不出结果"
    fail_count=$((fail_count+1))
  elif [ "$n" -gt 0 ] 2>/dev/null; then
    echo "✅ [$label] 拆掉它 → $n 条红"
  else
    echo "❌ [$label] 拆掉它 → 0 条红 —— 这道闸零覆盖"
    fail_count=$((fail_count+1))
  fi
}

echo "== 基线(必须 0 红) =="
baseline=$(red_count)
if [ "$baseline" != "0" ]; then
  echo "❌ 基线就有 $baseline 条红,先修基线再跑变异"
  exit 2
fi
echo "✅ 基线 0 红"
echo
echo "== 逐道拆闸 =="

# 1. webhook 验签恒真
check "webhook 验签恒真" "$ROUTE" \
  "if (!verifySignature(rawBody, sig)) {" \
  "if (false) {"

# 2. 仓门拆掉(客户仓事件也进 product-map 分支 / 本仓事件走不到)
check "仓门分流拆掉" "$ROUTE" \
  "if (parsed.repository?.full_name === APPROVED_REPO) {" \
  "if (false) {"

# 3. 投递重放不判重
check "投递重放不判重" "$FSTORE" \
  "if (existing) return existing.status === 'failed' ? 'retry_failed' : 'duplicate'" \
  "if (existing && false) return 'duplicate'"

# 4. failed 投递也判重(事件被永久吞)
check "failed 投递也判重" "$FSTORE" \
  "return existing.status === 'failed' ? 'retry_failed' : 'duplicate'" \
  "return 'duplicate'"

# 5. 单调守卫拆掉(旧数据打回新状态)
check "单调守卫拆掉" "$FSTORE" \
  "if (existing && existing.observed_at >= fact.observed_at) {" \
  "if (false) {"

# 6. targeted 轮也收编 unclassified(误消)
check "targeted 也收编未分类" "$FSTORE" \
  "if (input.mode === 'full') {" \
  "if (true) {"

# 7. code fence 跳过拆掉(教程型 issue 里的示例标记会被误当真标记)
#    注:\r\n 韧性是双层的(trim + 正则 \s*$ 都吸收 \r),单点变异打不穿 ——
#    该行为由 marker.test 的 \r\n fixture 直接锁定,不设探针。
check "fence 内示例标记被当真" "$MARKER" \
  'if (/^\s*(```|~~~)/.test(line)) {' \
  "if (false) {"

# 8. 标记匹配放宽成子串(模糊关联禁令)
check "标记匹配放宽成子串" "$MARKER" \
  "/^ME2-Component-ID:\\s*([a-z0-9-]+\\.[a-z0-9-]+)\\s*\$/" \
  "/ME2-Component-ID:\\s*([a-z0-9-]+\\.[a-z0-9-]+)/"

# 9. REST 限流地板拆掉
check "REST 限流地板拆掉" "$PROVIDER" \
  "if (!Number.isNaN(remaining) && remaining < REST_REMAINING_FLOOR) {" \
  "if (false) {"

# 10. checks 不按 head sha 键控
check "checks 不按 head sha 键控" "$RUNNER" \
  "checks: { sha: f.headSha, checks: f.checks, truncated: f.checksTruncated }," \
  "checks: { sha: 'stale-sha', checks: f.checks, truncated: f.checksTruncated },"

# 11. RLS 漏 TO service_role(migration 契约)
check "RLS 漏 TO service_role" "$MIGRATION" \
  "CREATE POLICY product_map_sync_runs_service          ON product_map_sync_runs          FOR ALL TO service_role USING (true);" \
  "CREATE POLICY product_map_sync_runs_service          ON product_map_sync_runs          FOR ALL USING (true);"

# 12. SQL 单调守卫被删(fake 与 SQL 必须同步)
check "SQL 单调守卫被删" "$MIGRATION" \
  "v_skipped_stale := v_skipped_stale + 1;" \
  "v_skipped_stale := v_skipped_stale;"

echo
if [ "$fail_count" -gt 0 ]; then
  echo "❌ $total_count 道闸里 $fail_count 道没响"
  exit 1
fi
echo "✅ 全部 $total_count 道闸都会响"
