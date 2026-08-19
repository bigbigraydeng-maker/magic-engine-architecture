/**
 * open_pr step 必须以 draft:true 打 PR。
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

describe('open_pr · draft:true', () => {
  it('createPullRequest 被以 draft:true 调用', async () => {
    let capturedParams: any = null
    const fakeGh: any = {
      async createPullRequest(_o: string, _r: string, params: any) {
        capturedParams = params
        return { number: 7, html_url: 'https://github.com/o/r/pull/7', title: params.title }
      },
    }
    const cap = createPageApplyOptimizationCapability(noopSb(), {
      resolveGithubConnection: async () => ({
        repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
        contentPaths: ['website/x.html'], plainToken: 't',
      }),
      createGithubClient: () => fakeGh,
    })

    const prepOutput = {
      repo_owner: 'o', repo_name: 'r', default_branch: 'main',
      content_path: 'website/x.html', page_version_token: 'sha1',
      branch_name: 'me/page-apply/idem',
      patched_content: '<html></html>',
      diff_changes: [{ field: 'meta_description', before: 'a', after: 'b', changed: true }],
    }

    const result = await cap.steps.open_pr({
      ctx: fakeCtx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
      priorOutputs: { prepare: prepOutput as unknown as Record<string, unknown> },
    })

    expect(capturedParams.draft).toBe(true)
    expect(capturedParams.head).toBe('me/page-apply/idem')
    expect(capturedParams.base).toBe('main')
    expect(capturedParams.body).toMatch(/kernel_run_id: run/)
    expect(capturedParams.body).toMatch(/Draft PR/)
    expect(result.output.provider === undefined || result.output.pr_number !== undefined || (result.output as any).pr_url !== undefined).toBeTruthy()
  })
})
