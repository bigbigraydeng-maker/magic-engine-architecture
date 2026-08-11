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
TRANSPORT="src/lib/geo-baseline/transport-openai.ts"
RUNSCRIPT="scripts/geo-baseline-run.ts"
CONFIG="src/lib/geo-baseline/config.ts"

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

check "transport: 中断判定退回只看 err.name（复审发现的那个死分支）" "$TRANSPORT" \
  "  const aborted =
    signal.aborted ||" \
  "  const aborted =
    false ||"

check "transport: 不关掉 SDK 自动重试" "$TRANSPORT" \
  "Object.freeze({ maxRetries: 0 })" \
  "Object.freeze({ maxRetries: 2 })"

check "provider: 模型对不上时记 0（而不是实际花费）" "$PROVIDER" \
  "      return this.modelMismatchResult(this.modelMismatch, measured ?? this.ceiling())" \
  "      return this.modelMismatchResult(this.modelMismatch, 0)"

check "provider: 拆掉模型对不上之后的闩" "$PROVIDER" \
  "    if (this.modelMismatch !== null) {" \
  "    if (false) {"

check "provider: 拿不到用量时记 0（而不是上界）" "$PROVIDER" \
  "        costUsd: this.ceiling()," \
  "        costUsd: 0,"

check "parser: 空正文当成「答了但没引来源」" "$PARSER" \
  "    if (text === null) {" \
  "    if (false) { const t2 = text"

check "store: 对账不读批次行" "$STORE" \
  "    if (readBack.batchRowCount !== 1) {" \
  "    if (false) {"

check "store: 对账不比成功数" "$STORE" \
  "    if (readBack.successIds.length !== actual.succeeded) {" \
  "    if (false) {"

check "store: 对账读失败时 orphaned 报 false" "$STORE" \
  "    if (obsErr) fail(\`对账读取 \${TABLE_OBSERVATIONS}\`, obsErr, true)" \
  "    if (obsErr) fail(\`对账读取 \${TABLE_OBSERVATIONS}\`, obsErr)"

check "store: 不截断 error_message" "$STORE" \
  "      clampErrorMessage(toGeoObservationRow({ observation, clientId: input.clientId, createdAt }))," \
  "      toGeoObservationRow({ observation, clientId: input.clientId, createdAt }),"

check "config: verified 从清单非空推出来（复审确认的违规原样）" "$CONFIG" \
  "  if (attestation.length === 0) {" \
  "  if (domains.length > 0 ? false : true) {"

check "config: 可选数值不验有限（Number('60s')=NaN）" "$CONFIG" \
  "  if (!Number.isFinite(n) || n <= 0) {
    throw new GeoConfigError('not_positive', \`环境变量 \${name}=\"\${raw}\" 必须是一个大于 0 的有限数字。\`)
  }" \
  "  if (false) {
    throw new GeoConfigError('not_positive', '')
  }"

check "config: 价格填 0 也放行（预算闸从此形同虚设）" "$CONFIG" \
  "  if (opts.positive === true && n <= 0) {" \
  "  if (false) {"

check "脚本: 部分覆盖也返回 0" "$RUNSCRIPT" \
  "  return 2" \
  "  return 0"

echo "───────────────────────────────────────────────"
if [ "$fail_count" -eq 0 ]; then
  echo "✅ 全部 27 道闸各自单独确认会响"
  exit 0
fi
echo "❌ $fail_count 道闸没有确认"
exit 1
