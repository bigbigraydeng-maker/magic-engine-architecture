/**
 * open_pr step:
 *   - happy path: createPullRequest 用 draft:true + head/base 正确
 *   - **本 round P0**: happy path 与 422 fallback 都必须调 getPullRequestDetail
 *     做**创建后自检**（draft/state/head/base/body receipt 全对）
 *   - 422 fallback 必须**逐条 candidate 核对 receipt**，只有全对才 adopt；
 *     一个都不命中 → INVALID_STATE fail-closed（不再"取第一个"）
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { createPageApplyOptimizationCapability } from '..'

function noopSb(): SupabaseClient {
  return { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient
}

function fakeCtx(): AuthorizedExecutionContext {
  return {
    decisionId: 'dec', runId: 'run', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'k', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

const PREP = {
  repo_owner: 'o', repo_name: 'r', default_branch: 'main',
  content_path: 'website/x.html', page_version_token: 'sha1',
  branch_name: 'me/page-apply/idem',
  patched_content: '<html></html>',
  diff_changes: [{ field: 'meta_description', before: 'a', after: 'b', changed: true }],
}

// receipt body constructor mirrors capability (kernel_run_id + authorization_decision_id lines)
const receiptBody = (runId = 'run', decisionId = 'dec') =>
  `- kernel_run_id: ${runId}\n- authorization_decision_id: ${decisionId}\n`

async function runOpenPr(fakeGh: any) {
  const cap = createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => fakeGh,
  })
  return cap.steps.open_pr({
    ctx: fakeCtx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
    runInput: {},
    priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
  })
}

describe('open_pr · happy path draft + receipt', () => {
  it('createPullRequest draft:true; 之后 getPullRequestDetail 自检 receipt 通过', async () => {
    let capturedParams: any = null
    const fakeGh: any = {
      async createPullRequest(_o: string, _r: string, params: any) {
        capturedParams = params
        return { number: 7, html_url: 'https://github.com/o/r/pull/7', title: params.title }
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        return {
          number: n, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'x', body: capturedParams.body,
          htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    const result = await runOpenPr(fakeGh)
    expect(capturedParams.draft).toBe(true)
    expect(capturedParams.head).toBe('me/page-apply/idem')
    expect(capturedParams.base).toBe('main')
    expect(capturedParams.body).toMatch(/kernel_run_id: run/)
    expect(capturedParams.body).toMatch(/authorization_decision_id: dec/)
    expect(result.output.pr_number).toBe(7)
    expect(result.output.pr_url).toBe('https://github.com/o/r/pull/7')
  })

  it('createPullRequest 成功但 getPullRequestDetail 显示 draft:false → INVALID_STATE (pr_receipt_mismatch)', async () => {
    // 攻击/provider 契约违约：PR 被创建成非 draft
    const fakeGh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7', title: 't' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: false,
          headRef: 'me/page-apply/idem', baseRef: 'main', title: 't',
          body: receiptBody(), htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/pr_open_receipt_mismatch/),
    })
  })

  it('createPullRequest 成功但 getPullRequestDetail head/base 不符 → INVALID_STATE', async () => {
    const fakeGh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'someone/else/branch', baseRef: 'main',
          title: 't', body: receiptBody(), htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/receipt/),
    })
  })

  it('createPullRequest 成功但 body 不含 receipt marker → INVALID_STATE', async () => {
    const fakeGh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 't', body: '别人的 PR 描述，没有 receipt',
          htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/receipt/),
    })
  })
})

describe('open_pr · 422 recovery — 必须逐条 candidate 核对 receipt', () => {
  it('422 → list 找到一条 receipt 全对的 open Draft PR → adopt', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('422 Validation Failed: A pull request already exists') },
      async listPullRequestsByHead(_o: string, _r: string, head: string) {
        expect(head).toBe('me/page-apply/idem')
        return [{ number: 99, html_url: 'https://github.com/o/r/pull/99', title: 're-used' }]
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        return {
          number: n, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 're-used', body: receiptBody(),
          htmlUrl: 'https://github.com/o/r/pull/99',
        }
      },
    }
    const result = await runOpenPr(fakeGh)
    expect(result.output.pr_number).toBe(99)
    expect(result.output.pr_url).toBe('https://github.com/o/r/pull/99')
  })

  it('422 → list 返回 [] → INVALID_STATE，不是 retryable', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() { return [] },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/找不到.*receipt/),
    })
  })

  it('🔴 攻击：422 → list 返回 someone-else 的 PR（head 对但 body 没 receipt）→ fail-closed', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() {
        return [{ number: 500, html_url: 'https://github.com/o/r/pull/500', title: 'attacker' }]
      },
      async getPullRequestDetail() {
        return {
          number: 500, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'attacker', body: 'not our PR', // ← 没 receipt
          htmlUrl: 'https://github.com/o/r/pull/500',
        }
      },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_pr_not_owned_by_run|拒绝 adopt/),
    })
  })

  it('🔴 攻击：422 → list 返回 draft:false 的 PR（虽然 body 假冒 receipt）→ fail-closed', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() {
        return [{ number: 501, html_url: 'https://github.com/o/r/pull/501', title: 'ready' }]
      },
      async getPullRequestDetail() {
        return {
          number: 501, state: 'open', merged: false, mergedAt: null, draft: false, // ← 非 draft
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'ready', body: receiptBody(),
          htmlUrl: 'https://github.com/o/r/pull/501',
        }
      },
    }
    await expect(runOpenPr(fakeGh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/找不到.*receipt/),
    })
  })

  it('🔴 攻击：422 → 第一条 candidate 是 attacker，第二条是本 run 的 → adopt 第二条', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() {
        return [
          { number: 500, html_url: 'https://github.com/o/r/pull/500', title: 'attacker' },
          { number: 99, html_url: 'https://github.com/o/r/pull/99', title: 'ours' },
        ]
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        if (n === 500) {
          return {
            number: 500, state: 'open', merged: false, mergedAt: null, draft: true,
            headRef: 'me/page-apply/idem', baseRef: 'main',
            title: 'attacker', body: 'no receipt',
            htmlUrl: 'https://github.com/o/r/pull/500',
          }
        }
        return {
          number: 99, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'ours', body: receiptBody(),
          htmlUrl: 'https://github.com/o/r/pull/99',
        }
      },
    }
    const result = await runOpenPr(fakeGh)
    expect(result.output.pr_number).toBe(99) // 不是 500！
  })

  it('createPullRequest 其它错误 → RetryableCapabilityError', async () => {
    const fakeGh: any = {
      async createPullRequest() { throw new Error('500 internal server error') },
    }
    await expect(runOpenPr(fakeGh)).rejects.toThrow(/pr_open_failed/)
  })
})
