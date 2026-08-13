/**
 * K-WP01A 回归闸 · **审批锚的归属与身份**。
 *
 * 一句话：一条 run 只能按**它自己那份**审批请求来处理。
 *
 *   · 指针错挂到别人的决策上 → 拒绝，且不把对方的理由吐出来（跨客户元数据泄露）
 *   · 契约升过版 → 不许拿新版的规则 / 标题去批一条旧请求
 *   · 拒绝旧版请求 → 不写新版的契约快照（审计记录不许自相矛盾）
 *   · run 还活着的不一致 → 非终态码，不许被当成「已有结论」划掉
 *
 * 每条单独一个 describe，坏掉时一眼看得出是哪一条回退了。
 */

import { describe, it, expect } from 'vitest'
import { CLIENT_A, CLIENT_B } from '@/lib/kernel/__tests__/fixtures'
import { ApprovalError } from '../errors'
import { buildApprovalDetail, decideApproval, listPendingApprovals, loadRunForApproval } from '../service'
import { authorizeRun } from '@/lib/kernel/authorize'
import { ACTOR, KEY, pendingFixture } from './_fixtures'


// ── P2-2 ─────────────────────────────────────────────────────────────────────

describe('🔴 Codex P2-2 · 审批请求必须真的属于这条 run 和这个客户', () => {
  it('指针挂到**另一个客户**那条决策上 → 详情拒绝，不把对方的理由吐出来', async () => {
    const { f, runId } = await pendingFixture()

    // 造一条属于 B 客户、别的 run 的 require_approval 决策，并把 A 的 run 错挂过去
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-0000000000cb',
      action_run_id: '40000000-0000-4000-8000-0000000000cb',
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由：给 xxx 投 $4000',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-0000000000cb'

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await buildApprovalDetail(f.supabase, run).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('pending_inconsistent')
    expect(
      JSON.stringify(err),
      '🔴 另一个客户的理由 / 政策版本一个字都不许出现在返回体里',
    ).not.toContain('B 客户的机密理由')
  })

  it('🔴 决策自称是**这条 run** 的，但 client_id 是另一个客户 → 一样拒绝', async () => {
    // 🔴 这条专门盯「客户」那一半判据。
    //    上一条用例里 action_run_id 和 client_id 一起改了，所以只要 run 那一半还在，
    //    客户那一半被删掉也不会红 —— 那就是一道被遮蔽的闸。
    //    这里让 action_run_id **对得上**，只有 client_id 不对，把它单独暴露出来。
    //    （Kernel 的 reuseLiveAuthorization 对同一形状抛 CROSS_CLIENT。）
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a1',
      action_run_id: runId,
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由：给 xxx 投 $4000',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a1'

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await buildApprovalDetail(f.supabase, run).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('pending_inconsistent')
    expect(JSON.stringify(err)).not.toContain('B 客户的机密理由')

    // 列表侧同样
    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toHaveLength(1)
  })

  it('指针挂到**同客户但另一条 run** 的决策上 → 一样拒绝', async () => {
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000a107',
      action_run_id: '40000000-0000-4000-8000-00000000a107',
      client_id: CLIENT_A,
      verdict: 'require_approval',
      reason: '另一件事的理由',
      policy_id: '901c0000-0000-4000-8000-000000000001',
      policy_version: 1,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000a107'

    const run = await loadRunForApproval(f.supabase, runId)
    await expect(buildApprovalDetail(f.supabase, run)).rejects.toMatchObject({
      code: 'pending_inconsistent',
    })
  })

  it('列表侧同样拦：错挂的那条进 skipped，不冒充一条能点的待办', async () => {
    const { f } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-0000000000cb',
      action_run_id: '40000000-0000-4000-8000-0000000000cb',
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-0000000000cb'

    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toHaveLength(1)
  })

  it('🔴 **拒绝的写路径**同样拦：错挂到另一个客户的决策拒不掉，也不抄它的政策版本', async () => {
    // 🔴 早先只有列表和详情这两条**读**路径过归属核对 —— 于是一条
    //    client_id 属于别人的错挂决策「读不出来但拒得掉」，
    //    而新签的 deny 会把对方的 policy_id / 版本抄进这个客户的审计记录。
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a1',
      action_run_id: runId, // 🔴 run 对得上，只有客户不对
      client_id: CLIENT_B,
      action_key: KEY,
      action_version: 1,
      idempotency_key: 'whatever',
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a1'
    const before = f.tables.authorization_decisions.length

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: {
        resolution: 'reject',
        expectedDecisionId: '0d000000-0000-4000-8000-00000000c1a1',
        reason: '不做',
      },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    // 🔴 **不是** not_pending：run 仍然停在 pending_approval（RPC 那条分支
    //    只读返回、一个字没写）。报成「已经有结论了」会让界面把一条
    //    既没结论、又还没人理顺的 run 抹掉，从此没人看得见它。
    expect((err as ApprovalError).code).toBe('stale_decision')
    expect(f.tables.action_runs[0].status, 'run 必须还停在等审批').toBe('pending_approval')
    expect(f.tables.authorization_decisions, '一条决策都不许新签').toHaveLength(before)
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(
      JSON.stringify(f.tables.authorization_decisions),
      '另一个客户的政策版本不许被抄进任何新记录',
    ).not.toContain('"policy_version":7,"decided_by":"human"')
  })

  it('🔴 数据库那道也拦（应用层那道拆了也守得住）', async () => {
    // 直接打 RPC —— 绕过应用层的前置校验，验的是锁内那道 pending_identity_mismatch。
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a2',
      action_run_id: runId,
      client_id: CLIENT_B,
      action_key: KEY,
      action_version: 1,
      idempotency_key: 'whatever',
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a2'

    const { data } = await (f.supabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: Array<{ ok: boolean; reason: string }> }>
    }).rpc('kernel_resolve_pending_approval', {
      p_run_id: runId,
      p_pending_decision_id: '0d000000-0000-4000-8000-00000000c1a2',
      p_resolution: 'reject',
      p_resolved_by: ACTOR,
      p_reason: '不做',
      p_policy_snapshot: {},
      p_cost_estimate_usd: null,
    })
    expect(data[0].ok).toBe(false)
    expect(data[0].reason).toBe('pending_identity_mismatch')
  })

  it('✅ 正常挂着自己那条的时候照常返回（判据不是把所有人都拦掉）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const detail = await buildApprovalDetail(f.supabase, await loadRunForApproval(f.supabase, runId))
    expect(detail.decision.id).toBe(expectedDecisionId)
  })
})

describe('🔴 Codex round 2 · 版本对不上时不许拿新版定义顶替', () => {
  it('列表和详情都不贴新版的标题 / 风险 / 副作用 / 门槛', async () => {
    const { f, runId } = await pendingFixture()
    // 契约升版：库里那条 run 记的还是旧版
    f.tables.action_runs[0].action_version = 99

    const { items } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.actionVersion, '如实回报 run 自己记的版本').toBe(99)
    expect(item.title, '不许把新版标题贴在旧请求上').toBeNull()
    expect(item.risk).toBeNull()
    expect(item.sideEffect).toBeNull()
    expect(item.requiredCapabilityTier, '门槛说不清就是 null，不拿新版的顶').toBeNull()

    const detail = await buildApprovalDetail(
      f.supabase,
      await loadRunForApproval(f.supabase, runId),
    )
    expect(detail.title).toBeNull()
    expect(detail.requiredCapabilityTier).toBeNull()
  })
})

describe('🔴 Codex round 8 · 拒绝旧版请求时不许写新版的契约快照', () => {
  it('版本对不上 → deny 的 policy_snapshot 里 definition 是 null，不是新版那份', async () => {
    // 🔴 注册表只存当前那一版。按 action_key 取到的是**新版**，而这条 deny
    //    自己的 action_version 记的是**旧**版 —— 把新版的 version / risk /
    //    side_effect 写进去，等于让一条 append-only 审计记录自己跟自己打架。
    const { f, runId, expectedDecisionId } = await pendingFixture()
    f.tables.action_runs[0].action_version = 99
    // 指针那份也跟着改，才走得到拒绝那条路
    const pending = f.tables.authorization_decisions.find((d) => d.id === expectedDecisionId)!
    pending.action_version = 99
    pending.idempotency_key = f.tables.action_runs[0].idempotency_key

    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'reject', expectedDecisionId, reason: '契约变过了' },
    })

    const deny = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'deny' && d.decided_by === 'human',
    )!
    expect(deny.action_version, '这条 deny 记的仍然是旧版').toBe(99)
    const snapshot = deny.policy_snapshot as { definition: unknown }
    expect(
      snapshot.definition,
      '拿不到旧版契约就留空 —— 不许填一份看着像、其实不是的',
    ).toBeNull()
  })

  it('✅ 版本对得上时照常写 definition 快照（判据不是把所有快照都清空）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'reject', expectedDecisionId, reason: '这周不做' },
    })
    const deny = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'deny' && d.decided_by === 'human',
    )!
    const snapshot = deny.policy_snapshot as { definition: { action_key?: string } | null }
    expect(snapshot.definition?.action_key).toBe(KEY)
  })
})

describe('🔴 Codex round 9 · 还活着的不一致不许用终态码报', () => {
  it('run 仍是 pending_approval、指针错挂 → pending_inconsistent，不是 not_pending', async () => {
    // 🔴 `not_pending` 的含义是「这件事已经有结论了」，调用方据此把待办划掉。
    //    而这条 run 一个结论都没有 —— 它还停在 pending_approval，只是库里状态
    //    不一致。用终态码报它，等于让一条**永远不会被处理**的待办从管道里消失，
    //    而界面上看起来一切正常。锁内写路径对同类不一致已经报 stale_decision
    //    （非终态），读路径必须同向。
    const { f, runId } = await pendingFixture()
    f.tables.action_runs[0].authorization_decision_id = null

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await buildApprovalDetail(f.supabase, run).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('pending_inconsistent')
    expect((err as ApprovalError).status).toBe(409)
    expect(
      f.tables.action_runs[0].status,
      '这条 run 还活着 —— 报错没有把它推向任何终态',
      ).toBe('pending_approval')
  })

  it('🔴 真正的终态仍然报 not_pending（判据不是把所有失败都改成非终态）', async () => {
    const { f, runId } = await pendingFixture()
    f.tables.action_runs[0].status = 'succeeded'
    const run = await loadRunForApproval(f.supabase, runId)
    await expect(buildApprovalDetail(f.supabase, run)).rejects.toMatchObject({
      code: 'not_pending',
    })
  })
})

/**
 * 🔴 **失败落地之前也要核对审批锚的完整身份。**（Codex round 10 · P2）
 *
 * 场景：`authorization_decision_id` 被错挂到另一份 `require_approval` 决策上
 * （并发写歪 / 恢复路径写歪 / 手工改数据），同时 preflight 失败或政策漂移 ——
 * 于是走 `recordDeny`。锁内以前只比「指针指着它」，不比那份决策**是不是这条 run 的**：
 * 新签的 deny 里 `policy_id` / `policy_version` 是从**别人那份决策**抄来的，
 * 跨客户的数据被写进这个客户的 append-only 审计记录。
 *
 * 判据跟 `kernel_resolve_pending_approval` 第 ④ / ④b 步逐条一致 ——
 * 写入的两条路不许一条严一条松，松的那条就是被绕过去的那条。
 */
describe('🔴 失败落地前核对审批锚的完整身份', () => {
  /** 把 run 的指针挂到一份「长得像审批请求、但身份不对」的决策上。 */
  async function misAnchored(overrides: Record<string, unknown>) {
    const { f, runId } = await pendingFixture()
    const run = f.tables.action_runs[0]
    const bad = {
      id: '0d000000-0000-4000-8000-00000000bad0',
      action_run_id: run.id,
      client_id: run.client_id,
      action_key: run.action_key,
      action_version: run.action_version,
      idempotency_key: run.idempotency_key,
      verdict: 'require_approval',
      reason: '别人那份的机密理由：给 xxx 投 $4000',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 77,
      created_at: '2026-08-13T00:00:00.000Z',
      ...overrides,
    }
    f.tables.authorization_decisions.push(bad)
    run.authorization_decision_id = bad.id
    // 政策删掉 → preflight 必失败 → 一定走 recordDeny 那条失败落地
    f.tables.client_automation_policies.length = 0
    return { f, runId, anchorId: String(bad.id) }
  }

  const SHAPES: Array<[label: string, overrides: Record<string, unknown>]> = [
    ['跨客户错挂', { client_id: CLIENT_B, action_run_id: '40000000-0000-4000-8000-0000000000cb' }],
    // 🔴 只有客户不对、**run 对得上** —— 上一条把两个字段一起改了，于是
    //    「客户」那一半被「run」那一半遮住：删掉客户判据也不会红。
    //    这一条把它单独暴露出来（跟 decisionBelongsToRun 那次同一个教训）。
    ['只有客户不对（run 对得上）', { client_id: CLIENT_B }],
    ['同客户、另一条 run', { action_run_id: '40000000-0000-4000-8000-00000000a107' }],
    ['action_key 不一致', { action_key: 'geo.rewrite_the_whole_site' }],
    ['action_version 不一致', { action_version: 99 }],
    ['幂等身份不一致', { idempotency_key: 'someone-elses-key' }],
    ['锚不是 require_approval', { verdict: 'allow' }],
  ]

  it.each(SHAPES)('%s → 零新决策、run 状态与指针一个字没动', async (_label, overrides) => {
    const { f, runId, anchorId } = await misAnchored(overrides)
    const decisionsBefore = f.tables.authorization_decisions.length
    const runBefore = { ...f.tables.action_runs[0] }

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId: anchorId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    // 🔴 **非终态** —— run 还停在等审批，不许报成「已经有结论了」
    expect((err as ApprovalError).code).toBe('stale_decision')
    expect((err as ApprovalError).status).toBe(409)

    // 🔴 逐条比「什么都没被改动」
    expect(f.tables.authorization_decisions, '不许插 deny').toHaveLength(decisionsBefore)
    expect(f.tables.action_runs[0].status, 'run 必须还停在 pending_approval').toBe(
      'pending_approval',
    )
    expect(f.tables.action_runs[0].authorization_decision_id).toBe(runBefore.authorization_decision_id)
    expect(f.tables.action_runs[0].last_error).toBe(runBefore.last_error)
    expect(f.tables.action_runs[0].finished_at).toBeFalsy()
    // 🔴 别人那份决策的内容一个字都不许出现在返回体里
    expect(JSON.stringify(err)).not.toContain('机密理由')
  })

  it('✅ 锚身份全对时，失败落地照常落一条 deny（判据不是把所有落地都拦掉）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    // 政策删掉 → preflight 失败 → 走 recordDeny，但锚是它自己那份
    f.tables.client_automation_policies.length = 0

    const result = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })

    expect(result.finalStatus).toBe('denied')
    expect(f.tables.action_runs[0].status).toBe('denied')
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'deny'),
      '这条路必须真的走得通 —— 否则政策一被删，run 就永远卡住',
    ).toHaveLength(1)
  })

  it('🔴 自动授权路径（不带 expectedDecisionId）不受影响', async () => {
    // 🔴 这道闸只在「审批人说他看到了哪一份」时才有意义。
    //    自动授权没有这个概念 —— 把它一并卡住会让 preflight 失败的自动 run
    //    再也落不了 deny，那是**误伤**，不是更严。
    const { f } = await pendingFixture()
    const run = f.tables.action_runs[0]
    run.status = 'queued'
    run.authorization_decision_id = null
    f.tables.client_automation_policies.length = 0

    const outcome = await authorizeRun(f.kernel, (await loadRunForApproval(f.supabase, String(run.id))))
    expect(outcome.verdict).toBe('deny')
    expect(f.tables.action_runs[0].status).toBe('denied')
  })
})
