#!/usr/bin/env bash
# 台账层（Issue #930）变异验证 —— 每一道闸单独确认「拆掉它就会有测试变红」。
#
# 🔴 为什么必须逐道单独拆：一道闸被另一道遮蔽时，它的测试永远不会响 ——
#    整个维度零覆盖，而套件照样全绿。
#
# 用法：bash scripts/canonical-inventory-mutation-check.sh
# 退出码 0 = 每一道闸都确认会响。
#
# 注意：判据套件只跑 canonical-inventory 目录。job-executor 有 2 条**先于本分支就红**的
#      历史用例，混进来会让基线不为 0，判据就失去意义。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SUITE="src/lib/site-audit/canonical-inventory"
RULES="src/lib/site-audit/canonical-inventory/url-rules.ts"
PLAN="src/lib/site-audit/canonical-inventory/plan.ts"
ACT="src/lib/site-audit/canonical-inventory/activation.ts"

fail_count=0

red_count() {
  npx vitest run "$SUITE" --reporter=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.numFailedTests??0)}catch{console.log("PARSE_ERROR")}})'
}

check() {
  local label="$1" file="$2" from="$3" to="$4"
  cp "$file" "$file.orig"
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

# ——— 主机边界 ———
check "🔴 主机判定退回成后缀匹配（www / 子域会混进来）" "$RULES" \
  "  return approvedHosts.some((approved) => approved === host)" \
  "  return approvedHosts.some((approved) => host.endsWith(approved))"

check "🔴 主机判定退回成 crawler 那套前缀比较" "$RULES" \
  "  return approvedHosts.some((approved) => approved === host)" \
  "  return approvedHosts.some((approved) => host.startsWith(approved))"

check "批准清单不校验（带 scheme / 通配符的写法混进来）" "$RULES" \
  "    if (/[:/\\\\?#@*]/.test(host) || host.startsWith('.') || host.endsWith('.')) {" \
  "    if (false) {"

check "空批准清单也放行（等于没有边界）" "$RULES" \
  "  if (hosts.length === 0) {" \
  "  if (false) {"

# ——— URL 归一 ———
check "http 也当合法（替对方假设会跳 https）" "$RULES" \
  "  if (parsed.protocol === 'http:') return 'insecure_scheme'" \
  "  if (parsed.protocol === 'http:') return null"

check "带凭据的 URL 放行" "$RULES" \
  "  if (parsed.username.length > 0 || parsed.password.length > 0) {" \
  "  if (false) {"

check "非默认端口放行" "$RULES" \
  "  if (parsed.port.length > 0) return { ok: false, reasonCodes: ['non_default_port'], notes }" \
  "  if (false) return { ok: false, reasonCodes: ['non_default_port'], notes }"

check "尾斜杠不归一（同一页面留下两条身份）" "$RULES" \
  "  if (path.length > 1 && path.endsWith('/')) {" \
  "  if (false) {"

check "片段不去掉" "$RULES" \
  "https://\${parsed.hostname}\${path}\${query.search}" \
  "https://\${parsed.hostname}\${path}\${query.search}\${parsed.hash}"

check "🔴 有意义的查询参数被一并删掉（两个真实页面合并成一条）" "$RULES" \
  "    kept.push([key, value])" \
  "    if (false) kept.push([key, value])"

check "查询参数不排序（顺序不同就多出一条候选）" "$RULES" \
  "  const sorted = [...kept].sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])))" \
  "  const sorted = [...kept]"

check "canonical 幂等自检恒真（手改的 URL 就能蒙混过关）" "$RULES" \
  "  return result.ok && result.canonicalUrl === url" \
  "  return true"

# ——— 计划 ———
check "🔴 合规候选直接给 accepted（回到「发现即接受」）" "$PLAN" \
  "      decision: 'pending',
      reasonCodes: [],
      notes: result.notes," \
  "      decision: 'accepted',
      reasonCodes: [],
      notes: result.notes,"

check "撞车的候选悄悄丢掉（审计里就看不见了）" "$PLAN" \
  "    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {" \
  "    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {
      void primary; continue
    }
    if (false) {"

check "主候选按发现顺序定（哈希不再稳定）" "$PLAN" \
  "  uniqueOriginals.sort(compareStrings)" \
  "  void compareStrings"

check "🔴 规则自动拒的候选允许人工改成 accepted" "$PLAN" \
  "    if (candidate.decision !== 'pending') {" \
  "    if (false) {"

check "🔴 哈希不覆盖决策（批准后改决策查不出来）" "$PLAN" \
  "      decision: c.decision," \
  "      decision: 'x',"

check "哈希不覆盖复核签名" "$PLAN" \
  "    review: plan.review === null ? null : {
      reviewedBy: plan.review.reviewedBy,
      reviewedAt: plan.review.reviewedAt,
      note: plan.review.note ?? null,
    }," \
  "    review: null,"

check "复核不要求署名" "$PLAN" \
  "  if (input.review.reviewedBy.trim().length === 0) {" \
  "  if (false) {"

# ——— 激活闸 ———
check "🔴 不校验计划哈希" "$ACT" \
  "  if (!verifyPlanHash(plan)) {" \
  "  if (false) {"

check "🔴 不校验租户" "$ACT" \
  "  if (plan.clientId !== expected.clientId) {" \
  "  if (false) {"

check "不校验域名" "$ACT" \
  "  if (!sameDomain(plan.boundary.requestedDomain, expected.requestedDomain)) {" \
  "  if (false) {"

check "🔴 不校验批准主机清单" "$ACT" \
  "  if (!sameHostSet(plan.boundary.approvedHosts, expected.approvedHosts)) {" \
  "  if (false) {"

check "不校验归一规则版本（旧批准套新语义）" "$ACT" \
  "  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {" \
  "  if (false) {"

check "不校验契约版本" "$ACT" \
  "  if (plan.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {" \
  "  if (false) {"

check "🔴 带 pending 的计划也放行（没判过当成不要）" "$ACT" \
  "  if (pending.length > 0) {" \
  "  if (false) {"

check "🔴 被接受的 URL 不再复核归一 / 主机（手改的能进台账）" "$ACT" \
  "    if (!isCanonicalForBoundary(url, { approvedHosts })) {" \
  "    if (false) {"

check "被接受集合里的重复不拦" "$ACT" \
  "    if (seen.has(url)) {" \
  "    if (false) {"

check "🔴 台账非空也照写（首次激活闸失效）" "$ACT" \
  "  if (existing !== 0) {" \
  "  if (false) {"

check "🔴 读不到台账行数当成 0" "$ACT" \
  "    return [
      {
        code: 'inventory_count_unavailable'," \
  "    return [] || [
      {
        code: 'inventory_count_unavailable',"

check "🔴 有页面失败照样写（部分成功被报成完成）" "$ACT" \
  "  if (failures.length > 0) {" \
  "  if (false) {"

check "🔴 分类失败的页面拿兜底 other 混进台账" "$ACT" \
  "    if (!enriched.classified) {" \
  "    if (false) {"

check "抓取器少返回的 URL 当成跳过而不是失败" "$ACT" \
  "    if (result === undefined) {" \
  "    if (result === undefined) { continue }
    if (false) {"

check "抓取结果带 error 也照写（反爬挑战页进台账）" "$ACT" \
  "    if (result.error !== undefined && result.error.length > 0) {" \
  "    if (false) {"

check "🔴 写入结果不做精确对账（少写/多写都报完成）" "$ACT" \
  "  if (missing.length > 0 || unexpected.length > 0) {" \
  "  if (false) {"

check "写入抛错也报完成" "$ACT" \
  "    return buildAudit({
      plan,
      accepted,
      status: 'failed',
      blockers: [
        {
          code: 'write_failed'," \
  "    return buildAudit({
      plan,
      accepted,
      status: 'activated',
      blockers: [
        {
          code: 'write_failed',"

echo "───────────────────────────────────────────────"
if [ "$fail_count" -eq 0 ]; then
  echo "✅ 全部 36 道闸各自单独确认会响"
  exit 0
fi
echo "❌ $fail_count 道闸没有确认"
exit 1
