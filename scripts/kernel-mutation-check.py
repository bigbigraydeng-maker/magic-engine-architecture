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
    dict(
        name="兑换授权不再是原子的（去掉 consumed_at IS NULL）",
        file="src/lib/kernel/store.ts",
        old="""    .eq('id', decisionId)
    .is('consumed_at', null)
    .select(DECISION_COLUMNS)""",
        new="""    .eq('id', decisionId)
    .select(DECISION_COLUMNS)""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="重放",
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
        old="""  if (!policy) {
    return recordDeny(deps, {""",
        new="""  if (false) {
    return recordDeny(deps, {""",
        test="src/lib/kernel/__tests__/authorization.test.ts",
        expect_fail_contains="默认 deny",
    ),
    dict(
        name="提交时不再按幂等键查已有执行",
        file="src/lib/kernel/runner.ts",
        old="""  const existing = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
  if (existing) return { run: existing, existing: true }""",
        new="""  const existing = null
  if (existing) return { run: existing, existing: true }""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="幂等",
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
    return recordDeny(deps, {""",
        new="""  const definition = deps.registry.get(run.action_key)
  if (false) {
    return recordDeny(deps, {""",
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
