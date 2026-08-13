#!/usr/bin/env python3
"""变异验证：逐个破坏一道闸，跑指定测试，确认它**真的红**，然后还原。

绿的测试和有效的测试是两回事。这个脚本产出的是后者的证据。

🔴 **这个文件只放 runner。** 探针定义在 `scripts/kernel_mutations/` 下按主题分模块
   （原来全挤在这里，到了 2501 行 > 仓库铁律的 800）。装配和一致性校验在
   `scripts/kernel_mutations/__init__.py` —— 漏加载一个模块会当场报错，
   不会出现「少跑一批但全绿」。

用法：
    python3 scripts/kernel-mutation-check.py
退出码：有任何一条不是 CAUGHT 就返回 1。
"""
import subprocess, sys, os, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kernel_mutations import load_all  # noqa: E402

ROOT = os.getcwd()

#: 全部探针（按 EXPECTED_MODULES 的固定顺序拼出来）
MUTATIONS = load_all()





def run_test(path):
    r = subprocess.run(
        ["npx", "vitest", "run", path, "--reporter=basic"],
        capture_output=True, text=True, cwd=ROOT,
    )
    return r.returncode, r.stdout + r.stderr


def judge(m, code, out):
    """判定一次变异到底有没有被**想验的那道闸**抓住。

    🔴 早先这里只看 `code != 0` —— 「CAUGHT」的真实含义只是
    「那个测试文件里有东西红了」，不是「我想验的那道闸红了」。
    测试文件一大（十几二十个用例），随便哪条附带地红一下就算过，
    等于把变异验证降级成了「跑一下试试」。

    现在 `expect_fail_contains` 是**强制**的：写了就必须有一条红掉的用例名
    包含它；红了但不是那一条 → WRONG_TEST，跟 MISSED 一样算没通过。
    留空表示「这条变异会牵连一大片，不指定具体用例」——那是刻意的例外，
    要在探针里写清楚为什么。
    """
    names = [l.strip() for l in out.splitlines() if l.strip().startswith("×")]
    if code == 0:
        return (m["name"], "MISSED", "测试全绿 —— 这道闸没有被任何测试盯着")
    want = m.get("expect_fail_contains", "")
    if want and not any(want in n for n in names):
        return (
            m["name"],
            "WRONG_TEST",
            f"红了，但红的不是想验的那条（期望名字里含「{want}」）：" + "; ".join(names[:4]),
        )
    return (m["name"], "CAUGHT", "; ".join(names[:4]))


def main():
    results = []
    for m in MUTATIONS:
        # 改名型变异：P1-4 防的是文件名撞车，破坏点不在代码里
        if "rename" in m:
            src, dst = m["rename"]
            os.rename(src, dst)
            try:
                results.append(judge(m, *run_test(m["test"])))
            finally:
                os.rename(dst, src)
            continue

        f = m["file"]
        original = open(f, encoding="utf-8").read()
        if m["old"] not in original:
            results.append((m["name"], "SKIP", "锚点没匹配上（代码改过了，变异脚本要跟着更新）"))
            continue
        mutated = original.replace(m["old"], m["new"], 1)
        # 有些变异要同时动两处（比如「把两条语句调个个儿」= 从这儿删、到那儿加）
        if "old2" in m:
            if m["old2"] not in mutated:
                results.append((m["name"], "SKIP", "第二个锚点没匹配上（变异脚本要跟着更新）"))
                continue
            mutated = mutated.replace(m["old2"], m["new2"], 1)
        open(f, "w", encoding="utf-8").write(mutated)
        try:
            results.append(judge(m, *run_test(m["test"])))
        finally:
            open(f, "w", encoding="utf-8").write(original)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    # 🔴 四类分开报。把 SKIP 混进「漏掉」里看不出「那道闸从没被验过」——
    #    锚点失配是**静默**的，它长得跟「探针少了几条」一模一样。
    counts = {k: sum(1 for r in results if r[1] == k)
              for k in ("CAUGHT", "SKIP", "MISSED", "WRONG_TEST")}
    print(
        f"\n总计 {len(results)} | CAUGHT={counts['CAUGHT']} "
        f"SKIP={counts['SKIP']} MISSED={counts['MISSED']} WRONG_TEST={counts['WRONG_TEST']}"
    )
    for r in results:
        if r[1] != "CAUGHT":
            print(f"  [{r[1]}] {r[0]} | {r[2][:200]}")
    return 0 if counts["CAUGHT"] == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
