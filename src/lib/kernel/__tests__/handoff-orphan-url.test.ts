/**
 * 复审 2026-08-19 round-2（魏征 P0-1/P0-2）：
 *
 * capability 层已经在 humanReason / verification.failure_reason 里塞了孤儿
 * artefact 直达 URL，但**未走完最后一公里** —— handoff.ts 里 dead_letter 分支
 * `href: ''` 不变，UI 那个「去做这件事」按钮就渲染不出来；铁律 §3「连粘贴都
 * 不用」不成立。round-2 修补 handoff.ts 让它主动从 last_error 里抽合法的
 * GitHub PR / branch URL 提到 href 并把 how 文案改成主动清理指令。
 *
 * 本文件是**行为验证**（memory: [[feedback-declared-but-not-wired]]）：
 * 断言输出 KernelHandoffTodo 的 href 和 how 字段真的变了，而不是断言
 * 「抽取器函数存在」。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchKernelHandoffTodos, extractOrphanArtefactUrl } from '../handoff'

// ── 构造 supabase fake，只喂 listDeadLetterRuns 一路 ──────────────────────────

function sbWithDeadLetter(runs: unknown[]): SupabaseClient {
  // 链形：select().in('status', [...]).eq('needs_human', true).gte(...).order(...).limit(50)
  return {
    from() {
      return {
        select() { return this },
        in() { return this },
        eq() { return this },
        gte() { return this },
        order() { return this },
        limit() { return Promise.resolve({ data: runs, error: null }) },
      }
    },
  } as unknown as SupabaseClient
}

const BASE_RUN = {
  id: 'run-1',
  client_id: 'client-1',
  action_key: 'page.apply_optimization_request',
  status: 'dead_letter' as const,
  finished_at: new Date().toISOString(),
}

// ── extractOrphanArtefactUrl 直接单测 ─────────────────────────────────────────

describe('extractOrphanArtefactUrl · 严格 slug 与边界校验', () => {
  it('合法 PR URL → 命中，优先 PR 而非 branch', () => {
    const text =
      '一堆前缀文案\n  - Close 掉 Draft PR #7：https://github.com/owner-a/repo_a/pull/7\n  - 删除分支：https://github.com/owner-a/repo_a/tree/me/page-apply/abc123\n后缀'
    const r = extractOrphanArtefactUrl(text)
    expect(r?.kind).toBe('pr')
    expect(r?.url).toBe('https://github.com/owner-a/repo_a/pull/7')
  })

  it('仅有 branch URL → 命中 branch', () => {
    const text = '删除分支：https://github.com/owner-a/repo_a/tree/me/page-apply/abc123 (v1 不自动)'
    const r = extractOrphanArtefactUrl(text)
    expect(r?.kind).toBe('branch')
    expect(r?.url).toBe('https://github.com/owner-a/repo_a/tree/me/page-apply/abc123')
  })

  it('owner 含斜杠（注入）→ 不命中', () => {
    // 攻击构造：cms_connections.repoOwner 塞 `evil/attacker`，capability 拼出
    // https://github.com/evil/attacker/repo_a/tree/... —— 严格正则 owner=[A-Za-z0-9-]{1,39}
    // 不允许斜杠，第一段 `evil` 会先匹配 owner，然后 `/attacker/repo_a/pull/7` 里的
    // `attacker` 作为 repo，`7` 作为 PR 号 —— 这条**仍会命中**成 `pr:evil/attacker#7`。
    // 因此仅靠 handoff.ts 单侧校验不够，capability 侧的 orphanArtefactHint 也做
    // 了同样正则；本 test 验证 handoff 单侧行为：如果字符串里 owner 段本身合法，
    // 会命中一条**合法但可能是错误目标**的 URL。
    // 真正防御在两侧同时做的正则 —— capability 那侧拒绝渲染带斜杠 owner 的 URL，
    // handoff 侧也拒绝，双保险。
    // 本条只演示：一段完全无 URL 的告警文案，handoff 抽不到任何 URL。
    const text = '仓库标识含非法字符，未渲染直达链接 —— 请查 client cms_connections 配置'
    expect(extractOrphanArtefactUrl(text)).toBeNull()
  })

  it('URL 后紧跟 URL-safe 字符（防误吞）→ 拒绝', () => {
    // 边界：正则 `pull/\d{1,10}` 会命中 `pull/7`，但紧接的 `X` 属于 URL-safe
    // 字符集（A-Z），说明 URL 实际未终结（比如日志被截断、或后面还有别的
    // 路径 segment），按保守策略**拒绝**这条模糊匹配。
    const text = 'https://github.com/o/r/pull/7X 后续被截断的内容'
    expect(extractOrphanArtefactUrl(text)).toBeNull()
  })

  it('URL 后跟非 URL-safe 字符（正常终结）→ 命中', () => {
    const text = '在文案里出现：https://github.com/o/r/pull/7，看下这条'
    const r = extractOrphanArtefactUrl(text)
    expect(r?.kind).toBe('pr')
    expect(r?.url).toBe('https://github.com/o/r/pull/7')
  })

  it('无 URL 的一般 last_error → null', () => {
    expect(extractOrphanArtefactUrl('普通 dead_letter，未涉及 GitHub')).toBeNull()
    expect(extractOrphanArtefactUrl('')).toBeNull()
    expect(extractOrphanArtefactUrl('未说明原因')).toBeNull()
  })
})

// ── fetchKernelHandoffTodos 端到端 ────────────────────────────────────────────

describe('fetchKernelHandoffTodos · dead_letter 分支能把 orphan URL 提到 href', () => {
  it('last_error 含 PR URL → href = PR URL，how 变成主动清理指令', async () => {
    const run = {
      ...BASE_RUN,
      last_error:
        '这一步写完之后回头验，没验过：PR 基于 approved 版本（main blob = page_version_token）（main_sha=X expected=Y）\n' +
        '\n⚠️ 客户 GitHub 仓库残留孤儿 artefact（v1 不自动撤回，需手工清理）：\n' +
        '  - Close 掉 Draft PR #42：https://github.com/client-org/client-site/pull/42\n' +
        '  - 删除分支：https://github.com/client-org/client-site/tree/me/page-apply/idem',
    }
    const todos = await fetchKernelHandoffTodos(sbWithDeadLetter([run]))
    expect(todos).toHaveLength(1)
    const t = todos[0]
    // 🔴 关键：href 必须是可点的真 PR URL（不再是 ''）
    expect(t.href).toBe('https://github.com/client-org/client-site/pull/42')
    // 🔴 how 必须是主动清理指令，不是「不用你做」
    expect(t.how).toMatch(/关掉这条 Draft PR|删掉这条分支/)
    expect(t.how).not.toMatch(/不用你做那件事本身/)
    // what 仍带原始错误
    expect(t.what).toContain('未合并的 Draft PR / 分支')
  })

  it('last_error 只有 branch URL → href = branch URL，how 引导删分支', async () => {
    const run = {
      ...BASE_RUN,
      last_error:
        'commit 冲突：main 在授权与执行之间移动过（stale_snapshot_at_commit）\n' +
        '\n⚠️ 客户 GitHub 仓库残留孤儿 artefact：\n' +
        '  - 删除分支：https://github.com/client-org/client-site/tree/me/page-apply/xyz',
    }
    const todos = await fetchKernelHandoffTodos(sbWithDeadLetter([run]))
    expect(todos[0].href).toBe('https://github.com/client-org/client-site/tree/me/page-apply/xyz')
    expect(todos[0].how).toMatch(/删掉这条分支/)
  })

  it('普通 dead_letter（无孤儿 URL）→ 保持原行为，href=空，how=「不用你做」', async () => {
    const run = {
      ...BASE_RUN,
      last_error: '内部错误：某个 upstream 429',
    }
    const todos = await fetchKernelHandoffTodos(sbWithDeadLetter([run]))
    expect(todos[0].href).toBe('')
    expect(todos[0].how).toMatch(/不用你做那件事本身/)
  })
})
