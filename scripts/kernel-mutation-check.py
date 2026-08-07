#!/usr/bin/env python3
"""变异验证：逐个破坏一道闸，跑指定测试，确认它**真的红**，然后还原。

绿的测试和有效的测试是两回事。这个脚本产出的是后者的证据。
"""
import subprocess, sys, shutil, os, json

ROOT = os.getcwd()

MUTATIONS = [
    dict(
        name="拆掉跨客户校验",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.client_id !== ctx.clientId || decision.client_id !== run.client_id) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="跨客户",
    ),
    # ── P1-2：原子领取执行权 ─────────────────────────────────────────────
    dict(
        name="P1-2 执行权不再锁 run（退回「谁的决策谁兑换」）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.authorization_decision_id !== decisionId) return no('decision_not_current')""",
        new="""    // mutated: 不再检查这条决策是不是 run 当前那一份""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="同一个 run 两份 allow 决策",
    ),
    dict(
        name="P1-2 run 状态不再是领取的前提（去掉 authorized 检查）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.status !== 'authorized') return no(`run_not_authorized:${String(run.status)}`)""",
        new="""    // mutated: 不再要求 run 停在 authorized""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="执行权只有一个",
    ),
    dict(
        name="P1-2 提交撞唯一约束时不回读赢家（把正常竞争当故障抛出去）",
        file="src/lib/kernel/runner.ts",
        old="""    if (!(err instanceof UniqueViolationError)) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)""",
        new="""    if (err instanceof UniqueViolationError) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="并发提交",
    ),
    dict(
        name="P1-2 已存在的 run 也重新签一份授权（两个执行者）",
        file="src/lib/kernel/runner.ts",
        old="""  if (submitted.existing) {
    return {
      kind: 'in_progress',""",
        new="""  if (false) {
    return {
      kind: 'in_progress',""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="只签一份授权",
    ),
    # ── P1-1：人工批准重新校验 ───────────────────────────────────────────
    dict(
        name="P1-1 人工批准不再重跑授权闸",
        file="src/lib/kernel/authorize.ts",
        old="""  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: `${approvedByUser} 点了同意，但这条现在已经不能做了：${pf.reason}`,
      costEstimate: pf.costEstimate,
    })
  }""",
        new="""  const pf = await preflight(deps, run, now)
  if (false) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: (pf as { policy?: unknown }).policy as never,
      code: 'no_policy',
      reason: `${approvedByUser}`,
      costEstimate: null,
    })
  }""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="政策被删/改",
    ),
    dict(
        name="P1-1 人工批准不再要求政策仍是 require_approval",
        file="src/lib/kernel/authorize.ts",
        old="""  if (policy.mode !== 'require_approval') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="政策改成自动",
    ),
    dict(
        name="P1-1 人工批准不再比对政策版本",
        file="src/lib/kernel/authorize.ts",
        old="""  if (policy.policy_version !== pending.policy_version) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="政策版本变了",
    ),
    dict(
        name="P1-1 找不到原审批请求也照签",
        file="src/lib/kernel/authorize.ts",
        old="""  if (!pending || pending.verdict !== 'require_approval') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="审批请求丢了",
    ),
    # ── P1-3：政策版本自动演进 ───────────────────────────────────────────
    dict(
        name="P1-3 政策改了不再自动 bump 版本",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""            r.policy_version = Number(before.policy_version ?? 1) + (changed ? 1 : 0)""",
        new="""            r.policy_version = Number(before.policy_version ?? 1)""",
        test="src/lib/kernel/__tests__/policy-version.test.ts",
        expect_fail_contains="政策版本自动演进",
    ),
    dict(
        name="P1-3 调用方自己传的 policy_version 说了算",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""            const changed = authFields.some((f) => before[f] !== r[f])""",
        new="""            const changed = false""",
        test="src/lib/kernel/__tests__/policy-version.test.ts",
        expect_fail_contains="版本归数据库管",
    ),
    dict(
        name="不再检查政策版本是否变过",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.policy_version !== currentPolicyVersion) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="改了规则",
    ),
    dict(
        name="声明了验证却没验也算成功",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.verification) {
    const v = verificationOf(steps)""",
        new="""  if (false) {
    const v = verificationOf(steps)""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="验证",
    ),
    dict(
        name="Gateway 直接信任传进来的 ctx，不回库重读",
        file="src/lib/kernel/gateway.ts",
        old="""  assertDecisionMatches({""",
        new="""  if (false) assertDecisionMatches({""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="伪造",
    ),
    dict(
        name="查不到政策时默认放行（把默认 deny 改成默认 allow）",
        file="src/lib/kernel/authorize.ts",
        old="""  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {""",
        new="""  const policy = (await getActivePolicy(deps.supabase, run.client_id, run.action_key, now))
    ?? ({ id: 'mutant', client_id: run.client_id, action_key: run.action_key, mode: 'auto_approve',
          policy_version: 1, spend_cap_per_run_usd: 999, spend_cap_per_period_usd: null,
          spend_cap_period: null, decision_ttl_seconds: 900,
          effective_from: '2000-01-01T00:00:00.000Z', effective_to: null,
          updated_by: 'mutant' } as ClientAutomationPolicy)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {""",
        test="src/lib/kernel/__tests__/authorization.test.ts",
        expect_fail_contains="默认 deny",
    ),
    dict(
        # 提交时那句 SELECT 现在只是优化 —— 真正的闸是数据库的唯一约束
        # 加上「撞了就回读赢家」。所以探针要拆的是约束本身。
        name="幂等的唯一约束没了（提交时的 SELECT 只是优化，不是闸）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""  action_runs: [['client_id', 'idempotency_key']],""",
        new="""  action_runs: [],""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="唯一约束才是幂等的闸",
    ),
    dict(
        name="读稿子时不再按客户过滤（4 轴身份少一轴）",
        file="src/lib/capabilities/seo/build-publish-package.ts",
        old="""    .eq('id', blogPostId)
    .eq('client_id', clientId)
    .limit(1)""",
        new="""    .eq('id', blogPostId)
    .limit(1)""",
        test="src/lib/kernel/__tests__/safe-capability.test.ts",
        expect_fail_contains="别的客户",
    ),
    dict(
        name="验证失败改成可重试",
        file="src/lib/kernel/gateway.ts",
        old="""            `这一步写完之后回头验，没验过：${result.verification.failure_reason ?? '未说明原因'}`,
            { detail: { stepKey, checks: result.verification.checks } },""",
        new="""            `这一步写完之后回头验，没验过：${result.verification.failure_reason ?? '未说明原因'}`,
            { retryable: true, detail: { stepKey, checks: result.verification.checks } },""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="验证",
    ),
    dict(
        name="未知动作不再落 deny 记录，静默跳过",
        file="src/lib/kernel/authorize.ts",
        old="""  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return bad(""",
        new="""  const definition = deps.registry.get(run.action_key)
  if (false) {
    return bad(""",
        test="src/lib/kernel/__tests__/authorization.test.ts",
        expect_fail_contains="未知动作",
    ),
    dict(
        name="步骤已成功也重跑（拆掉断点续跑）",
        file="src/lib/kernel/gateway.ts",
        old="""    if (step.status === 'succeeded') continue""",
        new="""    if (false) continue""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="断点续跑",
    ),
    dict(
        name="不再累计步骤实际花费（成本上限形同虚设）",
        file="src/lib/kernel/gateway.ts",
        old="""        if (ctx.costCapUsd !== null && spent > ctx.costCapUsd) {""",
        new="""        if (false) {""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="花钱",
    ),
    dict(
        name="没建模的表返回空数组而不是抛错（假件退回旧毛病）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      throw new Error(
        `[fake-supabase] 测试没有为表「${name}」建模。要么它不该被查，要么这个测试少准备了数据。`,
      )""",
        new="""      tables[name] = []
      known.add(name)""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="假件本身",
    ),
    # ── P1-4：migration 版本撞车 ─────────────────────────────────────────
    dict(
        name="P1-4 新起一个跟别人同号的 migration",
        rename=(
            "supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
            # 20260806000001 已经被 execution_auto_run_tracking 占了
            "supabase/migrations/20260806000001_me2_execution_kernel_v1.sql",
        ),
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="migration 版本撞车",
    ),
]


def run_test(path):
    r = subprocess.run(
        ["npx", "vitest", "run", path, "--reporter=basic"],
        capture_output=True, text=True, cwd=ROOT,
    )
    return r.returncode, r.stdout + r.stderr


def main():
    results = []
    for m in MUTATIONS:
        # 改名型变异：P1-4 防的是文件名撞车，破坏点不在代码里
        if "rename" in m:
            src, dst = m["rename"]
            os.rename(src, dst)
            try:
                code, out = run_test(m["test"])
                failed = code != 0
                names = [l.strip() for l in out.splitlines() if l.strip().startswith("×")]
                results.append((
                    m["name"],
                    "CAUGHT" if failed else "MISSED",
                    "; ".join(names[:4]) if failed else "测试全绿 —— 这道闸没有被任何测试盯着",
                ))
            finally:
                os.rename(dst, src)
            continue

        f = m["file"]
        original = open(f, encoding="utf-8").read()
        if m["old"] not in original:
            results.append((m["name"], "SKIP", "锚点没匹配上（代码改过了，变异脚本要跟着更新）"))
            continue
        mutated = original.replace(m["old"], m["new"], 1)
        open(f, "w", encoding="utf-8").write(mutated)
        try:
            code, out = run_test(m["test"])
            failed = code != 0
            # 抓出到底哪几条挂了
            names = [l.strip() for l in out.splitlines() if l.strip().startswith("×")]
            results.append((
                m["name"],
                "CAUGHT" if failed else "MISSED",
                "; ".join(names[:4]) if failed else "测试全绿 —— 这道闸没有被任何测试盯着",
            ))
        finally:
            open(f, "w", encoding="utf-8").write(original)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    missed = [r for r in results if r[1] != "CAUGHT"]
    print(f"\n总计 {len(results)} 个变异，抓住 {len(results)-len(missed)} 个，漏掉 {len(missed)} 个")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
