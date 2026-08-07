/**
 * GitHub-backed workspace inspector.
 *
 * Used when the run has a pull request: GitHub's own file list is the record of
 * what the branch contains, independent of both the model's self-report and of
 * whatever state a runner's working tree happens to be in.
 */

import type { GitHubClient } from '../github/client'
import type { WorkspaceInspector, WorkspaceSnapshot } from './inspector'

export class GitHubPullRequestInspector implements WorkspaceInspector {
  readonly name = 'github-pr'

  constructor(
    private readonly client: GitHubClient,
    private readonly prNumber: number
  ) {}

  async inspect(): Promise<WorkspaceSnapshot> {
    const [files, pr] = await Promise.all([
      this.client.listPullRequestFiles(this.prNumber),
      this.client.getPullRequest(this.prNumber),
    ])

    return {
      changed_files: [...files].sort(),
      commit: pr ? { sha: pr.head_sha, branch: pr.head_ref } : null,
      pull_request: pr,
      source: 'github:pr-files',
    }
  }
}

/**
 * Prefer GitHub's file list once a PR exists; fall back to the local git view
 * before then. Both are authoritative; neither is the model.
 */
export function selectInspector(args: {
  prNumber: number | null
  github: GitHubClient
  local: WorkspaceInspector
}): WorkspaceInspector {
  return args.prNumber === null
    ? args.local
    : new GitHubPullRequestInspector(args.github, args.prNumber)
}
