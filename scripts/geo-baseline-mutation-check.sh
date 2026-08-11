#!/usr/bin/env bash
# 变异验证 —— 每一道闸单独确认「拆掉它就会有测试变红」。
#
# 🔴 为什么必须逐道单独拆：一道闸被另一道遮蔽时，它的测试永远不会响 ——
#    整个维度零覆盖，而套件照样全绿。（WP04 第一轮变异就暴露过这个盲区。）
#
# 用法：bash scripts/geo-baseline-mutation-check.sh
# 退出码 0 = 每一道闸都确认会响。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SUITE="src/lib/geo-baseline"
PROVIDER="src/lib/geo-baseline/provider.ts"
PARSER="src/lib/geo-baseline/parser.ts"
STORE="src/lib/geo-baseline/store.ts"
QUERYSET="src/lib/geo-baseline/query-set.ts"

fail_count=0

red_count() {
  npx vitest run "$SUITE" --reporter=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.numFailedTests??0)}catch{console.log("PARSE_ERROR")}})'
}

check() {
  local label="$1" file="$2" from="$3" to="$4"
  cp "$file" "$file.orig"
  # 用 node 做精确字符串替换，避免 sed 的转义地狱
  node -e '
    const fs=require("fs");
    const [f,from,to]=process.argv.slice(1);
    const src=fs.readFileSync(f,"utf8");
    if(!src.includes(from)){console.error("MUTATION_TARGET_NOT_FOUND");process.exit(3)}
    fs.writeFileSync(f,src.replace(from,to));
  ' "$file" "$from" "$to"
  if [ $? -eq 3 ]; then
    echo "❌ [$label] 变异目标没找到 —— 代码改了但这个脚本没跟着改，判据已失效"
    mv "$file.orig" "$file"
    fail_count=$((fail_count+1))
    return
  fi
  local n
  n=$(red_count)
  mv "$file.orig" "$file"
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

echo "基线（未变异）应为 0 红：$(red_count)"
echo "───────────────────────────────────────────────"

check "provider: market 不在表里就退化成无地域" "$PROVIDER" \
  "  const location = SUPPORTED_MARKETS[request.market]
  if (!location) {" \
  "  const location = SUPPORTED_MARKETS[request.market] ?? { country: 'NZ', timezone: 'Pacific/Auckland' }
  if (false) {"

check "provider: 拆掉模型身份核对" "$PROVIDER" \
  "if (result.resolvedModel !== request.modelVersion) {" \
  "if (false) {"

check "provider: 429 归到 error（四态塌成三态）" "$PROVIDER" \
  "if (err.status === 429) {" \
  "if (false) {"

check "provider: 超时的成本改成「已知 0」" "$PROVIDER" \
  "costUsd: { known: false, reason: 'source_ambiguous' }," \
  "costUsd: { known: true, value: 0 },"

check "provider: 拿不到用量时按 0 记成功" "$PROVIDER" \
  "    if (cost === null) {" \
  "    if (false) { const cost2 = cost"

check "provider: locale 不进出站请求" "$PROVIDER" \
  "localeDirective: \`Answer in \${request.locale}.\`," \
  "localeDirective: 'Answer.',"

check "parser: 未核实域名报 false（而不是未知）" "$PARSER" \
  "  if (!policy.verified) {
    return { known: false, reason: 'not_recorded_by_source' }
  }" \
  "  if (!policy.verified) {
    return { known: true, value: false }
  }"

check "parser: 页面归属报 not_associated（而不是不可算）" "$PARSER" \
  "ownedPage: { status: 'not_computable', reason: config.ownedPages.reason }," \
  "ownedPage: { status: 'not_associated' },"

check "parser: 信封版本不校验" "$PARSER" \
  "if (e.envelope !== ENVELOPE_VERSION) {" \
  "if (false) {"

check "store: 不摘 GENERATED 列" "$STORE" \
  "    const insertable = rows.map(stripGeneratedColumns)" \
  "    const insertable = rows.slice()"

check "store: 拆掉落库后对账" "$STORE" \
  "    await this.reconcileAfterWrite(input, batchRow.id)" \
  "    void this.reconcileAfterWrite"

check "store: 读失败时 return [] 而不是抛" "$STORE" \
  "    if (error) fail(\`listBatchIds(\${clientId})\`, error)" \
  "    if (error) return []"

check "query-set: 查不到与查炸了都当成查不到" "$QUERYSET" \
  "  if (setErr) fail(\`读取 \${TABLE_QUERY_SETS}\`, setErr)" \
  "  if (setErr) { /* swallowed */ }"

check "query-set: 建集合时自带 locked_at" "$QUERYSET" \
  "      created_by: seed.createdBy," \
  "      created_by: seed.createdBy, locked_at: new Date().toISOString(),"

echo "───────────────────────────────────────────────"
if [ "$fail_count" -eq 0 ]; then
  echo "✅ 全部 14 道闸各自单独确认会响"
  exit 0
fi
echo "❌ $fail_count 道闸没有确认"
exit 1
